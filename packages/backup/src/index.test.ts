import { describe, expect, it } from 'vitest';

import { createBackupDocument, createCharacterCardDocument, parseBackupDocument,
  parseCharacterCardDocument } from './index';

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
      characterName: '艾琳', data: { characters: [{ id: 'character-1', name: '艾琳' }], memories: [
        { id: 'memory-1', character_id: 'character-1', content: '喜欢咖啡' } ] },
      assets: [{ path: 'assets/portrait-1.png', data: Buffer.from('portrait') }] });
    const parsed = parseCharacterCardDocument(source);
    expect(parsed.characterName).toBe('艾琳');
    expect(parsed.data.memories?.[0]?.content).toBe('喜欢咖啡');
    expect(parsed.assets[0]?.data.toString()).toBe('portrait');
    expect(() => parseCharacterCardDocument(source.replace('cG9ydHJhaXQ=', 'cG9ydHJhaXE='))).toThrow('完整性');
  });
});