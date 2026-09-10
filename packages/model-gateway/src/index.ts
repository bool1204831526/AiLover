export type ModelProbeRequest = {
  provider: 'openai-compatible' | 'ollama';
  endpoint: string;
  apiKey?: string;
};

export type ModelProbeResult = {
  ok: boolean;
  latencyMs: number;
  models: string[];
  message: string;
};

export type FetchLike = typeof fetch;

export async function probeModelProvider(
  request: ModelProbeRequest,
  fetcher: FetchLike = fetch,
): Promise<ModelProbeResult> {
  const startedAt = Date.now();
  try {
    const base = request.endpoint.replace(/\/+$/, '');
    const url = request.provider === 'ollama' ? `${base}/api/tags` : `${base}/models`;
    const headers = new Headers({ Accept: 'application/json' });
    if (request.provider === 'openai-compatible' && request.apiKey) {
      headers.set('Authorization', `Bearer ${request.apiKey}`);
    }
    const response = await fetcher(url, { method: 'GET', headers, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      return { ok: false, latencyMs: Date.now() - startedAt, models: [],
        message: `服务返回 HTTP ${response.status}` };
    }
    const payload: unknown = await response.json();
    const models = extractModels(request.provider, payload);
    return { ok: true, latencyMs: Date.now() - startedAt, models,
      message: models.length ? `连接成功，发现 ${models.length} 个模型` : '连接成功，但未发现模型' };
  } catch (error) {
    const message = error instanceof Error && error.name === 'TimeoutError'
      ? '连接超时，请检查服务地址' : '无法连接模型服务';
    return { ok: false, latencyMs: Date.now() - startedAt, models: [], message };
  }
}

function extractModels(provider: ModelProbeRequest['provider'], payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const list = provider === 'ollama'
    ? (payload as { models?: unknown }).models : (payload as { data?: unknown }).data;
  if (!Array.isArray(list)) return [];
  const names = list.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = provider === 'ollama'
      ? (item as { name?: unknown }).name : (item as { id?: unknown }).id;
    return typeof candidate === 'string' ? [candidate] : [];
  });
  return [...new Set(names)].sort();
}
