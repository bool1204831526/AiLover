import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  Check, ChevronLeft, DatabaseBackup, Download, FileJson, Heart, Image, MessageCircle,
  RotateCcw, Search, SendHorizontal, Settings, ShieldCheck, SlidersHorizontal, Square, Trash2, Upload,
  UserRound, X,
} from 'lucide-react';

import type {
  BootstrapResponse, CharacterDraftInput, CharacterSnapshot, ChatMessage, ChatStreamEvent,
  CharacterVisualProfile, ImageCapabilities, ModelConnectionResult, ModelProfileInput,
  RelationshipSummary,
} from '@ailover/contracts';
import { retainRecentMessages } from '@ailover/application';

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
  const [visual, setVisual] = useState<CharacterVisualProfile | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  useEffect(() => {
    const api = window.ailover;
    if (!api) {
      setBootstrap({ appVersion: 'preview', platform: 'win32', environment: 'development',
        dataPath: 'browser-preview', capabilities: { character: true, chat: false, memory: false },
        setup: { modelConfigured: false },
        currentCharacter: null });
      setOnboardingOpen(true);
      return;
    }
    void api.bootstrap().then((result) => {
      setBootstrap(result);
      setCharacter(result.currentCharacter);
      setOnboardingOpen(!result.currentCharacter);
    }).catch(() => setError('应用初始化失败，请重新启动。'));
  }, []);

  useEffect(() => {
    setVisual(null);
    if (!character || !window.ailover) return;
    void window.ailover.visuals.get().then(setVisual).catch(() => setError('角色视觉资料读取失败。'));
  }, [character?.id]);

  async function submitCharacter(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = window.ailover ? await window.ailover.character.create(draft) : previewCharacter(draft);
      setCharacter(created);
      setCreatorOpen(false);
      setOnboardingOpen(false);
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
      {character ? <CharacterPortrait character={character} visual={visual} /> : <div className="character-placeholder">
        <div className="portrait-ring"><UserRound aria-hidden="true" size={54} strokeWidth={1.25} /></div>
        <h1>尚未创建角色</h1><p>你的第一位 AI Lover 将出现在这里。</p>
        <button className="primary-action" onClick={() => setCreatorOpen(true)} type="button">创建角色</button>
      </div>}
    </section>
    <section className="conversation-panel">
      {activeSection === 'settings' ? <ModelSettings onSaved={() =>
        setBootstrap((current) => current ? { ...current, setup: { modelConfigured: true } } : current)} />
        : activeSection === 'relationship'
        ? <RelationshipView character={character} /> : activeSection === 'character'
          ? <CharacterView character={character} visual={visual} onVisualChange={setVisual}
            onCreate={() => setCreatorOpen(true)} /> : <>
        <header className="conversation-header"><div><span className="eyebrow">当前对话</span>
          <h2>{character ? `与${character.name}的对话` : '新的相遇'}</h2></div>
          <button className="icon-button" type="button" aria-label="对话设置" title="对话设置">
            <SlidersHorizontal aria-hidden="true" size={19} /></button></header>
        <ChatView character={character} bootstrapError={error}
          modelConfigured={bootstrap?.setup.modelConfigured ?? false}
          onOpenSettings={() => setActiveSection('settings')} />
      </>}
    </section>
    {creatorOpen && <CharacterCreator draft={draft} saving={saving} error={error} onChange={setDraft}
      onClose={() => setCreatorOpen(false)} onSubmit={submitCharacter} />}
    {onboardingOpen && bootstrap && <Onboarding initialDraft={draft}
      initialModelConfigured={bootstrap.setup.modelConfigured} onDraftChange={setDraft}
      onComplete={(created, modelConfigured) => {
        setCharacter(created);
        setBootstrap((current) => current ? { ...current, setup: { modelConfigured } } : current);
        setOnboardingOpen(false);
        setActiveSection('chat');
      }} />}
  </main>;
}

function CharacterView({ character, visual, onVisualChange, onCreate }: {
  character: CharacterSnapshot | null; visual: CharacterVisualProfile | null;
  onVisualChange(value: CharacterVisualProfile | null): void; onCreate(): void;
}): React.JSX.Element {
  const [capabilities, setCapabilities] = useState<ImageCapabilities | null>(null);
  const [importing, setImporting] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.ailover) return;
    void window.ailover.visuals.getCapabilities().then(setCapabilities).catch(() =>
      setCapabilities({ analysis: false, generation: false, provider: null,
        reason: '暂时无法探测图片能力，可继续使用本地导入' }));
  }, []);

  async function importPortrait(): Promise<void> {
    if (!window.ailover || importing) return;
    setImporting(true);
    setAssetError(null);
    try { onVisualChange(await window.ailover.visuals.importPortrait()); }
    catch { setAssetError('图片导入失败，请选择 15 MB 以内的 PNG、JPEG 或 WebP 图片。'); }
    finally { setImporting(false); }
  }

  return <><header className="conversation-header"><div><span className="eyebrow">角色档案</span>
    <h2>{character?.name ?? '尚未创建角色'}</h2></div></header>
    <div className="character-page">{!character ? <div className="relationship-empty">
      <UserRound size={28} strokeWidth={1.5} aria-hidden="true" />
      <p>先创建角色，再完善她的视觉身份。</p>
      <button className="primary-action" type="button" onClick={onCreate}>创建角色</button>
    </div> : <>
      <section className="visual-asset-section">
        <div className="visual-preview">{visual?.currentAsset
          ? <img src={visual.currentAsset.dataUrl} alt={`${character.name}的角色图`} />
          : <div className="visual-empty"><Image size={32} strokeWidth={1.4} aria-hidden="true" />
            <span>尚未设置角色图</span></div>}</div>
        <div className="visual-actions"><h3>角色视觉</h3>
          <p>{visual?.identityDescription ?? character.appearance}</p>
          {visual?.currentAsset && <small>版本 {visual.currentAsset.version} · {visual.currentAsset.fileName}</small>}
          <button className="secondary-action import-action" type="button" disabled={importing}
            onClick={() => void importPortrait()}><Upload size={16} aria-hidden="true" />
            {importing ? '正在导入' : visual?.currentAsset ? '更换角色图' : '导入角色图'}</button>
          {assetError && <p className="form-error">{assetError}</p>}
        </div>
      </section>
      <section className="visual-identity-section"><span className="profile-kicker">生成一致性描述</span>
        <p>{visual?.generationPrompt}</p><small>{capabilities?.reason ?? '正在探测图片服务能力…'}</small>
        {capabilities && !capabilities.generation && <div className="capability-note">
          当前使用导入模式。图片服务不可用时，聊天功能仍可正常使用。</div>}
      </section>
    </>}</div></>;
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

function ChatView({ character, bootstrapError, modelConfigured, onOpenSettings }: {
  character: CharacterSnapshot | null; bootstrapError: string | null;
  modelConfigured: boolean; onOpenSettings(): void;
}): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[] | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]);
    setChatError(null);
    if (!character || !window.ailover) return;
    void window.ailover.conversation.load().then(({ messages: restored }) => setMessages(restored))
      .catch(() => setChatError('无法读取聊天记录。'));
  }, [character?.id]);

  async function searchMessages(event: FormEvent): Promise<void> {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query || !window.ailover) return;
    try { setSearchResults(await window.ailover.conversation.search({ query, limit: 50 })); }
    catch { setChatError('搜索聊天记录失败。'); }
  }

  useEffect(() => {
    if (!window.ailover) return;
    return window.ailover.chat.onStream((event) => handleStreamEvent(event));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

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
      setMessages((current) => retainRecentMessages(
        [...current, receipt.userMessage, receipt.assistantMessage],
      ));
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

  return <div className="chat-view">
    <form className="conversation-search" onSubmit={(event) => void searchMessages(event)}>
      <Search size={16} aria-hidden="true" />
      <input aria-label="搜索聊天记录" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)}
        placeholder="搜索聊天记录" maxLength={200} />
      {searchResults !== null && <button type="button" aria-label="关闭搜索结果" title="关闭搜索结果"
        onClick={() => { setSearchResults(null); setSearchQuery(''); }}><X size={15} /></button>}
    </form>
    {searchResults !== null && <div className="search-results" role="status">
      <div className="search-results-heading">找到 {searchResults.length} 条记录</div>
      {searchResults.map((message) => <button className="search-result" type="button" key={message.id}
        onClick={() => { setSearchResults(null); document.getElementById(`message-${message.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>
        <span>{message.role === 'user' ? '你' : character?.name} · {new Date(message.createdAt).toLocaleString('zh-CN')}</span>
        <strong>{message.content}</strong>
      </button>)}
    </div>}
    <div className={messages.length ? 'message-list' : 'empty-conversation'}>
      {!messages.length ? <><MessageCircle aria-hidden="true" size={30} strokeWidth={1.5} />
        <p>{bootstrapError ?? chatError ?? (character
          ? modelConfigured ? `${character.name}已经准备好。说点什么，开始你们的第一段对话。`
            : '角色已经准备好。配置聊天模型后，就可以开始对话。'
          : '创建角色后，即可开始你们的第一段对话。')}</p></> : messages.map((message) =>
        <article id={`message-${message.id}`} className={`message-row ${message.role}`} key={message.id}>
          <div className={`message-bubble ${message.status}`}>
            <span className="message-author">{message.role === 'user' ? '你' : character?.name}</span>
            <p>{message.content || (message.status === 'streaming' ? '正在思考…' : '未能生成回复')}</p>
            {message.status === 'failed' && <button className="retry-button" type="button"
              onClick={() => retryMessage(message.id)} title="重新发送上一条消息">
              <RotateCcw size={13} aria-hidden="true" />重新发送</button>}
          </div>
        </article>)}
      <div ref={endRef} />
      {!messages.length && character && !modelConfigured && <button className="secondary-action empty-action"
        type="button" onClick={onOpenSettings}>前往模型设置</button>}
    </div>
    {messages.length > 0 && chatError && <div className="chat-notice" role="status">{chatError}</div>}
    <div className="composer" aria-label="消息输入区"><textarea aria-label="消息" value={draft}
      disabled={!character || !modelConfigured} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKeyDown}
      placeholder={!character ? '先创建一位角色' : modelConfigured ? `给${character.name}发消息` : '请先配置聊天模型'} rows={1} maxLength={8000} />
      {requestId ? <button aria-label="停止生成" title="停止生成" type="button"
        onClick={() => requestId !== 'pending' && void window.ailover?.chat.cancel(requestId)}>
        <Square size={16} fill="currentColor" aria-hidden="true" /></button>
        : <button aria-label="发送消息" title="发送消息" disabled={!character || !modelConfigured || !draft.trim()} type="button"
          onClick={() => void sendText(draft)}><SendHorizontal size={18} aria-hidden="true" /></button>}
    </div>
  </div>;
}

function Onboarding({ initialDraft, initialModelConfigured, onDraftChange, onComplete }: {
  initialDraft: CharacterDraftInput; initialModelConfigured: boolean;
  onDraftChange(draft: CharacterDraftInput): void;
  onComplete(character: CharacterSnapshot, modelConfigured: boolean): void;
}): React.JSX.Element {
  const [step, setStep] = useState(initialModelConfigured ? 2 : 0);
  const [profile, setProfile] = useState<ModelProfileInput>({
    provider: 'openai-compatible', endpoint: 'https://api.openai.com/v1', model: 'gpt-4.1-mini',
  });
  const [modelConfigured, setModelConfigured] = useState(initialModelConfigured);
  const [modelResult, setModelResult] = useState<ModelConnectionResult | null>(null);
  const [busy, setBusy] = useState<'model' | 'character' | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const draft = initialDraft;
  const complete = Boolean(draft.name.trim() && draft.identity.trim()
    && draft.appearance.trim() && draft.speakingStyle.trim());
  const update = <K extends keyof CharacterDraftInput>(key: K, value: CharacterDraftInput[K]) =>
    onDraftChange({ ...draft, [key]: value });

  const updateProvider = (provider: ModelProfileInput['provider']) => {
    setModelResult(null);
    setProfile({ provider,
      endpoint: provider === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.openai.com/v1',
      model: provider === 'ollama' ? 'qwen3:8b' : 'gpt-4.1-mini' });
  };

  async function saveModel(): Promise<void> {
    setBusy('model');
    setSetupError(null);
    try {
      if (window.ailover) await window.ailover.modelProfile.save(profile);
      setModelConfigured(true);
      setStep(2);
    } catch { setSetupError('模型配置无法保存，请检查填写内容。'); }
    finally { setBusy(null); }
  }

  async function testModel(): Promise<void> {
    setBusy('model');
    setSetupError(null);
    try {
      setModelResult(window.ailover ? await window.ailover.modelProfile.test(profile)
        : { ok: true, latencyMs: 42, models: [profile.model], message: '预览模式：配置格式有效' });
    } catch { setModelResult({ ok: false, latencyMs: 0, models: [], message: '无法连接模型服务' }); }
    finally { setBusy(null); }
  }

  async function createFromDraft(): Promise<void> {
    if (!complete) return;
    setBusy('character');
    setSetupError(null);
    try {
      const character = window.ailover
        ? await window.ailover.character.create(draft) : previewCharacter(draft);
      onComplete(character, modelConfigured);
    } catch { setSetupError('角色创建失败，请返回检查角色设定。'); }
    finally { setBusy(null); }
  }

  return <div className="onboarding-shell" role="dialog" aria-modal="true" aria-label="首次设置">
    <aside className="onboarding-progress"><div className="brand-mark"><span className="brand-symbol">A</span>
      <span>AiLover</span></div><ol>{['开始', '模型', '角色', '确认'].map((label, index) =>
        <li className={index === step ? 'active' : index < step ? 'complete' : ''} key={label}>
          <span>{index < step ? <Check size={13} aria-hidden="true" /> : index + 1}</span>{label}</li>)}</ol></aside>
    <section className="onboarding-content">
      {step > 0 && <button className="icon-button onboarding-back" type="button" aria-label="返回上一步"
        title="返回上一步" onClick={() => setStep((current) => Math.max(0, current - 1))}>
        <ChevronLeft size={19} aria-hidden="true" /></button>}
      {step === 0 && <div className="onboarding-intro"><ShieldCheck size={36} strokeWidth={1.4} aria-hidden="true" />
        <span className="eyebrow">欢迎使用 AiLover</span><h1>从一次只属于你的相遇开始</h1>
        <p>角色资料、聊天记录与关系状态默认保存在这台电脑上。使用在线模型时，只有生成回复所需的内容会发送给你配置的服务。</p>
        <button className="primary-action" type="button" onClick={() => setStep(1)}>开始设置</button></div>}
      {step === 1 && <div className="onboarding-form"><header><span className="eyebrow">聊天模型</span>
        <h2>连接你的模型服务</h2><p>也可以暂时跳过，角色和本地资料仍会正常保存。</p></header>
        <div className="provider-switch" aria-label="模型提供方">
          <button className={profile.provider === 'openai-compatible' ? 'selected' : ''} type="button"
            onClick={() => updateProvider('openai-compatible')}>OpenAI Compatible</button>
          <button className={profile.provider === 'ollama' ? 'selected' : ''} type="button"
            onClick={() => updateProvider('ollama')}>Ollama</button></div>
        <label><span>服务地址</span><input type="url" value={profile.endpoint}
          onChange={(event) => setProfile({ ...profile, endpoint: event.target.value })} /></label>
        <label><span>模型名称</span><input value={profile.model}
          onChange={(event) => setProfile({ ...profile, model: event.target.value })} /></label>
        {profile.provider === 'openai-compatible' && <label><span>API Key</span>
          <input type="password" value={profile.apiKey ?? ''} placeholder="输入服务密钥"
            onChange={(event) => setProfile({ ...profile, apiKey: event.target.value || undefined })} />
          <small>密钥会由 Windows 加密后保存在本机。</small></label>}
        {modelResult && <div className={modelResult.ok ? 'connection-result success' : 'connection-result error'}>
          <strong>{modelResult.ok ? '连接状态正常' : '连接失败'}</strong><span>{modelResult.message}</span></div>}
        {setupError && <p className="form-error">{setupError}</p>}
        <footer><button className="text-action" type="button" onClick={() => setStep(2)}>稍后配置</button>
          <button className="secondary-action" disabled={busy !== null} type="button"
            onClick={() => void testModel()}>测试连接</button>
          <button className="primary-action" disabled={busy !== null || !profile.endpoint || !profile.model}
            type="button" onClick={() => void saveModel()}>{busy === 'model' ? '正在保存' : '保存并继续'}</button></footer>
      </div>}
      {step === 2 && <div className="onboarding-form"><header><span className="eyebrow">创建角色</span>
        <h2>定义你们的第一次相遇</h2></header>
        <div className="form-grid two-column"><label><span>名字</span><input required maxLength={40}
          value={draft.name} placeholder="例如：艾琳" onChange={(event) => update('name', event.target.value)} /></label>
          <label><span>年龄设定</span><input required maxLength={40} value={draft.ageSetting}
            onChange={(event) => update('ageSetting', event.target.value)} /></label></div>
        <fieldset><legend>人格基调</legend><div className="template-grid">{templates.map((template) =>
          <button key={template.id} type="button"
            className={draft.personalityTemplateId === template.id ? 'template-option selected' : 'template-option'}
            onClick={() => update('personalityTemplateId', template.id)}><strong>{template.name}</strong>
            <span>{template.description}</span></button>)}</div></fieldset>
        <div className="form-grid two-column"><label><span>性别设定</span><input required maxLength={30}
          value={draft.gender} onChange={(event) => update('gender', event.target.value)} /></label>
          <label><span>身份</span><input required maxLength={500} value={draft.identity}
            onChange={(event) => update('identity', event.target.value)} /></label></div>
        <label><span>外貌</span><textarea required maxLength={2000} rows={3} value={draft.appearance}
          onChange={(event) => update('appearance', event.target.value)} /></label>
        <label><span>说话方式</span><textarea required maxLength={1000} rows={2} value={draft.speakingStyle}
          onChange={(event) => update('speakingStyle', event.target.value)} /></label>
        <label><span>背景故事 <small>可选</small></span><textarea maxLength={4000} rows={3}
          value={draft.background} onChange={(event) => update('background', event.target.value)} /></label>
        <footer><button className="primary-action" disabled={!complete} type="button"
          onClick={() => setStep(3)}>确认角色</button></footer></div>}
      {step === 3 && <div className="onboarding-confirm"><span className="eyebrow">最终确认</span>
        <div className="portrait-ring portrait-created"><span>{draft.name.slice(0, 1)}</span></div>
        <h2>{draft.name}</h2><p>{draft.identity}</p><div className="profile-tags">
          <span>{templates.find(({ id }) => id === draft.personalityTemplateId)?.name}</span>
          <span>{draft.gender}</span><span>{draft.ageSetting}</span></div>
        <dl><div><dt>外貌</dt><dd>{draft.appearance}</dd></div>
          <div><dt>说话方式</dt><dd>{draft.speakingStyle}</dd></div></dl>
        {setupError && <p className="form-error">{setupError}</p>}
        <button className="primary-action" disabled={busy !== null} type="button"
          onClick={() => void createFromDraft()}>{busy === 'character' ? '正在创建' : `与${draft.name}见面`}</button>
      </div>}
    </section>
  </div>;
}

function ModelSettings({ onSaved }: { onSaved(): void }): React.JSX.Element {
  const [profile, setProfile] = useState<ModelProfileInput>({
    provider: 'openai-compatible', endpoint: 'https://api.openai.com/v1', model: 'gpt-4.1-mini',
  });
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [result, setResult] = useState<ModelConnectionResult | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [dataBusy, setDataBusy] = useState<'export' | 'restore' | 'diagnostics' | 'delete' | null>(null);
  const [dataResult, setDataResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

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
      onSaved();
    } catch {
      setResult({ ok: false, latencyMs: 0, models: [], message: '无法保存配置' });
    } finally { setBusy(null); }
  }

  async function exportBackup(): Promise<void> {
    setDataBusy('export');
    setDataResult(null);
    try {
      const result = window.ailover ? await window.ailover.data.exportBackup()
        : { ok: true as const, message: '预览模式：备份导出已取消', fileName: '', requiresRestart: false };
      if (result) setDataResult({ ok: true, message: result.message });
    } catch { setDataResult({ ok: false, message: '备份导出失败，现有数据没有改变。' }); }
    finally { setDataBusy(null); }
  }

  async function restoreBackup(): Promise<void> {
    setDataBusy('restore');
    setDataResult(null);
    try {
      const result = window.ailover ? await window.ailover.data.restoreBackup() : null;
      if (result) setDataResult({ ok: true, message: result.message });
    } catch { setDataResult({ ok: false, message: '备份无效或恢复失败，现有数据没有改变。' }); }
    finally { setDataBusy(null); }
  }

  async function exportDiagnostics(): Promise<void> {
    setDataBusy('diagnostics');
    setDataResult(null);
    try {
      const result = window.ailover ? await window.ailover.data.exportDiagnostics()
        : { ok: true as const, message: '预览模式：诊断导出已取消', fileName: '', requiresRestart: false };
      if (result) setDataResult({ ok: true, message: result.message });
    } catch { setDataResult({ ok: false, message: '诊断信息导出失败。' }); }
    finally { setDataBusy(null); }
  }

  async function deleteAllData(): Promise<void> {
    if (deleteConfirmation !== '删除全部数据') return;
    setDataBusy('delete');
    setDataResult(null);
    try {
      const result = window.ailover
        ? await window.ailover.data.deleteAll({ confirmation: '删除全部数据' }) : null;
      if (result) setDataResult({ ok: true, message: result.message });
    } catch { setDataResult({ ok: false, message: '本地数据删除失败，应用将重新启动以检查数据状态。' }); }
    finally { setDataBusy(null); }
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
    </section><section className="settings-section data-settings">
      <div className="settings-heading"><h3>本地数据</h3>
        <p>备份包含角色、聊天记录、记忆与角色图片，不包含模型密钥。</p></div>
      {dataResult && <div className={dataResult.ok ? 'connection-result success' : 'connection-result error'}>
        <strong>{dataResult.ok ? '操作完成' : '操作失败'}</strong><span>{dataResult.message}</span></div>}
      <div className="data-actions"><button className="secondary-action" type="button"
        disabled={dataBusy !== null} onClick={() => void exportBackup()}><Download size={16} aria-hidden="true" />
        {dataBusy === 'export' ? '正在导出' : '导出完整备份'}</button>
        <button className="secondary-action" type="button" disabled={dataBusy !== null}
          onClick={() => void restoreBackup()}><DatabaseBackup size={16} aria-hidden="true" />
          {dataBusy === 'restore' ? '正在验证' : '从备份恢复'}</button>
        <button className="secondary-action" type="button" disabled={dataBusy !== null}
          onClick={() => void exportDiagnostics()}><FileJson size={16} aria-hidden="true" />
          {dataBusy === 'diagnostics' ? '正在整理' : '导出诊断信息'}</button></div>
    </section><section className="settings-section danger-settings">
      <div className="settings-heading"><h3>删除本地数据</h3>
        <p>永久删除这台电脑上的角色、聊天记录、记忆、模型配置和角色图片。</p></div>
      {!deleteArmed ? <button className="danger-action" type="button" disabled={dataBusy !== null}
        onClick={() => setDeleteArmed(true)}><Trash2 size={16} aria-hidden="true" />删除全部数据</button>
        : <div className="delete-confirmation"><label><span>输入“删除全部数据”以继续</span>
          <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /></label>
          <div><button className="secondary-action" type="button" onClick={() => {
            setDeleteArmed(false); setDeleteConfirmation('');
          }}>取消</button><button className="danger-action" type="button"
            disabled={dataBusy !== null || deleteConfirmation !== '删除全部数据'}
            onClick={() => void deleteAllData()}>{dataBusy === 'delete' ? '正在删除' : '永久删除'}</button></div></div>}
    </section></div></>;
}

function CharacterPortrait({ character, visual }: {
  character: CharacterSnapshot; visual: CharacterVisualProfile | null;
}): React.JSX.Element {
  const template = templates.find(({ id }) => id === character.personalityTemplateId);
  return <div className="character-profile">
    {visual?.currentAsset ? <div className="portrait-image"><img src={visual.currentAsset.dataUrl}
      alt={`${character.name}的角色图`} /></div>
      : <div className="portrait-ring portrait-created"><span>{character.name.slice(0, 1)}</span></div>}
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
