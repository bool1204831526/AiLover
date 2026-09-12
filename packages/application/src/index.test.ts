import { describe, expect, it } from 'vitest';

import { createCharacter } from '@ailover/domain';

import { assembleChatContext, MAX_RETAINED_CHAT_MESSAGES, retainRecentMessages,
  shouldSendCompanionPrompt, isCompanionQuietHours, codexPetFrame, codexPetLookFrame,
  readPngDimensions, readWebPDimensions, type StoredChatMessage } from './index';

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
  const settings = { enabled: true, intervalMinutes: 30, quietStart: '23:00', quietEnd: '07:00',
    desktopPetEnabled: false, desktopPetRoamingEnabled: true };
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

describe('Codex v2 pet animation', () => {
  it('uses the contract row, frame count and timing', () => {
    expect(codexPetFrame('idle', 0)).toEqual({ row: 0, column: 0, duration: 280 });
    expect(codexPetFrame('waving', 4)).toEqual({ row: 3, column: 0, duration: 140 });
    expect(codexPetFrame('running-left', 7)).toEqual({ row: 2, column: 7, duration: 220 });
  });

  it('maps pointer direction clockwise with a neutral deadzone', () => {
    expect(codexPetLookFrame(0, -30)).toMatchObject({ row: 9, column: 0 });
    expect(codexPetLookFrame(30, 0)).toMatchObject({ row: 9, column: 4 });
    expect(codexPetLookFrame(0, 30)).toMatchObject({ row: 10, column: 0 });
    expect(codexPetLookFrame(-30, 0)).toMatchObject({ row: 10, column: 4 });
    expect(codexPetLookFrame(2, 2)).toBeNull();
  });

  it('reads atlas dimensions without relying on Electron image decoding', () => {
    const vp8x = Buffer.alloc(30);
    vp8x.write('RIFF', 0); vp8x.writeUInt32LE(22, 4); vp8x.write('WEBPVP8X', 8); vp8x.writeUInt32LE(10, 16);
    vp8x[24] = 0xff; vp8x[25] = 0x05; vp8x[27] = 0xef; vp8x[28] = 0x08;
    expect(readWebPDimensions(vp8x)).toEqual({ width: 1536, height: 2288 });

    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.write('IHDR', 12);
    png.writeUInt32BE(1536, 16); png.writeUInt32BE(2288, 20);
    expect(readPngDimensions(png)).toEqual({ width: 1536, height: 2288 });
    expect(readWebPDimensions(Buffer.from('not-webp'))).toBeNull();
  });
});
