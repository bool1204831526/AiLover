import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createCharacter } from '@ailover/domain';

import { openAppDatabase, SqliteCharacterRepository } from './index';

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) {
    for (const suffix of ['', '-shm', '-wal']) if (existsSync(path + suffix)) rmSync(path + suffix);
  }
});

describe('SqliteCharacterRepository', () => {
  it('restores the current character across database restarts', async () => {
    const path = join(tmpdir(), `ailover-${randomUUID()}.sqlite`);
    paths.push(path);
    const character = createCharacter({
      name: '艾琳', gender: '女', ageSetting: '成年', identity: 'AI 伴侣',
      background: '喜欢安静的夜晚', appearance: '银白色长发', speakingStyle: '温柔',
      personalityTemplateId: 'gentle',
    }, { idGenerator: { next: () => 'character-1' }, clock: { now: () => new Date('2026-09-11T00:00:00Z') } });
    const first = openAppDatabase(path);
    await new SqliteCharacterRepository(first).save(character);
    first.close();
    const second = openAppDatabase(path);
    const restored = await new SqliteCharacterRepository(second).findCurrent();
    expect(restored?.name).toBe('艾琳');
    expect(restored?.personalityBaseline.warmth).toBe(0.9);
    second.close();
  });
});
