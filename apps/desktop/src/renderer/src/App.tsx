import { useEffect, useState } from 'react';
import { Heart, MessageCircle, Settings, SlidersHorizontal, UserRound } from 'lucide-react';

import type { BootstrapResponse } from '@ailover/contracts';

const navigation = [
  { label: '对话', icon: MessageCircle, active: true },
  { label: '角色', icon: UserRound },
  { label: '关系', icon: Heart },
  { label: '设置', icon: Settings },
];

export function App(): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.ailover) {
      setBootstrap({
        appVersion: 'preview',
        platform: 'win32',
        environment: 'development',
        dataPath: 'browser-preview',
        capabilities: { character: false, chat: false, memory: false },
      });
      return;
    }

    void window.ailover.bootstrap().then(setBootstrap).catch(() => {
      setError('应用初始化失败，请重新启动。');
    });
  }, []);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark" aria-label="AiLover">
          <span className="brand-symbol">A</span>
          <span>AiLover</span>
        </div>

        <nav aria-label="主导航">
          {navigation.map(({ label, icon: Icon, active }) => (
            <button className={active ? 'nav-item active' : 'nav-item'} key={label} type="button">
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className={error ? 'status-dot error' : 'status-dot'} />
          <span>{error ? '初始化失败' : bootstrap ? '本地服务就绪' : '正在启动'}</span>
        </div>
      </aside>

      <section className="character-panel" aria-label="当前角色">
        <div className="character-placeholder">
          <div className="portrait-ring">
            <UserRound aria-hidden="true" size={54} strokeWidth={1.25} />
          </div>
          <h1>尚未创建角色</h1>
          <p>你的第一位 AI Lover 将出现在这里。</p>
          <button className="primary-action" disabled type="button">
            创建角色
          </button>
        </div>
      </section>

      <section className="conversation-panel">
        <header className="conversation-header">
          <div>
            <span className="eyebrow">当前对话</span>
            <h2>新的相遇</h2>
          </div>
          <button className="icon-button" type="button" aria-label="对话设置" title="对话设置">
            <SlidersHorizontal aria-hidden="true" size={19} />
          </button>
        </header>

        <div className="empty-conversation">
          <MessageCircle aria-hidden="true" size={30} strokeWidth={1.5} />
          <p>{error ?? '创建角色后，即可开始你们的第一段对话。'}</p>
        </div>

        <div className="composer" aria-label="消息输入区">
          <textarea aria-label="消息" disabled placeholder="先创建一位角色" rows={1} />
          <button aria-label="发送消息" disabled type="button">
            发送
          </button>
        </div>
      </section>
    </main>
  );
}
