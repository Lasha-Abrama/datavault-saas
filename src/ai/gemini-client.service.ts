import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import {
  AiModelClient,
  AiModelCompletion,
  AiProviderFailure,
  AiProviderFailureReason,
} from './ai-model-client';
import { normalizeChatCompletion } from './chat-completion-response';

/** Google's supported OpenAI-compatible endpoint is a direct Gemini API call. */
@Injectable()
export class GeminiClientService implements AiModelClient {
  readonly enabled: boolean;
  private readonly client?: OpenAI;
  private readonly model?: string;
  private readonly maxOutputTokens: number;

  constructor(config: ConfigService) {
    this.enabled = config.get<boolean>('GEMINI_ENABLED') === true;
    this.maxOutputTokens = config.getOrThrow<number>(
      'GEMINI_MAX_OUTPUT_TOKENS',
    );
    if (this.enabled) {
      this.model = config.getOrThrow<string>('GEMINI_MODEL');
      this.client = new OpenAI({
        apiKey: config.getOrThrow<string>('GEMINI_API_KEY'),
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        timeout: config.getOrThrow<number>('GEMINI_TIMEOUT_MS'),
        maxRetries: 0,
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
    try {
      const response = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: this.withToolNames(messages),
          tools,
          tool_choice: 'auto',
          reasoning_effort: 'low',
          max_tokens: this.maxOutputTokens,
          stream: false,
        },
        { signal },
      );
      return normalizeChatCompletion(response, 'gemini');
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
      if (error instanceof APIConnectionError)
        throw new AiProviderFailure(AiProviderFailureReason.UNAVAILABLE);
      // Unexpected local errors remain internal failures in AiService.
      throw error;
    }
  }

  private withToolNames(messages: ChatCompletionMessageParam[]) {
    const names = new Map<string, string>();
    return messages.map((message) => {
      if (message.role === 'assistant') {
        for (const call of message.tool_calls ?? [])
          if (call.type === 'function') names.set(call.id, call.function.name);
        if (message.tool_calls?.length)
          // Gemini's compatibility API documents `model` for function-call
          // history. Preserve its opaque extra_content thought signature.
          // Its examples omit content for tool-only messages. Keep that
          // wire shape when the normalized internal message uses null.
          return message.content === null
            ? ({
                ...message,
                role: 'model',
                content: undefined,
              } as unknown as ChatCompletionMessageParam)
            : ({
                ...message,
                role: 'model',
              } as unknown as ChatCompletionMessageParam);
      }
      if (message.role !== 'tool') return message;
      const name = names.get(message.tool_call_id);
      if (!name)
        throw new AiProviderFailure(AiProviderFailureReason.INVALID_RESPONSE);
      return { ...message, name } as ChatCompletionMessageParam;
    });
  }
}
