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

export type ImageCapabilityResult = {
  analysis: boolean; generation: boolean; provider: string | null; reason: string;
};

export type ImageInput = { mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; data: Uint8Array };
export type AppearanceDescription = { description: string; provider: string; model: string };
export type ImageGenerationRequest = { prompt: string; negativePrompt?: string; reference?: ImageInput };
export type GeneratedAsset = { mimeType: ImageInput['mimeType']; data: Uint8Array; metadata: Record<string, unknown> };

export interface ImageModel {
  describe(image: ImageInput): Promise<AppearanceDescription>;
  generate(request: ImageGenerationRequest): Promise<GeneratedAsset[]>;
}

export function inferImageCapabilities(
  provider: ModelProbeRequest['provider'], models: string[],
): ImageCapabilityResult {
  const names = models.map((model) => model.toLowerCase());
  const analysis = names.some((name) => /(vision|vl|llava|gemma3|gpt-4o|gpt-4\.1)/.test(name));
  const generation = provider === 'openai-compatible'
    && names.some((name) => /(gpt-image|dall-e|flux|stable.?diffusion|(^|\/)sd[xl-])/.test(name));
  const available = [analysis ? '参考图分析' : '', generation ? '图片生成' : ''].filter(Boolean).join('和');
  return { analysis, generation, provider,
    reason: available ? `检测到${available}能力` : '当前模型服务未检测到图片能力，可继续使用本地导入' };
}

export type FetchLike = typeof fetch;

export type ModelChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ModelChatRequest = ModelProbeRequest & {
  model: string;
  messages: ModelChatMessage[];
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type StructuredMemoryExtractionRequest = ModelChatRequest & { sourceText: string };
export type CharacterLoreGenerationRequest = ModelProbeRequest & {
  model: string;
  seed: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function requestCharacterLore(
  request: CharacterLoreGenerationRequest,
  fetcher: FetchLike = fetch,
): Promise<unknown> {
  const base = request.endpoint.replace(/\/+$/, '');
  const url = request.provider === 'ollama' ? `${base}/api/chat` : `${base}/chat/completions`;
  const headers = new Headers({ Accept: 'application/json', 'Content-Type': 'application/json' });
  if (request.provider === 'openai-compatible' && request.apiKey) headers.set('Authorization', `Bearer ${request.apiKey}`);
  const messages: ModelChatMessage[] = [{ role: 'system', content: [
    '根据用户已填写的角色资料，补全一份具有完整人生连续性的虚构角色设定。',
    '只输出 JSON 对象，且只能包含 originWorld, lifeStory, worldview, coreMotivations, knowledgeBoundaries, arrivalStory 六个字符串字段。',
    '保持用户提供的姓名、身份、背景、性格和说话方式，不得改写其核心含义。',
    '角色在来到本应用前已经真实生活过；arrivalStory 必须描述一次召唤、次元裂缝或合理的跨世界事件，使角色来到 AiLover。',
    '设定应具体、相互一致，不引用语言模型、提示词、角色扮演或生成过程。知识边界应说明角色确信什么、不了解什么，避免全知。',
  ].join('\n') }, { role: 'user', content: JSON.stringify(request.seed) }];
  const body = request.provider === 'ollama'
    ? { model: request.model, messages, stream: false, format: 'json' }
    : { model: request.model, messages, stream: false, response_format: { type: 'json_object' } };
  const timeoutSignal = AbortSignal.timeout(request.timeoutMs ?? 45_000);
  const signal = request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  try {
    response = await fetcher(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (error) {
    if (request.signal?.aborted) throw error;
    if (timeoutSignal.aborted) throw new ModelGatewayError('角色背景生成超时，请重试。', true);
    throw new ModelGatewayError('无法连接模型服务生成角色背景。', true);
  }
  if (!response.ok) throw new ModelGatewayError(`角色背景服务返回 HTTP ${response.status}。`,
    response.status === 408 || response.status === 429 || response.status >= 500);
  const payload = await response.json() as { choices?: { message?: { content?: unknown } }[]; message?: { content?: unknown } };
  const content = request.provider === 'ollama' ? payload.message?.content : payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new ModelGatewayError('角色背景服务返回格式无效。', false);
  try {
    const parsed: unknown = JSON.parse(content);
    return parsed && typeof parsed === 'object' && 'lore' in parsed ? (parsed as { lore: unknown }).lore : parsed;
  } catch { throw new ModelGatewayError('角色背景服务返回的 JSON 无效。', false); }
}

/** Fetches a bounded JSON proposal payload without putting extraction on the streaming chat path. */
export async function requestStructuredMemoryProposals(
  request: StructuredMemoryExtractionRequest,
  fetcher: FetchLike = fetch,
): Promise<unknown> {
  const base = request.endpoint.replace(/\/+$/, '');
  const url = request.provider === 'ollama' ? `${base}/api/chat` : `${base}/chat/completions`;
  const headers = new Headers({ Accept: 'application/json', 'Content-Type': 'application/json' });
  if (request.provider === 'openai-compatible' && request.apiKey) headers.set('Authorization', `Bearer ${request.apiKey}`);
  const messages: ModelChatMessage[] = [
    { role: 'system', content: '从用户原文提取记忆候选。只输出 {"proposals":[]} JSON 对象，数组每项包含 type, subject, polarity, confidence, importance, emotionalWeight, evidenceQuote, expiresAt。最多 6 项，不要补充原文没有的事实。' },
    { role: 'user', content: request.sourceText },
  ];
  const body = request.provider === 'ollama'
    ? { model: request.model, messages, stream: false, format: 'json' }
    : { model: request.model, messages, stream: false, response_format: { type: 'json_object' } };
  const timeoutSignal = AbortSignal.timeout(request.timeoutMs ?? 20_000);
  const signal = request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  try {
    response = await fetcher(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (error) {
    if (request.signal?.aborted) throw error;
    if (timeoutSignal.aborted) throw new ModelGatewayError('结构化记忆提取超时。', true);
    throw new ModelGatewayError('无法连接模型服务进行结构化记忆提取。', true);
  }
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new ModelGatewayError(`结构化记忆服务返回 HTTP ${response.status}。`, retryable);
  }
  const payload = await response.json() as { choices?: { message?: { content?: unknown } }[]; message?: { content?: unknown } };
  const content = request.provider === 'ollama' ? payload.message?.content : payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new ModelGatewayError('结构化记忆服务返回格式无效。', false);
  try {
    const parsed: unknown = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { proposals?: unknown }).proposals)) {
      return (parsed as { proposals: unknown[] }).proposals;
    }
    throw new ModelGatewayError('结构化记忆服务没有返回候选数组。', false);
  } catch (error) {
    if (error instanceof ModelGatewayError) throw error;
    throw new ModelGatewayError('结构化记忆服务返回的 JSON 无效。', false);
  }
}

export class ModelGatewayError extends Error {
  public constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = 'ModelGatewayError';
  }
}

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

export async function* streamModelChat(
  request: ModelChatRequest,
  fetcher: FetchLike = fetch,
): AsyncIterable<string> {
  const base = request.endpoint.replace(/\/+$/, '');
  const url = request.provider === 'ollama' ? `${base}/api/chat` : `${base}/chat/completions`;
  const headers = new Headers({ Accept: 'text/event-stream', 'Content-Type': 'application/json' });
  if (request.provider === 'openai-compatible' && request.apiKey) {
    headers.set('Authorization', `Bearer ${request.apiKey}`);
  }
  const timeoutSignal = AbortSignal.timeout(request.timeoutMs ?? 90_000);
  const signal = request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal;
  const body = request.provider === 'ollama'
    ? { model: request.model, messages: request.messages, stream: true }
    : { model: request.model, messages: request.messages, stream: true };
  let response: Response;
  try {
    response = await fetcher(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (error) {
    if (request.signal?.aborted) throw error;
    if (timeoutSignal.aborted) throw new ModelGatewayError('模型响应超时，请重试。', true);
    throw new ModelGatewayError('无法连接模型服务，请检查设置后重试。', true);
  }
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new ModelGatewayError(`模型服务返回 HTTP ${response.status}。`, retryable);
  }
  if (!response.body) throw new ModelGatewayError('模型服务没有返回可读取的内容。', true);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? '' : lines.pop() ?? '';
      for (const line of lines) {
        const chunk = parseStreamLine(request.provider, line);
        if (chunk) yield chunk;
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const chunk = parseStreamLine(request.provider, buffer);
      if (chunk) yield chunk;
    }
  } catch (error) {
    if (request.signal?.aborted) throw error;
    if (timeoutSignal.aborted) throw new ModelGatewayError('模型响应超时，请重试。', true);
    throw new ModelGatewayError('模型连接意外中断，请重试。', true);
  }
}

function parseStreamLine(provider: ModelProbeRequest['provider'], line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '';
  const raw = provider === 'openai-compatible' && trimmed.startsWith('data:')
    ? trimmed.slice(5).trim() : trimmed;
  if (!raw || raw === '[DONE]') return '';
  try {
    const payload = JSON.parse(raw) as {
      choices?: { delta?: { content?: unknown }; message?: { content?: unknown } }[];
      message?: { content?: unknown };
    };
    const content = provider === 'ollama'
      ? payload.message?.content
      : payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  } catch {
    return '';
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
