import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

export const AI_MODEL_CLIENT = Symbol('AI_MODEL_CLIENT');

export type AiProvider = 'openrouter' | 'gemini';

export interface AiModelRequestContext {
  requestId: string;
}

export interface AiModelCompletion {
  message: ChatCompletionMessage;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  providerCostUsdMicros?: number;
  provider?: AiProvider;
}

export interface AiModelClient {
  readonly enabled: boolean;
  complete(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
    signal: AbortSignal,
    context?: AiModelRequestContext,
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

/** Fixed, content-free response diagnostics. Never attach provider payloads. */
export type AiResponseValidationCode =
  | 'invalid_envelope'
  | 'missing_choices'
  | 'missing_message'
  | 'invalid_message_role'
  | 'invalid_content'
  | 'missing_visible_output'
  | 'malformed_tool_call'
  | 'invalid_tool_arguments'
  | 'missing_model'
  | 'invalid_usage'
  | 'response_too_large'
  | 'tool_iteration_limit';

export interface AiResponseDiagnostic {
  code: AiResponseValidationCode;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'other' | 'missing';
  contentType?:
    'missing' | 'null' | 'string' | 'array' | 'object' | 'number' | 'boolean';
  toolCallCount?: number;
}

export class AiProviderFailure extends Error {
  constructor(
    public readonly reason: AiProviderFailureReason,
    public readonly status?: number,
    public readonly diagnostic?: AiResponseDiagnostic,
  ) {
    super(reason);
  }
}
