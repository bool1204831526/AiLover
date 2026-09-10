import { describe, expect, it } from 'vitest';

import { createCharacter } from '@ailover/domain';

import { assembleChatContext, type StoredChatMessage } from './index';

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
});
