import { describe, expect, it } from 'vitest';

import { probeModelProvider } from './index';

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
