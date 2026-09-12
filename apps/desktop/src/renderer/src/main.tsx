import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageCircle, X } from 'lucide-react';

import type { CharacterSnapshot, CharacterVisualProfile, DesktopPetPack, DesktopPetPackManifest } from '@ailover/contracts';
import { codexPetFrame, codexPetLookFrame, type CodexPetAnimation,
  type CodexPetFrame } from '@ailover/application';

import { App } from './App';
import './styles.css';

const root = document.getElementById('root');

if (!root) throw new Error('Renderer root element is missing');

function DesktopPet(): React.JSX.Element {
  const [character, setCharacter] = useState<CharacterSnapshot | null>(null);
  const [visual, setVisual] = useState<CharacterVisualProfile | null>(null);
  const [action, setAction] = useState<keyof DesktopPetPackManifest['actions']>('idle');
  const [petPack, setPetPack] = useState<DesktopPetPack | null>(null);
  const [codexAnimation, setCodexAnimation] = useState<CodexPetAnimation>('idle');
  const [codexFrameIndex, setCodexFrameIndex] = useState(0);
  const [lookFrame, setLookFrame] = useState<CodexPetFrame | null>(null);
  useEffect(() => {
    const api = window.ailover;
    if (!api) return;
    void api.bootstrap().then((result) => setCharacter(result.currentCharacter));
    void api.visuals.get().then(setVisual);
    void api.visuals.getDesktopPetPack().then(setPetPack);
    const actions = ['idle', 'walk-left', 'walk-right', 'greet', 'happy', 'thinking', 'sleep'] as const;
    const timer = window.setInterval(() => {
      setAction(actions[Math.floor(Math.random() * actions.length)] ?? 'idle');
    }, 6_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (petPack?.mode === 'actions' || !petPack) return;
    const sequence: CodexPetAnimation[] = ['idle', 'waving', 'idle', 'jumping', 'waiting', 'running', 'review'];
    let sequenceIndex = 0;
    const timer = window.setInterval(() => {
      sequenceIndex = (sequenceIndex + 1) % sequence.length;
      setCodexAnimation(sequence[sequenceIndex] ?? 'idle');
      setCodexFrameIndex(0);
    }, 5_500);
    return () => window.clearInterval(timer);
  }, [petPack]);
  useEffect(() => {
    if (petPack?.mode === 'actions' || !petPack) return;
    const frame = codexPetFrame(codexAnimation, codexFrameIndex);
    const timer = window.setTimeout(() => setCodexFrameIndex((index) => index + 1), frame.duration);
    return () => window.clearTimeout(timer);
  }, [codexAnimation, codexFrameIndex, petPack?.mode]);
  const actionImage = petPack?.actionDataUrls[action] ?? petPack?.actionDataUrls.idle;
  const atlasFrame = lookFrame ?? codexPetFrame(codexAnimation, codexFrameIndex);
  return <main className="desktop-pet-shell" onPointerMove={(event) => {
    if (petPack?.mode !== 'codex-v2') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setLookFrame(codexPetLookFrame(event.clientX - bounds.width / 2, event.clientY - bounds.height / 2, 34));
  }} onPointerLeave={() => setLookFrame(null)}>
    <button className="pet-close" type="button" title="关闭桌面角色" aria-label="关闭桌面角色"
      onClick={() => void window.ailover?.companion.closeDesktopPet()}><X size={15} /></button>
    <div className={`pet-character${petPack?.mode === 'actions' ? ` pet-action-${action}` : ''}`} title="拖动桌面角色">
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
    <button className="pet-open" type="button" title="打开 AiLover" aria-label="打开 AiLover"
      onClick={() => void window.ailover?.companion.focusMain()}><MessageCircle size={16} aria-hidden="true" /></button>
  </main>;
}

const desktopPet = new URLSearchParams(window.location.search).get('desktopPet') === '1';

createRoot(root).render(
  <StrictMode>
    {desktopPet ? <DesktopPet /> : <App />}
  </StrictMode>,
);
