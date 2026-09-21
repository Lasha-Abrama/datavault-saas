import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { APIConnectionTimeoutError, APIError } from 'openai';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import {
  AiModelClient,
  AiModelCompletion,
  AiProviderFailure,
  AiProviderFailureReason,
} from './ai-model-client';

type OpenRouterRequest = ChatCompletionCreateParamsNonStreaming & {
  models?: string[];
  usage: { include: true };
  provider: { data_collection: 'deny'; zdr?: true };
};

@Injectable()
export class OpenRouterClientService implements AiModelClient {
  readonly enabled: boolean;
  private readonly client?: OpenAI;
  private readonly model?: string;
  private readonly models: string[];
  private readonly maxOutputTokens: number;

  constructor(private readonly config: ConfigService) {
    this.enabled = config.getOrThrow<boolean>('OPENROUTER_ENABLED');
    this.models = config.get<string[]>('OPENROUTER_FALLBACK_MODELS') ?? [];
    this.maxOutputTokens = config.getOrThrow<number>(
      'OPENROUTER_MAX_OUTPUT_TOKENS',
    );
    if (this.enabled) {
      this.model = config.getOrThrow<string>('OPENROUTER_MODEL');
      this.client = new OpenAI({
        apiKey: config.getOrThrow<string>('OPENROUTER_API_KEY'),
        baseURL: 'https://openrouter.ai/api/v1',
        timeout: config.getOrThrow<number>('OPENROUTER_TIMEOUT_MS'),
        maxRetries: 0,
        defaultHeaders: { 'X-OpenRouter-Title': 'DataVault AI Assistant' },
      });
    }
  }

  async complete(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
    signal: AbortSignal,
  ): Promise<AiModelCompletion> {
    if (!this.client || !this.model)
      throw new AiProviderFailure(AiProviderFailureReason.UNAVAILABLE);
    const request: OpenRouterRequest = {
      model: this.model,
      ...(this.models.length ? { models: [this.model, ...this.models] } : {}),
      messages,
      tools,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      max_completion_tokens: this.maxOutputTokens,
      stream: false,
      usage: { include: true },
      provider: {
        data_collection: 'deny',
        ...(this.config.getOrThrow<boolean>('OPENROUTER_REQUIRE_ZDR')
          ? { zdr: true as const }
          : {}),
      },
    };
    try {
      const response = await this.client.chat.completions.create(request, {
        signal,
      });
      if (!this.record(response))
        throw new AiProviderFailure(AiProviderFailureReason.INVALID_RESPONSE);
      const choice = Array.isArray(response.choices)
        ? response.choices[0]
        : undefined;
      if (
        !this.validMessage(choice?.message) ||
        !this.validModel(response.model)
      )
        throw new AiProviderFailure(AiProviderFailureReason.INVALID_RESPONSE);
      const usage = response.usage;
      const runtimeUsage = usage as unknown as Record<string, unknown> | null;
      return {
        message: choice.message,
        model: response.model,
        promptTokens: this.safeInteger(usage?.prompt_tokens),
        completionTokens: this.safeInteger(usage?.completion_tokens),
        totalTokens: this.safeInteger(usage?.total_tokens),
        providerCostUsdMicros: this.costMicros(runtimeUsage?.cost),
      };
    } catch (error) {
      if (error instanceof AiProviderFailure) throw error;
      if (
        error instanceof APIConnectionTimeoutError ||
        (error instanceof Error && error.name === 'AbortError')
      )
        throw new AiProviderFailure(AiProviderFailureReason.TIMEOUT);
      if (error instanceof APIError) {
        const status =
          typeof error.status === 'number' ? error.status : undefined;
        if (status === 401 || status === 403)
          throw new AiProviderFailure(
            AiProviderFailureReason.AUTHENTICATION,
            status,
          );
        if (status === 402)
          throw new AiProviderFailure(AiProviderFailureReason.CREDITS, status);
        if (status === 429)
          throw new AiProviderFailure(
            AiProviderFailureReason.RATE_LIMIT,
            status,
          );
        throw new AiProviderFailure(
          AiProviderFailureReason.UNAVAILABLE,
          status,
        );
      }
      throw new AiProviderFailure(AiProviderFailureReason.UNAVAILABLE);
    }
  }

  private validMessage(value: unknown): value is AiModelCompletion['message'] {
    if (!this.record(value) || value.role !== 'assistant') return false;
    if (typeof value.content !== 'string' && value.content !== null)
      return false;
    if (value.tool_calls === undefined) return true;
    if (!Array.isArray(value.tool_calls)) return false;
    return value.tool_calls.every((toolCall) => {
      if (
        !this.record(toolCall) ||
        toolCall.type !== 'function' ||
        typeof toolCall.id !== 'string' ||
        !toolCall.id ||
        toolCall.id.length > 256 ||
        !this.record(toolCall.function)
      )
        return false;
      const name = toolCall.function.name;
      return (
        typeof name === 'string' &&
        /^[A-Za-z0-9_-]{1,128}$/.test(name) &&
        typeof toolCall.function.arguments === 'string'
      );
    });
  }

  private validModel(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      value.trim().length > 0 &&
      value.length <= 200
    );
  }

  private record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private safeInteger(value: unknown) {
    return Number.isSafeInteger(value) && Number(value) >= 0
      ? Number(value)
      : 0;
  }

  private costMicros(value: unknown) {
    const cost = typeof value === 'string' ? Number(value) : value;
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0)
      return undefined;
    const micros = Math.round(cost * 1_000_000);
    return Number.isSafeInteger(micros) ? micros : undefined;
  }
}
