import { useEffect, useState, type FormEvent } from 'react';
import { Heart, MessageCircle, Settings, SlidersHorizontal, UserRound, X } from 'lucide-react';

import type { BootstrapResponse, CharacterDraftInput, CharacterSnapshot } from '@ailover/contracts';

const navigation = [
  { label: '对话', icon: MessageCircle }, { label: '角色', icon: UserRound },
  { label: '关系', icon: Heart }, { label: '设置', icon: Settings },
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
      <nav aria-label="主导航">{navigation.map(({ label, icon: Icon }, index) =>
        <button className={index === 0 ? 'nav-item active' : 'nav-item'} key={label} type="button">
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
      <header className="conversation-header"><div><span className="eyebrow">当前对话</span>
        <h2>{character ? `与${character.name}的对话` : '新的相遇'}</h2></div>
        <button className="icon-button" type="button" aria-label="对话设置" title="对话设置">
          <SlidersHorizontal aria-hidden="true" size={19} /></button></header>
      <div className="empty-conversation"><MessageCircle aria-hidden="true" size={30} strokeWidth={1.5} />
        <p>{error ?? (character ? `${character.name}已经准备好与你相识。聊天能力将在下一阶段接入。` : '创建角色后，即可开始你们的第一段对话。')}</p></div>
      <div className="composer" aria-label="消息输入区"><textarea aria-label="消息" disabled
        placeholder={character ? '聊天能力即将接入' : '先创建一位角色'} rows={1} />
        <button aria-label="发送消息" disabled type="button">发送</button></div>
    </section>
    {creatorOpen && <CharacterCreator draft={draft} saving={saving} error={error} onChange={setDraft}
      onClose={() => setCreatorOpen(false)} onSubmit={submitCharacter} />}
  </main>;
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
