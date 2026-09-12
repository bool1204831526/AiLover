import { describe, expect, it } from 'vitest';

import { inferImageCapabilities, probeModelProvider, requestStructuredMemoryProposals, streamModelChat } from './index';

describe('inferImageCapabilities', () => {
  it('detects image abilities independently from chat connectivity', () => {
    expect(inferImageCapabilities('openai-compatible', ['gpt-4.1-mini', 'gpt-image-1']))
      .toMatchObject({ analysis: true, generation: true });
    expect(inferImageCapabilities('ollama', ['qwen3:8b']))
      .toMatchObject({ analysis: false, generation: false });
  });
});

describe('probeModelProvider', () => {
  it('probes an OpenAI-compatible endpoint without sending prompts', async () => {
    let receivedUrl = '';
    let receivedOptions: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, options) => {
      receivedUrl = input.toString();
      receivedOptions = options;
      return new Response(JSON.stringify({ data: [{ id: 'gpt-test' }] }), { status: 200 });
    };
    const result = await probeModelProvider({ provider: 'openai-compatible', endpoint: 'https://example.test/v1', apiKey: 'secret' }, fetcher);
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['gpt-test']);
    expect(receivedUrl).toBe('https://example.test/v1/models');
    expect(receivedOptions?.method).toBe('GET');
    expect((receivedOptions?.headers as Headers).get('Authorization')).toBe('Bearer secret');
    expect(receivedOptions?.body).toBeUndefined();
  });

  it('uses the Ollama tags endpoint without credentials', async () => {
    let receivedUrl = '';
    let receivedOptions: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, options) => {
      receivedUrl = input.toString();
      receivedOptions = options;
      return new Response(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }), { status: 200 });
    };
    const result = await probeModelProvider({ provider: 'ollama', endpoint: 'http://127.0.0.1:11434' }, fetcher);
    expect(result.models).toEqual(['qwen3:8b']);
    expect(receivedUrl).toBe('http://127.0.0.1:11434/api/tags');
    expect((receivedOptions?.headers as Headers).has('Authorization')).toBe(false);
  });
});

describe('streamModelChat', () => {
  it('classifies provider throttling as retryable without returning partial content', async () => {
    const consume = async () => {
      for await (const chunk of streamModelChat({ provider: 'openai-compatible',
        endpoint: 'https://example.test/v1', model: 'model-a', messages: [] },
      async () => new Response('', { status: 429 }))) expect(chunk).toBe('');
    };
    await expect(consume()).rejects.toMatchObject({ retryable: true });
  });

  it('parses OpenAI-compatible SSE chunks split across network reads', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"你'));
        controller.enqueue(encoder.encode('好"}}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    });
    const fetcher: typeof fetch = async () => new Response(body, { status: 200 });
    const chunks: string[] = [];
    for await (const chunk of streamModelChat({ provider: 'openai-compatible',
      endpoint: 'https://example.test/v1', model: 'model-a', messages: [] }, fetcher)) chunks.push(chunk);
    expect(chunks).toEqual(['你好']);
  });

  it('parses Ollama newline-delimited JSON chunks', async () => {
    const fetcher: typeof fetch = async () => new Response(
      '{"message":{"content":"早"}}\n{"message":{"content":"上"},"done":true}\n', { status: 200 });
    const chunks: string[] = [];
    for await (const chunk of streamModelChat({ provider: 'ollama', endpoint: 'http://localhost:11434',
      model: 'qwen', messages: [] }, fetcher)) chunks.push(chunk);
    expect(chunks.join('')).toBe('早上');
  });
});

describe('requestStructuredMemoryProposals', () => {
  it('requests non-streaming JSON from OpenAI-compatible services', async () => {
    let body = '';
    const result = await requestStructuredMemoryProposals({ provider: 'openai-compatible', endpoint: 'https://example.test/v1', model: 'model-a', messages: [], sourceText: '我喜欢咖啡' }, async (_url, options) => {
      body = String(options?.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: '[{"type":"preference"}]' } }] }), { status: 200 });
    });
    expect(result).toEqual([{ type: 'preference' }]);
    expect(body).toContain('"stream":false');
    expect(body).toContain('response_format');
  });

  it('parses Ollama JSON and classifies server errors as retryable', async () => {
    const result = await requestStructuredMemoryProposals({ provider: 'ollama', endpoint: 'http://localhost:11434', model: 'qwen', messages: [], sourceText: '我喜欢咖啡' }, async () => new Response(JSON.stringify({ message: { content: '[]' } }), { status: 200 }));
    expect(result).toEqual([]);
    await expect(requestStructuredMemoryProposals({ provider: 'ollama', endpoint: 'http://localhost:11434', model: 'qwen', messages: [], sourceText: 'x' }, async () => new Response('', { status: 503 }))).rejects.toMatchObject({ retryable: true });
  });
});
