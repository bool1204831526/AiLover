import { describe, expect, it } from 'vitest';

import { createBackupDocument, createCharacterCardDocument, parseBackupDocument,
  parseCharacterCardDocument, prepareCharacterCardImportData } from './index';

describe('backup format', () => {
  it('round-trips database and asset bytes without credentials metadata', () => {
    const source = createBackupDocument({ appVersion: '0.1.0',
      createdAt: new Date('2026-09-11T00:00:00Z'), database: Buffer.from('sqlite'),
      assets: [{ path: 'assets/character/portrait.png', data: Buffer.from('image') }] });
    expect(source).toContain('"credentialsIncluded":false');
    const parsed = parseBackupDocument(source);
    expect(parsed.database.toString()).toBe('sqlite');
    expect(parsed.assets[0]?.data.toString()).toBe('image');
  });

  it('rejects modified payloads and unsafe asset paths', () => {
    const source = createBackupDocument({ appVersion: '0.1.0', createdAt: new Date(),
      database: Buffer.from('sqlite'), assets: [] });
    const modified = source.replace('c3FsaXRl', 'c3FsaXRm');
    expect(() => parseBackupDocument(modified)).toThrow('完整性');
    expect(() => createBackupDocument({ appVersion: '0.1.0', createdAt: new Date(),
      database: Buffer.from('sqlite'), assets: [{ path: '../secret', data: Buffer.from('x') }] }))
      .toThrow('无效路径');
  });
});

describe('character card format', () => {
  it('round-trips character records and verifies embedded assets', () => {
    const source = createCharacterCardDocument({ appVersion: '0.1.0', createdAt: new Date('2026-09-14T00:00:00Z'),
      characterName: '艾琳', familiarUserId: '9db7303d-cc9d-4e44-a908-98d94b7dff93', data: { characters: [{ id: 'character-1', name: '艾琳' }], memories: [
        { id: 'memory-1', character_id: 'character-1', content: '喜欢咖啡' } ] },
      assets: [{ path: 'assets/portrait-1.png', data: Buffer.from('portrait') }] });
    const parsed = parseCharacterCardDocument(source);
    expect(parsed.characterName).toBe('艾琳');
    expect(parsed.familiarUserId).toBe('9db7303d-cc9d-4e44-a908-98d94b7dff93');
    expect(parsed.data.memories?.[0]?.content).toBe('喜欢咖啡');
    expect(parsed.assets[0]?.data.toString()).toBe('portrait');
    expect(() => parseCharacterCardDocument(source.replace('cG9ydHJhaXQ=', 'cG9ydHJhaXE='))).toThrow('完整性');
  });

  it('accepts legacy cards as having no familiar user identity', () => {
    const source = JSON.stringify({ format: 'ailover-character', version: 1, appVersion: '0.1.0',
      createdAt: '2026-09-14T00:00:00.000Z', characterName: '旧角色', environment: null,
      data: { characters: [{ id: 'old', name: '旧角色' }] }, assets: [] });
    expect(parseCharacterCardDocument(source).familiarUserId).toBeNull();
  });
});

describe('character card user recognition', () => {
  it('removes prior-user experience when the imported user is a stranger', () => {
    const data = { characters: [{ id: 'character' }], character_lore: [{ character_id: 'character' }],
      conversations: [{ id: 'conversation' }], memories: [{ id: 'memory' }],
      relationship_states: [{ id: 'relationship' }] };
    expect(Object.keys(prepareCharacterCardImportData(data, false)).sort())
      .toEqual(['character_lore', 'characters']);
    expect(prepareCharacterCardImportData(data, true)).toBe(data);
  });
});
