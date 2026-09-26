import { ConfigService } from '@nestjs/config';
import { APIConnectionTimeoutError, APIError } from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { AiProviderFailureReason } from './ai-model-client';
import { GeminiClientService } from './gemini-client.service';

function fixture(enabled = true, mockClient = true) {
  const values: Record<string, unknown> = {
    GEMINI_ENABLED: enabled,
    GEMINI_API_KEY: 'fixture-private-key-not-for-network',
    GEMINI_MODEL: 'gemini-3.5-flash-lite',
    GEMINI_TIMEOUT_MS: 10000,
    GEMINI_MAX_OUTPUT_TOKENS: 2048,
  };
  const config = {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
  const service = new GeminiClientService(config);
  const create = jest.fn();
  if (enabled && mockClient)
    (service as unknown as { client: unknown }).client = {
      chat: { completions: { create } },
    };
  return { service, create, values };
}

const tools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_company_statistics',
      description: 'Read tenant statistics',
      parameters: { type: 'object', properties: {} },
    },
  },
];

describe('GeminiClientService', () => {
  it('uses direct Google endpoint configuration and server-selected model', () => {
    const { service } = fixture(true, false);
    const client = (service as unknown as { client: { baseURL: string } })
      .client;
    expect(client.baseURL).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/',
    );
  });

  it('normalizes text and usage without inventing a provider cost', async () => {
    const { service, create, values } = fixture();
    create.mockResolvedValue({
      model: 'gemini-3.5-flash-lite',
      choices: [{ message: { role: 'assistant', content: 'fixture answer' } }],
      usage: { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20 },
    });
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: 'fixture instruction' },
      { role: 'user', content: 'fixture question' },
    ];
    const signal = AbortSignal.timeout(1000);
    await expect(service.complete(messages, tools, signal)).resolves.toEqual({
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      message: { role: 'assistant', content: 'fixture answer' },
      promptTokens: 13,
      completionTokens: 7,
      totalTokens: 20,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: values.GEMINI_MODEL,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 2048,
        reasoning_effort: 'low',
      }),
      { signal },
    );
    expect(JSON.stringify(create.mock.calls)).not.toContain(
      values.GEMINI_API_KEY as string,
    );
  });

  it('preserves Gemini thought signatures and supplies function name with tool results', async () => {
    const { service, create } = fixture();
    const assistant = {
      role: 'assistant' as const,
      content: null,
      tool_calls: [
        {
          type: 'function' as const,
          id: 'call-1',
          function: { name: 'get_company_statistics', arguments: '{}' },
          extra_content: { google: { thought_signature: 'opaque-fixture' } },
        },
      ],
    };
    create.mockResolvedValueOnce({
      model: 'gemini-3.5-flash-lite',
      choices: [{ message: assistant }],
    });
    const first = await service.complete(
      [{ role: 'user', content: 'fixture question' }],
      tools,
      AbortSignal.timeout(1000),
    );
    expect(first.message.tool_calls?.[0]).toMatchObject({
      extra_content: { google: { thought_signature: 'opaque-fixture' } },
    });
    create.mockResolvedValueOnce({
      model: 'gemini-3.5-flash-lite',
      choices: [{ message: { role: 'assistant', content: '12 uploads left' } }],
    });
    await service.complete(
      [
        { role: 'user', content: 'fixture question' },
        first.message,
        { role: 'tool', tool_call_id: 'call-1', content: '{"remaining":12}' },
      ],
      tools,
      AbortSignal.timeout(1000),
    );
    const calls: unknown = create.mock.calls;
    const request = (calls as Array<Array<{ messages: unknown[] }>>)[1][0];
    expect(request.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          name: 'get_company_statistics',
          tool_call_id: 'call-1',
        }),
      ]),
    );
    expect(request.messages[1]).toMatchObject({
      ...assistant,
      role: 'model',
    });
  });

  it('normalizes the documented Gemini model role for function calls', async () => {
    const { service, create } = fixture();
    create.mockResolvedValue({
      model: 'gemini-3.5-flash-lite',
      choices: [
        {
          message: {
            role: 'model',
            content: null,
            tool_calls: [
              {
                type: 'function',
                id: 'call-1',
                function: { name: 'get_company_statistics', arguments: '{}' },
              },
            ],
          },
        },
      ],
    });
    await expect(
      service.complete([], tools, AbortSignal.timeout(1000)),
    ).resolves.toMatchObject({ message: { role: 'assistant' } });
  });

  it.each([
    { model: 'gemini-3.5-flash-lite', choices: [] },
    {
      model: 'gemini-3.5-flash-lite',
      choices: [{ message: { role: 'assistant', content: [] } }],
    },
    {
      model: 'gemini-3.5-flash-lite',
      choices: [
        { message: { role: 'assistant', content: null, tool_calls: [{}] } },
      ],
    },
  ])('rejects malformed provider responses', async (response) => {
    const { service, create } = fixture();
    create.mockResolvedValue(response);
    await expect(
      service.complete([], tools, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({
      reason: AiProviderFailureReason.INVALID_RESPONSE,
    });
  });

  it.each([
    [429, AiProviderFailureReason.RATE_LIMIT],
    [503, AiProviderFailureReason.UNAVAILABLE],
    [401, AiProviderFailureReason.AUTHENTICATION],
  ])('sanitizes Gemini HTTP %i failure', async (status, reason) => {
    const { service, create } = fixture();
    create.mockRejectedValue(
      APIError.generate(
        status,
        { error: { message: 'private provider payload' } },
        'private provider payload',
        new Headers(),
      ),
    );
    await expect(
      service.complete([], tools, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ reason, status });
  });

  it('sanitizes timeout and refuses disabled operation', async () => {
    const { service, create } = fixture();
    create.mockRejectedValue(new APIConnectionTimeoutError());
    await expect(
      service.complete([], tools, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ reason: AiProviderFailureReason.TIMEOUT });
    await expect(
      fixture(false).service.complete([], tools, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ reason: AiProviderFailureReason.UNAVAILABLE });
  });
});
