import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageCircle, X } from 'lucide-react';

import type { CharacterSnapshot, CharacterVisualProfile } from '@ailover/contracts';

import { App } from './App';
import './styles.css';

const root = document.getElementById('root');

if (!root) throw new Error('Renderer root element is missing');

function DesktopPet(): React.JSX.Element {
  const [character, setCharacter] = useState<CharacterSnapshot | null>(null);
  const [visual, setVisual] = useState<CharacterVisualProfile | null>(null);
  const [action, setAction] = useState<'idle' | 'sway' | 'bounce' | 'greet'>('idle');
  useEffect(() => {
    const api = window.ailover;
    if (!api) return;
    void api.bootstrap().then((result) => setCharacter(result.currentCharacter));
    void api.visuals.get().then(setVisual);
    const actions = ['idle', 'sway', 'bounce', 'greet'] as const;
    const timer = window.setInterval(() => {
      setAction(actions[Math.floor(Math.random() * actions.length)] ?? 'idle');
    }, 6_000);
    return () => window.clearInterval(timer);
  }, []);
  return <main className="desktop-pet-shell">
    <button className="pet-close" type="button" title="关闭桌面角色" aria-label="关闭桌面角色"
      onClick={() => void window.ailover?.companion.closeDesktopPet()}><X size={15} /></button>
    <div className={`pet-character pet-action-${action}`} title="拖动桌面角色">
      <div className="pet-portrait">{visual?.currentAsset
        ? <img src={visual.currentAsset.dataUrl} alt={character?.name ?? '角色'} />
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
