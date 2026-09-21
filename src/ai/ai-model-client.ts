import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

export const AI_MODEL_CLIENT = Symbol('AI_MODEL_CLIENT');

export interface AiModelCompletion {
  message: ChatCompletionMessage;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  providerCostUsdMicros?: number;
}

export interface AiModelClient {
  readonly enabled: boolean;
  complete(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
    signal: AbortSignal,
  ): Promise<AiModelCompletion>;
}

export enum AiProviderFailureReason {
  AUTHENTICATION = 'authentication',
  CREDITS = 'credits',
  RATE_LIMIT = 'rate_limit',
  TIMEOUT = 'timeout',
  UNAVAILABLE = 'unavailable',
  INVALID_RESPONSE = 'invalid_response',
}

export class AiProviderFailure extends Error {
  constructor(
    public readonly reason: AiProviderFailureReason,
    public readonly status?: number,
  ) {
    super(reason);
  }
}
