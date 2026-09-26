import type { ChatCompletion } from 'openai/resources/chat/completions';
import {
  AiModelCompletion,
  AiProvider,
  AiProviderFailure,
  AiProviderFailureReason,
} from './ai-model-client';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validMessage(value: unknown): value is AiModelCompletion['message'] {
  if (!record(value) || value.role !== 'assistant') return false;
  if (typeof value.content !== 'string' && value.content !== null) return false;
  if (value.tool_calls === undefined) return true;
  if (!Array.isArray(value.tool_calls)) return false;
  return value.tool_calls.every((toolCall) => {
    if (
      !record(toolCall) ||
      toolCall.type !== 'function' ||
      typeof toolCall.id !== 'string' ||
      !toolCall.id ||
      toolCall.id.length > 256 ||
      !record(toolCall.function)
    )
      return false;
    return (
      typeof toolCall.function.name === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/.test(toolCall.function.name) &&
      typeof toolCall.function.arguments === 'string'
    );
  });
}

function safeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function costMicros(value: unknown) {
  const cost = typeof value === 'string' ? Number(value) : value;
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0)
    return undefined;
  const micros = Math.round(cost * 1_000_000);
  return Number.isSafeInteger(micros) ? micros : undefined;
}

/** Validate SDK data at runtime; TypeScript's response type is not a trust boundary. */
export function normalizeChatCompletion(
  response: ChatCompletion,
  provider: AiProvider,
): AiModelCompletion {
  const runtime = response as unknown;
  if (!record(runtime))
    throw new AiProviderFailure(AiProviderFailureReason.INVALID_RESPONSE);
  const choices: unknown = runtime.choices;
  const choice = Array.isArray(choices) ? (choices as unknown[])[0] : null;
  const rawMessage = record(choice) ? choice.message : null;
  // Google's compatibility API documents `model` for function-call responses.
  // Normalize only that documented Gemini role; every other shape stays invalid.
  const message =
    provider === 'gemini' &&
    record(rawMessage) &&
    rawMessage.role === 'model' &&
    Array.isArray(rawMessage.tool_calls)
      ? { ...rawMessage, role: 'assistant' }
      : rawMessage;
  if (
    !validMessage(message) ||
    typeof runtime.model !== 'string' ||
    !runtime.model.trim() ||
    runtime.model.length > 200
  )
    throw new AiProviderFailure(AiProviderFailureReason.INVALID_RESPONSE);
  const usage = record(runtime.usage) ? runtime.usage : null;
  return {
    message,
    model: runtime.model,
    promptTokens: safeInteger(usage?.prompt_tokens),
    completionTokens: safeInteger(usage?.completion_tokens),
    totalTokens: safeInteger(usage?.total_tokens),
    ...(provider === 'openrouter'
      ? { providerCostUsdMicros: costMicros(usage?.cost) }
      : {}),
    provider,
  };
}
