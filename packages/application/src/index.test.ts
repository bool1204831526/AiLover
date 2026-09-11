import { describe, expect, it } from 'vitest';

import { createCharacter } from '@ailover/domain';

import { assembleChatContext, MAX_RETAINED_CHAT_MESSAGES, retainRecentMessages,
  shouldSendCompanionPrompt, isCompanionQuietHours, type StoredChatMessage } from './index';

const character = createCharacter({
  name: '艾琳', gender: '女', ageSetting: '成年', identity: '用户的 AI 伴侣', background: '来自海边',
  appearance: '银白色长发', speakingStyle: '温柔而简洁', personalityTemplateId: 'gentle',
}, { idGenerator: { next: () => 'character-1' }, clock: { now: () => new Date() } });

const message = (id: string, content: string, status: StoredChatMessage['status'] = 'completed') => ({
  id, conversationId: 'conversation-1', role: 'user' as const, content, status, model: null,
  createdAt: new Date(),
});

describe('assembleChatContext', () => {
  it('keeps the character identity and excludes failed messages', () => {
    const result = assembleChatContext(character, [message('1', '你好'), message('2', '不应出现', 'failed')]);
    expect(result[0]?.content).toContain('你是艾琳');
    expect(result.map(({ content }) => content)).toContain('你好');
    expect(result.map(({ content }) => content)).not.toContain('不应出现');
  });

  it('keeps the most recent messages inside the context budget', () => {
    const result = assembleChatContext(character, [message('1', '较早内容'), message('2', '最近内容')], 5);
    expect(result.at(-1)?.content).toBe('最近内容');
    expect(result.some(({ content }) => content === '较早内容')).toBe(false);
  });

  it('labels recalled memories as evidence-backed context', () => {
    const result = assembleChatContext(character, [], 100, [{ subject: '饮品偏好', content: '我喜欢咖啡' }]);
    expect(result[1]?.content).toContain('有原始消息证据');
    expect(result[1]?.content).toContain('我喜欢咖啡');
  });

  it('projects cognition without exposing internal values', () => {
    const result = assembleChatContext(character, [], 100, [], '心情平稳；正在逐渐熟悉彼此');
    expect(result[1]?.content).toContain('当前连续状态');
    expect(result[1]?.content).not.toContain('0.');
  });
});

describe('companion scheduling', () => {
  const settings = { enabled: true, intervalMinutes: 30, quietStart: '23:00', quietEnd: '07:00', desktopPetEnabled: false };
  const date = (value: string) => new Date(`2026-09-11T${value}:00+08:00`);

  it('nudges only after inactivity interval and never twice in one interval', () => {
    expect(shouldSendCompanionPrompt({ now: date('12:31'), lastInteractionAt: date('12:00'), lastPromptAt: null, settings })).toBe(true);
    expect(shouldSendCompanionPrompt({ now: date('12:45'), lastInteractionAt: date('12:00'), lastPromptAt: date('12:31'), settings })).toBe(false);
  });

  it('respects overnight quiet hours and disabled schedules', () => {
    expect(isCompanionQuietHours(date('23:30'), settings)).toBe(true);
    expect(isCompanionQuietHours(date('06:59'), settings)).toBe(true);
    expect(isCompanionQuietHours(date('07:00'), settings)).toBe(false);
    expect(shouldSendCompanionPrompt({ now: date('12:31'), lastInteractionAt: date('12:00'), lastPromptAt: null,
      settings: { ...settings, enabled: false } })).toBe(false);
  });
});

describe('retainRecentMessages', () => {
  it('bounds long renderer sessions while preserving chronological order', () => {
    const messages = Array.from({ length: 2_000 }, (_, index) => index);
    const retained = retainRecentMessages(messages);
    expect(retained).toHaveLength(MAX_RETAINED_CHAT_MESSAGES);
    expect(retained[0]).toBe(1_500);
    expect(retained.at(-1)).toBe(1_999);
  });
});
