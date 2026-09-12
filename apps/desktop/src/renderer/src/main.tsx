import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Heart, MessageCircle, SendHorizontal, X } from 'lucide-react';

import type { CharacterSnapshot, CharacterVisualProfile, DesktopPetPack,
  DesktopPetRuntimeState } from '@ailover/contracts';
import { codexPetFrame, codexPetLookFrame, type CodexPetAnimation,
  type CodexPetFrame } from '@ailover/application';

import { App } from './App';
import './styles.css';

const root = document.getElementById('root');

if (!root) throw new Error('Renderer root element is missing');

const legacyPetActions: Record<DesktopPetRuntimeState, keyof DesktopPetPack['actionDataUrls']> = {
  idle: 'idle', 'running-left': 'walk-left', 'running-right': 'walk-right', waving: 'greet',
  jumping: 'happy', failed: 'thinking', waiting: 'thinking', running: 'thinking', review: 'happy',
  sleeping: 'sleep',
};
const atlasPetAnimations: Record<DesktopPetRuntimeState, CodexPetAnimation> = {
  idle: 'idle', 'running-left': 'running-left', 'running-right': 'running-right', waving: 'waving',
  jumping: 'jumping', failed: 'failed', waiting: 'waiting', running: 'running', review: 'review',
  sleeping: 'waiting',
};

function DesktopPet(): React.JSX.Element {
  const [character, setCharacter] = useState<CharacterSnapshot | null>(null);
  const [visual, setVisual] = useState<CharacterVisualProfile | null>(null);
  const [petState, setPetState] = useState<DesktopPetRuntimeState>('idle');
  const [petPack, setPetPack] = useState<DesktopPetPack | null>(null);
  const [codexFrameIndex, setCodexFrameIndex] = useState(0);
  const [lookFrame, setLookFrame] = useState<CodexPetFrame | null>(null);
  const [quickChatOpen, setQuickChatOpen] = useState(false);
  const [quickDraft, setQuickDraft] = useState('');
  const [petChatRequestId, setPetChatRequestId] = useState<string | null>(null);
  const [speech, setSpeech] = useState('');
  useEffect(() => {
    const api = window.ailover;
    if (!api) return;
    void api.bootstrap().then((result) => setCharacter(result.currentCharacter));
    void api.visuals.get().then(setVisual);
    void api.visuals.getDesktopPetPack().then(setPetPack);
    void api.companion.getPetState().then(setPetState);
    return api.companion.onPetState(setPetState);
  }, []);
  useEffect(() => {
    const api = window.ailover;
    if (!api) return;
    return api.chat.onStream((event) => {
      if (event.type === 'started') {
        setPetChatRequestId(event.requestId);
        setSpeech('正在想怎么回答你…');
      } else if (event.type === 'chunk') {
        setSpeech((current) => current === '正在想怎么回答你…'
          ? event.delta : `${current}${event.delta}`.slice(-180));
      } else {
        setPetChatRequestId(null);
        if (event.type === 'completed') setSpeech(event.message.content.slice(-180));
        else if (event.type === 'failed') setSpeech(event.error);
        else setSpeech('好，我们先停一下。');
      }
    });
  }, []);
  useEffect(() => {
    if (petPack?.mode === 'actions' || !petPack) return;
    const frame = codexPetFrame(atlasPetAnimations[petState], codexFrameIndex);
    const timer = window.setTimeout(() => setCodexFrameIndex((index) => index + 1), frame.duration);
    return () => window.clearTimeout(timer);
  }, [petState, codexFrameIndex, petPack?.mode]);
  useEffect(() => {
    setCodexFrameIndex(0);
    if (petState !== 'idle') setLookFrame(null);
    if (petState === 'waving') setSpeech('想和你聊聊天。');
    if (petState === 'jumping') setSpeech('见到你很开心。');
    if (petState === 'failed') setSpeech('刚才没有顺利回复，再试一次吧。');
  }, [petState]);
  useEffect(() => {
    if (!speech || quickChatOpen || petChatRequestId) return;
    const timer = window.setTimeout(() => setSpeech(''), 12_000);
    return () => window.clearTimeout(timer);
  }, [speech, quickChatOpen, petChatRequestId]);
  const action = legacyPetActions[petState];
  const atlasAnimation = atlasPetAnimations[petState];
  const actionImage = petPack?.actionDataUrls[action] ?? petPack?.actionDataUrls.idle;
  const atlasFrame = lookFrame ?? codexPetFrame(atlasAnimation, codexFrameIndex);
  async function sendQuickMessage(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = quickDraft.trim();
    if (!text || petChatRequestId || !window.ailover) return;
    setQuickDraft('');
    setQuickChatOpen(false);
    setSpeech('正在想怎么回答你…');
    try {
      const receipt = await window.ailover.chat.send({ text, clientMessageId: crypto.randomUUID() });
      setPetChatRequestId(receipt.requestId);
    } catch {
      setQuickDraft(text);
      setSpeech('暂时无法发送，请检查主界面的模型设置。');
    }
  }
  return <main className="desktop-pet-shell" onPointerMove={(event) => {
    if (petPack?.mode !== 'codex-v2' || petState !== 'idle') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setLookFrame(codexPetLookFrame(event.clientX - bounds.width / 2, event.clientY - bounds.height / 2, 34));
  }} onPointerLeave={() => setLookFrame(null)}>
    <div className="pet-conversation-slot">
      {quickChatOpen ? <form className="pet-quick-chat" onSubmit={(event) => void sendQuickMessage(event)}>
        <input aria-label="快捷消息" value={quickDraft} maxLength={500} autoFocus
          placeholder={petChatRequestId ? '正在回复…' : `和${character?.name ?? '她'}说句话`}
          disabled={Boolean(petChatRequestId)} onChange={(event) => setQuickDraft(event.target.value)} />
        <button type="submit" title="发送" aria-label="发送" disabled={!quickDraft.trim() || Boolean(petChatRequestId)}>
          <SendHorizontal size={15} aria-hidden="true" /></button>
      </form> : speech ? <button className="pet-speech" type="button"
        onClick={() => void window.ailover?.companion.focusMain()}>{speech}</button> : null}
    </div>
    <button className="pet-close" type="button" title="关闭桌面角色" aria-label="关闭桌面角色"
      onClick={() => void window.ailover?.companion.closeDesktopPet()}><X size={15} /></button>
    <div className={`pet-character${petPack?.mode === 'actions' ? ` pet-action-${action}` : ''}`}
      title="拖动桌面角色" onDoubleClick={() => void window.ailover?.companion.focusMain()}>
      <div className={`pet-portrait${petPack?.mode !== 'actions' && petPack ? ' pet-sprite-viewport' : ''}`}>{petPack?.mode !== 'actions' && petPack?.atlas
        ? <img className="pet-spritesheet" src={petPack.atlas.dataUrl} alt={character?.name ?? '角色'}
          style={{ height: `${petPack.atlas.spriteVersionNumber === 2 ? 1100 : 900}%`,
            transform: `translate(${-atlasFrame.column * 12.5}%, ${-atlasFrame.row * (100 / (petPack.atlas.spriteVersionNumber === 2 ? 11 : 9))}%)` }} />
        : actionImage
        ? <img src={actionImage} alt={character?.name ?? '角色'} />
        : visual?.currentAsset ? <img src={visual.currentAsset.dataUrl} alt={character?.name ?? '角色'} />
        : <span>{character?.name.slice(0, 1) ?? 'A'}</span>}</div>
      <div className="pet-name">{character?.name ?? 'AiLover'}</div>
    </div>
    <button className="pet-react" type="button" title="和角色互动" aria-label="和角色互动"
      onClick={() => void window.ailover?.companion.interactPet()}><Heart size={16} aria-hidden="true" /></button>
    <button className="pet-open" type="button" title="快捷对话" aria-label="快捷对话"
      onClick={() => setQuickChatOpen((open) => !open)}><MessageCircle size={16} aria-hidden="true" /></button>
  </main>;
}

const desktopPet = new URLSearchParams(window.location.search).get('desktopPet') === '1';

createRoot(root).render(
  <StrictMode>
    {desktopPet ? <DesktopPet /> : <App />}
  </StrictMode>,
);
