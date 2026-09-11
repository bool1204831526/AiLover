import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  Heart, MessageCircle, RotateCcw, SendHorizontal, Settings, SlidersHorizontal, Square, UserRound, X,
} from 'lucide-react';

import type {
  BootstrapResponse, CharacterDraftInput, CharacterSnapshot, ChatMessage, ChatStreamEvent,
  ModelConnectionResult, ModelProfileInput, RelationshipSummary,
} from '@ailover/contracts';

const navigation = [
  { id: 'chat', label: '对话', icon: MessageCircle }, { id: 'character', label: '角色', icon: UserRound },
  { id: 'relationship', label: '关系', icon: Heart }, { id: 'settings', label: '设置', icon: Settings },
];
const templates = [
  { id: 'gentle', name: '温柔', description: '体贴、平和，善于倾听' },
  { id: 'energetic', name: '元气', description: '热情、活泼，充满行动力' },
  { id: 'reserved', name: '高冷', description: '克制、安静，慢热而真诚' },
  { id: 'tsundere', name: '傲娇', description: '嘴硬心软，有些小别扭' },
  { id: 'mature', name: '成熟', description: '沉稳可靠，富有包容力' },
  { id: 'rational', name: '理性', description: '清晰冷静，尊重事实' },
] as const;
const emptyDraft: CharacterDraftInput = {
  name: '', gender: '女', ageSetting: '成年', identity: '你的 AI 伴侣', background: '',
  appearance: '', speakingStyle: '', personalityTemplateId: 'gentle',
};

export function App(): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [character, setCharacter] = useState<CharacterSnapshot | null>(null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [draft, setDraft] = useState<CharacterDraftInput>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState('chat');

  useEffect(() => {
    const api = window.ailover;
    if (!api) {
      setBootstrap({ appVersion: 'preview', platform: 'win32', environment: 'development',
        dataPath: 'browser-preview', capabilities: { character: true, chat: false, memory: false },
        currentCharacter: null });
      return;
    }
    void api.bootstrap().then((result) => {
      setBootstrap(result);
      setCharacter(result.currentCharacter);
    }).catch(() => setError('应用初始化失败，请重新启动。'));
  }, []);

  async function submitCharacter(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = window.ailover ? await window.ailover.character.create(draft) : previewCharacter(draft);
      setCharacter(created);
      setCreatorOpen(false);
    } catch {
      setError('角色创建失败，请检查填写内容后重试。');
    } finally {
      setSaving(false);
    }
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand-mark" aria-label="AiLover"><span className="brand-symbol">A</span><span>AiLover</span></div>
      <nav aria-label="主导航">{navigation.map(({ id, label, icon: Icon }) =>
        <button className={activeSection === id ? 'nav-item active' : 'nav-item'} key={id} type="button"
          onClick={() => setActiveSection(id)}>
          <Icon aria-hidden="true" size={18} strokeWidth={1.8} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-footer"><span className={error ? 'status-dot error' : 'status-dot'} />
        <span>{error ? '操作失败' : bootstrap ? '本地服务就绪' : '正在启动'}</span></div>
    </aside>
    <section className="character-panel" aria-label="当前角色">
      {character ? <CharacterPortrait character={character} /> : <div className="character-placeholder">
        <div className="portrait-ring"><UserRound aria-hidden="true" size={54} strokeWidth={1.25} /></div>
        <h1>尚未创建角色</h1><p>你的第一位 AI Lover 将出现在这里。</p>
        <button className="primary-action" onClick={() => setCreatorOpen(true)} type="button">创建角色</button>
      </div>}
    </section>
    <section className="conversation-panel">
      {activeSection === 'settings' ? <ModelSettings /> : activeSection === 'relationship'
        ? <RelationshipView character={character} /> : <>
        <header className="conversation-header"><div><span className="eyebrow">当前对话</span>
          <h2>{character ? `与${character.name}的对话` : '新的相遇'}</h2></div>
          <button className="icon-button" type="button" aria-label="对话设置" title="对话设置">
            <SlidersHorizontal aria-hidden="true" size={19} /></button></header>
        <ChatView character={character} bootstrapError={error} />
      </>}
    </section>
    {creatorOpen && <CharacterCreator draft={draft} saving={saving} error={error} onChange={setDraft}
      onClose={() => setCreatorOpen(false)} onSubmit={submitCharacter} />}
  </main>;
}

function RelationshipView({ character }: { character: CharacterSnapshot | null }): React.JSX.Element {
  const [summary, setSummary] = useState<RelationshipSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSummary(null);
    setFailed(false);
    if (!character || !window.ailover) return;
    void window.ailover.relationship.getSummary().then(setSummary).catch(() => setFailed(true));
  }, [character?.id]);

  return <><header className="conversation-header"><div><span className="eyebrow">你们的关系</span>
    <h2>{character ? `你与${character.name}` : '尚未相遇'}</h2></div></header>
    <div className="relationship-page">{!character ? <div className="relationship-empty">
      <Heart size={28} strokeWidth={1.5} aria-hidden="true" /><p>创建角色后，这里会记录你们关系的变化。</p>
    </div> : failed ? <div className="relationship-empty"><p>暂时无法读取关系状态。</p></div>
      : summary ? <section className="relationship-summary">
        <span className="profile-kicker">当前关系</span><h3>{summary.headline}</h3>
        <p>{summary.description}</p><div className="relationship-mood"><strong>此刻的相处</strong>
          <span>{summary.mood}</span></div>
        <small>更新于 {new Date(summary.updatedAt).toLocaleString('zh-CN')}</small>
      </section> : <div className="relationship-empty"><p>正在整理你们的相处状态…</p></div>}</div></>;
}

function ChatView({ character, bootstrapError }: {
  character: CharacterSnapshot | null; bootstrapError: string | null;
}): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]);
    setChatError(null);
    if (!character || !window.ailover) return;
    void window.ailover.conversation.load().then(({ messages: restored }) => setMessages(restored))
      .catch(() => setChatError('无法读取聊天记录。'));
  }, [character?.id]);

  useEffect(() => {
    if (!window.ailover) return;
    return window.ailover.chat.onStream((event) => handleStreamEvent(event));
  }, []);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [messages]);

  function handleStreamEvent(event: ChatStreamEvent): void {
    if (event.type === 'chunk') {
      setMessages((current) => current.map((message) => message.id === event.messageId
        ? { ...message, content: message.content + event.delta } : message));
      return;
    }
    setMessages((current) => current.map((message) => message.id === event.message.id
      ? event.message : message));
    setRequestId(null);
    if (event.type === 'failed') setChatError(event.error);
    else if (event.type === 'cancelled') setChatError('已停止生成。');
  }

  async function sendText(text: string): Promise<void> {
    const content = text.trim();
    if (!content || !character || requestId) return;
    setChatError(null);
    setDraft('');
    setRequestId('pending');
    try {
      if (!window.ailover) throw new Error('聊天服务不可用');
      const receipt = await window.ailover.chat.send({ text: content, clientMessageId: crypto.randomUUID() });
      setMessages((current) => [...current, receipt.userMessage, receipt.assistantMessage]);
      setRequestId(receipt.requestId);
    } catch {
      setDraft(content);
      setRequestId(null);
      setChatError('消息未能发送，请检查模型设置后重试。');
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendText(draft);
    }
  }

  const retryMessage = (assistantId: string) => {
    const index = messages.findIndex(({ id }) => id === assistantId);
    const previous = index > 0 ? messages[index - 1] : undefined;
    if (previous?.role === 'user') void sendText(previous.content);
  };

  return <>
    <div className={messages.length ? 'message-list' : 'empty-conversation'}>
      {!messages.length ? <><MessageCircle aria-hidden="true" size={30} strokeWidth={1.5} />
        <p>{bootstrapError ?? chatError ?? (character
          ? `${character.name}已经准备好。说点什么，开始你们的第一段对话。`
          : '创建角色后，即可开始你们的第一段对话。')}</p></> : messages.map((message) =>
        <article className={`message-row ${message.role}`} key={message.id}>
          <div className={`message-bubble ${message.status}`}>
            <span className="message-author">{message.role === 'user' ? '你' : character?.name}</span>
            <p>{message.content || (message.status === 'streaming' ? '正在思考…' : '未能生成回复')}</p>
            {message.status === 'failed' && <button className="retry-button" type="button"
              onClick={() => retryMessage(message.id)} title="重新发送上一条消息">
              <RotateCcw size={13} aria-hidden="true" />重新发送</button>}
          </div>
        </article>)}
      <div ref={endRef} />
    </div>
    {messages.length > 0 && chatError && <div className="chat-notice" role="status">{chatError}</div>}
    <div className="composer" aria-label="消息输入区"><textarea aria-label="消息" value={draft}
      disabled={!character} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKeyDown}
      placeholder={character ? `给${character.name}发消息` : '先创建一位角色'} rows={1} maxLength={8000} />
      {requestId ? <button aria-label="停止生成" title="停止生成" type="button"
        onClick={() => requestId !== 'pending' && void window.ailover?.chat.cancel(requestId)}>
        <Square size={16} fill="currentColor" aria-hidden="true" /></button>
        : <button aria-label="发送消息" title="发送消息" disabled={!character || !draft.trim()} type="button"
          onClick={() => void sendText(draft)}><SendHorizontal size={18} aria-hidden="true" /></button>}
    </div>
  </>;
}

function ModelSettings(): React.JSX.Element {
  const [profile, setProfile] = useState<ModelProfileInput>({
    provider: 'openai-compatible', endpoint: 'https://api.openai.com/v1', model: 'gpt-4.1-mini',
  });
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [result, setResult] = useState<ModelConnectionResult | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);

  useEffect(() => {
    const api = window.ailover;
    if (!api) return;
    void api.modelProfile.get().then((saved) => {
      if (!saved) return;
      setProfile({ provider: saved.provider, endpoint: saved.endpoint, model: saved.model });
      setHasSavedKey(saved.hasApiKey);
    });
  }, []);

  const updateProvider = (provider: ModelProfileInput['provider']) => {
    setResult(null);
    setProfile({ provider,
      endpoint: provider === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.openai.com/v1',
      model: provider === 'ollama' ? 'qwen3:8b' : 'gpt-4.1-mini' });
    if (provider === 'ollama') setHasSavedKey(false);
  };

  async function testConnection(): Promise<void> {
    setBusy('test');
    try {
      setResult(window.ailover ? await window.ailover.modelProfile.test(profile)
        : { ok: true, latencyMs: 86, models: [profile.model], message: '预览模式：配置格式有效' });
    } catch {
      setResult({ ok: false, latencyMs: 0, models: [], message: '配置无效或服务不可用' });
    } finally { setBusy(null); }
  }

  async function saveProfile(): Promise<void> {
    setBusy('save');
    try {
      if (window.ailover) {
        const saved = await window.ailover.modelProfile.save(profile);
        setHasSavedKey(saved.hasApiKey);
      }
      setProfile((current) => ({ provider: current.provider, endpoint: current.endpoint, model: current.model }));
      setResult({ ok: true, latencyMs: 0, models: [], message: '配置已安全保存' });
    } catch {
      setResult({ ok: false, latencyMs: 0, models: [], message: '无法保存配置' });
    } finally { setBusy(null); }
  }

  return <><header className="conversation-header"><div><span className="eyebrow">应用设置</span>
    <h2>模型服务</h2></div></header><div className="settings-page"><section className="settings-section">
      <div className="settings-heading"><h3>聊天模型</h3><p>选择本地模型，或连接兼容 OpenAI API 的服务。</p></div>
      <div className="provider-switch" aria-label="模型提供方">
        <button className={profile.provider === 'openai-compatible' ? 'selected' : ''} type="button"
          onClick={() => updateProvider('openai-compatible')}>OpenAI Compatible</button>
        <button className={profile.provider === 'ollama' ? 'selected' : ''} type="button"
          onClick={() => updateProvider('ollama')}>Ollama</button>
      </div>
      <label><span>服务地址</span><input type="url" value={profile.endpoint}
        onChange={(e) => setProfile({ ...profile, endpoint: e.target.value })} /></label>
      <label><span>模型名称</span><input value={profile.model}
        onChange={(e) => setProfile({ ...profile, model: e.target.value })} /></label>
      {profile.provider === 'openai-compatible' && <label><span>API Key</span>
        <input type="password" value={profile.apiKey ?? ''} placeholder={hasSavedKey ? '已加密保存；留空表示不更改' : '输入服务密钥'}
          onChange={(e) => setProfile({ ...profile, apiKey: e.target.value || undefined })} />
        <small>{hasSavedKey ? '现有密钥由 Windows 加密保护。' : '密钥只会加密保存在这台电脑上。'}</small></label>}
      {result && <div className={result.ok ? 'connection-result success' : 'connection-result error'}>
        <strong>{result.ok ? '连接状态正常' : '连接失败'}</strong><span>{result.message}{result.latencyMs ? ` · ${result.latencyMs} ms` : ''}</span></div>}
      <div className="settings-actions"><button className="secondary-action" disabled={busy !== null}
        onClick={() => void testConnection()} type="button">{busy === 'test' ? '正在测试' : '测试连接'}</button>
        <button className="primary-action" disabled={busy !== null || !profile.endpoint || !profile.model}
          onClick={() => void saveProfile()} type="button">{busy === 'save' ? '正在保存' : '保存配置'}</button></div>
    </section></div></>;
}

function CharacterPortrait({ character }: { character: CharacterSnapshot }): React.JSX.Element {
  const template = templates.find(({ id }) => id === character.personalityTemplateId);
  return <div className="character-profile">
    <div className="portrait-ring portrait-created"><span>{character.name.slice(0, 1)}</span></div>
    <span className="profile-kicker">你的 AI Lover</span><h1>{character.name}</h1>
    <p className="character-identity">{character.identity}</p>
    <div className="profile-tags"><span>{template?.name}</span><span>{character.gender}</span><span>{character.ageSetting}</span></div>
    <dl><div><dt>外貌</dt><dd>{character.appearance}</dd></div>
      <div><dt>说话方式</dt><dd>{character.speakingStyle}</dd></div></dl>
  </div>;
}

type CreatorProps = {
  draft: CharacterDraftInput; saving: boolean; error: string | null;
  onChange(draft: CharacterDraftInput): void; onClose(): void;
  onSubmit(event: FormEvent<HTMLFormElement>): Promise<void>;
};

function CharacterCreator({ draft, saving, error, onChange, onClose, onSubmit }: CreatorProps): React.JSX.Element {
  const update = <K extends keyof CharacterDraftInput>(key: K, value: CharacterDraftInput[K]) =>
    onChange({ ...draft, [key]: value });
  const complete = draft.name.trim() && draft.identity.trim() && draft.appearance.trim() && draft.speakingStyle.trim();
  return <div className="modal-backdrop" role="presentation"><section className="creator-dialog" role="dialog"
    aria-modal="true" aria-labelledby="creator-title">
    <header><div><span className="eyebrow">创建角色</span><h2 id="creator-title">定义你们的第一次相遇</h2></div>
      <button className="icon-button" onClick={onClose} type="button" aria-label="关闭创建向导"><X size={20} /></button></header>
    <form onSubmit={(event) => void onSubmit(event)}><div className="form-scroll">
      <div className="form-grid two-column">
        <label><span>名字</span><input required maxLength={40} value={draft.name} placeholder="例如：艾琳"
          onChange={(e) => update('name', e.target.value)} /></label>
        <label><span>年龄设定</span><input required maxLength={40} value={draft.ageSetting}
          onChange={(e) => update('ageSetting', e.target.value)} /></label>
      </div>
      <fieldset><legend>人格基调</legend><div className="template-grid">{templates.map((template) =>
        <button key={template.id} type="button"
          className={draft.personalityTemplateId === template.id ? 'template-option selected' : 'template-option'}
          onClick={() => update('personalityTemplateId', template.id)}>
          <strong>{template.name}</strong><span>{template.description}</span></button>)}</div></fieldset>
      <div className="form-grid two-column">
        <label><span>性别设定</span><input required maxLength={30} value={draft.gender}
          onChange={(e) => update('gender', e.target.value)} /></label>
        <label><span>身份</span><input required maxLength={500} value={draft.identity}
          onChange={(e) => update('identity', e.target.value)} /></label>
      </div>
      <label><span>外貌</span><textarea required maxLength={2000} rows={3} value={draft.appearance}
        placeholder="发型、瞳色、服装、整体气质……" onChange={(e) => update('appearance', e.target.value)} /></label>
      <label><span>说话方式</span><textarea required maxLength={1000} rows={2} value={draft.speakingStyle}
        placeholder="语气、措辞习惯、称呼方式……" onChange={(e) => update('speakingStyle', e.target.value)} /></label>
      <label><span>背景故事 <small>可选</small></span><textarea maxLength={4000} rows={3} value={draft.background}
        placeholder="她从哪里来，有怎样的经历……" onChange={(e) => update('background', e.target.value)} /></label>
      {error && <p className="form-error">{error}</p>}
    </div><footer><button className="secondary-action" onClick={onClose} type="button">取消</button>
      <button className="primary-action" disabled={!complete || saving} type="submit">{saving ? '正在创建' : '确认创建'}</button></footer></form>
  </section></div>;
}

function previewCharacter(draft: CharacterDraftInput): CharacterSnapshot {
  return { ...draft, id: 'preview-character', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    personalityBaseline: { warmth: 0.8, energy: 0.5, reserve: 0.4, playfulness: 0.5,
      maturity: 0.6, rationality: 0.6, initiative: 0.5 } };
}
