import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type { CharacterRepository, ModelProfileRepository, StoredModelProfile } from '@ailover/application';
import type { Character, CharacterId, PersonalityTemplateId } from '@ailover/domain';

import { migrate } from './migrations';
import { characters, modelProfiles, personalityBaselines } from './schema';

const LOCAL_USER_ID = 'local-user';

export type AppDatabase = {
  sqlite: Database.Database;
  orm: BetterSQLite3Database;
  close(): void;
};

export function openAppDatabase(path: string): AppDatabase {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  migrate(sqlite);
  sqlite.prepare(`INSERT OR IGNORE INTO users(id, display_name, locale, timezone, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(
    LOCAL_USER_ID, '本地用户', 'zh-CN', 'Asia/Shanghai', new Date().toISOString(),
  );
  return { sqlite, orm: drizzle(sqlite), close: () => sqlite.close() };
}

export class SqliteCharacterRepository implements CharacterRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async save(character: Character): Promise<void> {
    this.database.sqlite.transaction(() => {
      this.database.orm.insert(characters).values({
        id: character.id, userId: LOCAL_USER_ID, name: character.name, gender: character.gender,
        ageSetting: character.ageSetting, identity: character.identity, background: character.background,
        appearance: character.appearance, speakingStyle: character.speakingStyle,
        personalityTemplateId: character.personalityTemplateId, status: 'active',
        createdAt: character.createdAt.toISOString(), updatedAt: character.updatedAt.toISOString(),
      }).run();
      this.database.orm.insert(personalityBaselines).values({
        characterId: character.id, ...character.personalityBaseline,
        createdAt: character.createdAt.toISOString(),
      }).run();
    })();
  }

  public async findById(id: CharacterId): Promise<Character | null> {
    return this.find(and(eq(characters.id, id), eq(characters.status, 'active')));
  }

  public async findCurrent(): Promise<Character | null> {
    return this.find(and(eq(characters.userId, LOCAL_USER_ID), eq(characters.status, 'active')));
  }

  private find(condition: ReturnType<typeof and>): Character | null {
    const row = this.database.orm.select().from(characters)
      .innerJoin(personalityBaselines, eq(characters.id, personalityBaselines.characterId))
      .where(condition).limit(1).get();
    if (!row) return null;
    const profile = row.characters;
    const baseline = row.personality_baselines;
    return {
      id: profile.id as CharacterId, name: profile.name, gender: profile.gender,
      ageSetting: profile.ageSetting, identity: profile.identity, background: profile.background,
      appearance: profile.appearance, speakingStyle: profile.speakingStyle,
      personalityTemplateId: profile.personalityTemplateId as PersonalityTemplateId,
      personalityBaseline: {
        warmth: baseline.warmth, energy: baseline.energy, reserve: baseline.reserve,
        playfulness: baseline.playfulness, maturity: baseline.maturity,
        rationality: baseline.rationality, initiative: baseline.initiative,
      },
      createdAt: new Date(profile.createdAt), updatedAt: new Date(profile.updatedAt),
    };
  }
}

export class SqliteModelProfileRepository implements ModelProfileRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async get(): Promise<StoredModelProfile | null> {
    const row = this.database.orm.select().from(modelProfiles)
      .where(eq(modelProfiles.id, 'default-chat')).limit(1).get();
    return row ? {
      provider: row.provider as StoredModelProfile['provider'], endpoint: row.endpoint,
      model: row.model, encryptedApiKey: row.encryptedApiKey, updatedAt: new Date(row.updatedAt),
    } : null;
  }

  public async save(profile: StoredModelProfile): Promise<void> {
    this.database.orm.insert(modelProfiles).values({
      id: 'default-chat', provider: profile.provider, endpoint: profile.endpoint,
      model: profile.model, encryptedApiKey: profile.encryptedApiKey,
      updatedAt: profile.updatedAt.toISOString(),
    }).onConflictDoUpdate({
      target: modelProfiles.id,
      set: { provider: profile.provider, endpoint: profile.endpoint, model: profile.model,
        encryptedApiKey: profile.encryptedApiKey, updatedAt: profile.updatedAt.toISOString() },
    }).run();
  }
}

export { migrate } from './migrations';
export { characters, modelProfiles, personalityBaselines, users } from './schema';
