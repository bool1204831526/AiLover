import { mkdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

import Database from 'better-sqlite3';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type {
  CharacterRepository, ConversationRepository, ModelProfileRepository, StoredChatMessage,
  StoredConversation, StoredModelProfile,
} from '@ailover/application';
import { MAX_RETAINED_CHAT_MESSAGES } from '@ailover/application';
import type {
  CognitionRepository, CognitionSnapshot, EvolutionEvidence, ReflectionRecord, SelfModelEntry,
} from '@ailover/cognition';
import type { Character, CharacterId, PersonalityTemplateId } from '@ailover/domain';
import type { EpisodeSource, EpisodicMemoryRepository, MemoryRepository, MemoryType,
  ConsolidatedMemory, FutureIntention, StoredEpisode, StoredMemory } from '@ailover/memory';
import type { CompanionSettings } from '@ailover/contracts';

import { CURRENT_SCHEMA_VERSION, migrate } from './migrations';
import { characters, conversations, messages, modelProfiles, personalityBaselines } from './schema';

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
  sqlite.prepare("UPDATE messages SET status = 'failed' WHERE status = 'streaming'").run();
  sqlite.prepare(`INSERT OR IGNORE INTO users(id, display_name, locale, timezone, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(
    LOCAL_USER_ID, '本地用户', 'zh-CN', 'Asia/Shanghai', new Date().toISOString(),
  );
  return { sqlite, orm: drizzle(sqlite), close: () => { if (sqlite.open) sqlite.close(); } };
}

export async function createSanitizedDatabaseSnapshot(
  database: AppDatabase, destination: string,
): Promise<void> {
  await database.sqlite.backup(destination);
  const snapshot = new Database(destination);
  try {
    snapshot.prepare('UPDATE model_profiles SET encrypted_api_key = NULL').run();
    snapshot.pragma('wal_checkpoint(TRUNCATE)');
  } finally { snapshot.close(); }
}

export function validateRestoredDatabase(path: string): { schemaVersion: number } {
  const candidate = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const integrity = candidate.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity.integrity_check !== 'ok') throw new Error('备份数据库完整性检查失败。');
    const required = ['users', 'characters', 'schema_migrations'];
    const tables = candidate.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
      .map((row) => (row as { name: string }).name);
    if (required.some((table) => !tables.includes(table))) throw new Error('备份缺少必要数据表。');
    const row = candidate.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
      .get() as { version: number };
    if (row.version > CURRENT_SCHEMA_VERSION) throw new Error('备份来自更高版本的 AiLover。');
    return { schemaVersion: row.version };
  } finally { candidate.close(); }
}

export function prepareRestoredDatabase(
  path: string, assetRoot: string, availableAssetPaths?: ReadonlySet<string>,
): void {
  const candidate = new Database(path);
  try {
    candidate.prepare('UPDATE model_profiles SET encrypted_api_key = NULL').run();
    const rows = candidate.prepare('SELECT id, character_id, local_path FROM assets').all() as
      { id: string; character_id: string; local_path: string }[];
    const update = candidate.prepare('UPDATE assets SET local_path = ? WHERE id = ?');
    candidate.transaction(() => {
      for (const row of rows) {
        const rawExtension = extname(row.local_path).toLowerCase();
        const extension = rawExtension === '.jpeg' ? '.jpg' : rawExtension;
        if (!['.png', '.jpg', '.webp'].includes(extension)) {
          throw new Error('备份包含不支持的角色资产类型。');
        }
        const relativePath = `assets/${row.character_id}/${row.id}${extension}`;
        if (availableAssetPaths && !availableAssetPaths.has(relativePath)) {
          throw new Error('备份缺少数据库引用的角色资产。');
        }
        update.run(join(assetRoot, row.character_id, `${row.id}${extension}`), row.id);
      }
    })();
  } finally { candidate.close(); }
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

export type StoredCharacterAsset = {
  id: string; characterId: string; type: 'portrait'; source: 'imported' | 'generated';
  version: number; localPath: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  checksum: string; fileName: string; metadata: Record<string, unknown>; createdAt: Date;
};

export type StoredVisualIdentity = {
  characterId: string; identityDescription: string; generationPrompt: string;
  negativePrompt: string; updatedAt: Date;
};

export class SqliteVisualAssetRepository {
  public constructor(private readonly database: AppDatabase) {}

  public getIdentity(characterId: string): StoredVisualIdentity | null {
    const row = this.database.sqlite.prepare(`SELECT * FROM character_visual_identities
      WHERE character_id = ?`).get(characterId) as Record<string, string> | undefined;
    return row ? { characterId: row.character_id!, identityDescription: row.identity_description!,
      generationPrompt: row.generation_prompt!, negativePrompt: row.negative_prompt!,
      updatedAt: new Date(row.updated_at!) } : null;
  }

  public saveIdentity(identity: StoredVisualIdentity): void {
    this.database.sqlite.prepare(`INSERT INTO character_visual_identities(character_id,
      identity_description, generation_prompt, negative_prompt, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(character_id) DO UPDATE SET identity_description = excluded.identity_description,
      generation_prompt = excluded.generation_prompt, negative_prompt = excluded.negative_prompt,
      updated_at = excluded.updated_at`).run(identity.characterId, identity.identityDescription,
      identity.generationPrompt, identity.negativePrompt, identity.updatedAt.toISOString());
  }

  public getCurrentAsset(characterId: string): StoredCharacterAsset | null {
    const row = this.database.sqlite.prepare(`SELECT * FROM assets WHERE character_id = ?
      AND type = 'portrait' ORDER BY version DESC LIMIT 1`).get(characterId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { id: String(row.id), characterId: String(row.character_id), type: 'portrait',
      source: row.source as StoredCharacterAsset['source'], version: Number(row.version),
      localPath: String(row.local_path), mimeType: row.mime_type as StoredCharacterAsset['mimeType'],
      checksum: String(row.checksum), fileName: String(row.file_name),
      metadata: JSON.parse(String(row.metadata)) as Record<string, unknown>,
      createdAt: new Date(String(row.created_at)) };
  }

  public saveAsset(asset: Omit<StoredCharacterAsset, 'version'>): StoredCharacterAsset {
    const result = this.database.sqlite.prepare(`SELECT COALESCE(MAX(version), 0) + 1 AS version
      FROM assets WHERE character_id = ? AND type = ?`).get(asset.characterId, asset.type) as { version: number };
    const stored = { ...asset, version: result.version };
    this.database.sqlite.prepare(`INSERT INTO assets(id, character_id, type, source, version,
      local_path, mime_type, checksum, file_name, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(stored.id, stored.characterId, stored.type,
      stored.source, stored.version, stored.localPath, stored.mimeType, stored.checksum,
      stored.fileName, JSON.stringify(stored.metadata), stored.createdAt.toISOString());
    return stored;
  }
}

export class SqliteConversationRepository implements ConversationRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async findCurrent(characterId: string): Promise<StoredConversation | null> {
    const row = this.database.orm.select().from(conversations)
      .where(eq(conversations.characterId, characterId))
      .orderBy(desc(conversations.lastMessageAt)).limit(1).get();
    return row ? this.toConversation(row) : null;
  }

  public async create(conversation: StoredConversation): Promise<void> {
    this.database.orm.insert(conversations).values({
      id: conversation.id, userId: LOCAL_USER_ID, characterId: conversation.characterId,
      title: conversation.title, startedAt: conversation.startedAt.toISOString(),
      lastMessageAt: conversation.lastMessageAt.toISOString(),
    }).run();
  }

  public async listMessages(conversationId: string): Promise<StoredChatMessage[]> {
    const rows = this.database.sqlite.prepare(`SELECT * FROM (
      SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
    ) ORDER BY created_at, id`).all(conversationId, MAX_RETAINED_CHAT_MESSAGES) as
      (typeof messages.$inferSelect)[];
    return rows.map((row) => this.toMessage(row));
  }

  public async searchMessages(conversationId: string, query: string, limit: number): Promise<StoredChatMessage[]> {
    const rows = this.database.sqlite.prepare(`SELECT * FROM messages
      WHERE conversation_id = ? AND content LIKE ? ESCAPE '\\'
      ORDER BY created_at DESC, id DESC LIMIT ?`).all(
      conversationId, `%${query.replace(/[\\%_]/g, '\\$&')}%`, limit,
    ) as (typeof messages.$inferSelect)[];
    return rows.reverse().map((row) => this.toMessage(row));
  }

  public async listMessagesAround(
    conversationId: string,
    messageId: string,
    radius: number,
  ): Promise<StoredChatMessage[]> {
    const rows = this.database.sqlite.prepare(`WITH ordered AS (
      SELECT *, ROW_NUMBER() OVER (ORDER BY created_at, id) AS row_number
      FROM messages WHERE conversation_id = ?
    ), target AS (
      SELECT row_number FROM ordered WHERE id = ?
    )
    SELECT ordered.* FROM ordered, target
    WHERE ordered.row_number BETWEEN target.row_number - ? AND target.row_number + ?
    ORDER BY ordered.row_number`).all(conversationId, messageId, radius, radius) as
      (typeof messages.$inferSelect)[];
    return rows.map((row) => this.toMessage(row));
  }

  public async findMessage(id: string): Promise<StoredChatMessage | null> {
    const row = this.database.orm.select().from(messages).where(eq(messages.id, id)).limit(1).get();
    return row ? this.toMessage(row) : null;
  }

  public async saveMessage(message: StoredChatMessage): Promise<void> {
    this.database.orm.insert(messages).values({
      id: message.id, conversationId: message.conversationId, role: message.role,
      content: message.content, status: message.status, model: message.model,
      createdAt: message.createdAt.toISOString(),
    }).run();
  }

  public async updateMessage(
    id: string,
    patch: Pick<StoredChatMessage, 'content' | 'status'> & Partial<Pick<StoredChatMessage, 'model'>>,
  ): Promise<void> {
    this.database.orm.update(messages).set(patch).where(eq(messages.id, id)).run();
  }

  public async touch(conversationId: string, at: Date): Promise<void> {
    this.database.orm.update(conversations).set({ lastMessageAt: at.toISOString() })
      .where(eq(conversations.id, conversationId)).run();
  }

  private toConversation(row: typeof conversations.$inferSelect): StoredConversation {
    return { id: row.id, characterId: row.characterId, title: row.title,
      startedAt: new Date(row.startedAt), lastMessageAt: new Date(row.lastMessageAt) };
  }

  private toMessage(row: typeof messages.$inferSelect & Partial<{
    conversation_id: string; created_at: string;
  }>): StoredChatMessage {
    return { id: row.id, conversationId: row.conversationId ?? row.conversation_id!,
      role: row.role as StoredChatMessage['role'], content: row.content,
      status: row.status as StoredChatMessage['status'], model: row.model,
      createdAt: new Date(row.createdAt ?? row.created_at!) };
  }
}

export class SqliteCompanionSettingsRepository {
  public constructor(private readonly database: AppDatabase) {}

  public get(): CompanionSettings & { lastPromptAt: Date | null } {
    const row = this.database.sqlite.prepare('SELECT * FROM companion_settings WHERE id = ?')
      .get('default') as { enabled: number; interval_minutes: number; quiet_start: string;
        quiet_end: string; desktop_pet_enabled: number; desktop_pet_roaming_enabled: number;
        last_prompt_at: string | null } | undefined;
    if (!row) return { enabled: false, intervalMinutes: 180, quietStart: '23:00', quietEnd: '08:00',
      desktopPetEnabled: false, desktopPetRoamingEnabled: true, lastPromptAt: null };
    return { enabled: Boolean(row.enabled), intervalMinutes: row.interval_minutes,
      quietStart: row.quiet_start, quietEnd: row.quiet_end,
      desktopPetEnabled: Boolean(row.desktop_pet_enabled),
      desktopPetRoamingEnabled: Boolean(row.desktop_pet_roaming_enabled),
      lastPromptAt: row.last_prompt_at ? new Date(row.last_prompt_at) : null };
  }

  public save(settings: CompanionSettings): void {
    this.database.sqlite.prepare(`INSERT INTO companion_settings
      (id, enabled, interval_minutes, quiet_start, quiet_end, desktop_pet_enabled,
        desktop_pet_roaming_enabled, last_prompt_at, updated_at)
      VALUES ('default', ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled,
        interval_minutes = excluded.interval_minutes, quiet_start = excluded.quiet_start,
        quiet_end = excluded.quiet_end, desktop_pet_enabled = excluded.desktop_pet_enabled,
        desktop_pet_roaming_enabled = excluded.desktop_pet_roaming_enabled,
        updated_at = excluded.updated_at`).run(
      settings.enabled ? 1 : 0, settings.intervalMinutes, settings.quietStart,
      settings.quietEnd, settings.desktopPetEnabled ? 1 : 0,
      settings.desktopPetRoamingEnabled ? 1 : 0, new Date().toISOString(),
    );
  }

  public recordPrompt(at: Date): void {
    this.database.sqlite.prepare('UPDATE companion_settings SET last_prompt_at = ?, updated_at = ? WHERE id = ?')
      .run(at.toISOString(), at.toISOString(), 'default');
  }
}

export type DesktopPetWindowBounds = { x: number; y: number; width: number; height: number };

export class SqliteDesktopPetWindowStateRepository {
  public constructor(private readonly database: AppDatabase) {}

  public get(): DesktopPetWindowBounds | null {
    const row = this.database.sqlite.prepare(`SELECT x, y, width, height
      FROM desktop_pet_window_state WHERE id = ?`).get('default') as DesktopPetWindowBounds | undefined;
    return row ?? null;
  }

  public save(bounds: DesktopPetWindowBounds): void {
    this.database.sqlite.prepare(`INSERT INTO desktop_pet_window_state
      (id, x, y, width, height, updated_at) VALUES ('default', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET x = excluded.x, y = excluded.y, width = excluded.width,
        height = excluded.height, updated_at = excluded.updated_at`).run(
      bounds.x, bounds.y, bounds.width, bounds.height, new Date().toISOString(),
    );
  }
}

type MemoryRow = {
  id: string; user_id: string; character_id: string; type: string; subject: string; content: string;
  normalized_key: string; confidence: number; importance: number; emotional_weight: number;
  polarity: string; recall_strength: number; reinforcement_count: number; state: string;
  first_seen_at: string; last_seen_at: string; last_recalled_at: string | null; expires_at: string | null;
};

export class SqliteMemoryRepository implements MemoryRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async findByKey(characterId: string, normalizedKey: string): Promise<StoredMemory[]> {
    const rows = this.database.sqlite.prepare(`SELECT * FROM memories
      WHERE character_id = ? AND normalized_key = ? AND state = 'active'`).all(
      characterId, normalizedKey,
    ) as MemoryRow[];
    return rows.map(toStoredMemory);
  }

  public async save(memory: StoredMemory, sourceMessageId: string): Promise<void> {
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare(`INSERT INTO memories(
        id, user_id, character_id, type, subject, content, normalized_key, confidence, importance,
        emotional_weight, polarity, recall_strength, reinforcement_count, state, first_seen_at,
        last_seen_at, last_recalled_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        memory.id, memory.userId, memory.characterId, memory.type, memory.subject, memory.content,
        memory.normalizedKey, memory.confidence, memory.importance, memory.emotionalWeight,
        memory.polarity, memory.recallStrength, memory.reinforcementCount, memory.state,
        memory.firstSeenAt.toISOString(), memory.lastSeenAt.toISOString(),
        memory.lastRecalledAt?.toISOString() ?? null, memory.expiresAt?.toISOString() ?? null,
      );
      this.insertSource(memory.id, sourceMessageId, memory.evidence, memory.firstSeenAt);
    })();
  }

  public async reinforce(id: string, sourceMessageId: string, evidence: string, at: Date): Promise<void> {
    this.database.sqlite.transaction(() => {
      if (!this.insertSource(id, sourceMessageId, evidence, at)) return;
      this.database.sqlite.prepare(`UPDATE memories SET reinforcement_count = reinforcement_count + 1,
        recall_strength = MIN(1.0, recall_strength + 0.12), last_seen_at = ? WHERE id = ?`)
        .run(at.toISOString(), id);
    })();
  }

  public async link(fromId: string, toId: string, relation: 'contradicts' | 'supersedes'): Promise<void> {
    this.database.sqlite.prepare(`INSERT OR IGNORE INTO memory_links(
      from_memory_id, to_memory_id, relation, created_at) VALUES (?, ?, ?, ?)`)
      .run(fromId, toId, relation, new Date().toISOString());
  }

  public async searchCandidates(
    characterId: string,
    query: string,
    types: MemoryType[],
    now: Date,
  ): Promise<StoredMemory[]> {
    const found = new Map<string, MemoryRow>();
    const base = `character_id = ? AND state = 'active' AND (expires_at IS NULL OR expires_at > ?)`;
    if (types.length) {
      const placeholders = types.map(() => '?').join(', ');
      const rows = this.database.sqlite.prepare(`SELECT * FROM memories WHERE ${base}
        AND type IN (${placeholders}) ORDER BY importance DESC, last_seen_at DESC LIMIT 60`)
        .all(characterId, now.toISOString(), ...types) as MemoryRow[];
      for (const row of rows) found.set(row.id, row);
    }
    const ftsQuery = toFtsQuery(query);
    if (ftsQuery) {
      const rows = this.database.sqlite.prepare(`SELECT memories.* FROM memories
        JOIN memories_fts ON memories_fts.memory_id = memories.id
        WHERE ${base} AND memories_fts MATCH ? LIMIT 60`)
        .all(characterId, now.toISOString(), ftsQuery) as MemoryRow[];
      for (const row of rows) found.set(row.id, row);
    }
    if (!found.size) {
      const rows = this.database.sqlite.prepare(`SELECT * FROM memories WHERE ${base}
        ORDER BY importance DESC, last_seen_at DESC LIMIT 40`)
        .all(characterId, now.toISOString()) as MemoryRow[];
      for (const row of rows) found.set(row.id, row);
    }
    return [...found.values()].map(toStoredMemory);
  }

  public async recordRecall(memoryId: string, queryMessageId: string, score: number, at: Date): Promise<void> {
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare('UPDATE memories SET last_recalled_at = ? WHERE id = ?')
        .run(at.toISOString(), memoryId);
      this.database.sqlite.prepare(`INSERT INTO memory_recalls(
        memory_id, query_message_id, score, recalled_at) VALUES (?, ?, ?, ?)`)
        .run(memoryId, queryMessageId, score, at.toISOString());
    })();
  }

  public async listActive(characterId: string): Promise<StoredMemory[]> {
    return (this.database.sqlite.prepare(
      "SELECT * FROM memories WHERE character_id = ? AND state = 'active'",
    ).all(characterId) as MemoryRow[]).map(toStoredMemory);
  }

  public async listForCenter(characterId: string): Promise<StoredMemory[]> {
    return (this.database.sqlite.prepare(`SELECT * FROM memories
      WHERE character_id = ? ORDER BY last_seen_at DESC`)
      .all(characterId) as MemoryRow[]).map(toStoredMemory);
  }

  public async getPrimarySource(characterId: string, memoryId: string): Promise<{
    messageId: string; conversationId: string; excerpt: string; evidence: string; createdAt: Date;
  } | null> {
    return (await this.getSources(characterId, memoryId, 1))[0] ?? null;
  }

  public async getSources(characterId: string, memoryId: string, limit = 20): Promise<{
    messageId: string; conversationId: string; excerpt: string; evidence: string; createdAt: Date;
  }[]> {
    const rows = this.database.sqlite.prepare(`SELECT messages.id AS message_id,
      messages.conversation_id, messages.content, memory_sources.evidence, memory_sources.created_at
      FROM memories JOIN memory_sources ON memory_sources.memory_id = memories.id
      JOIN messages ON messages.id = memory_sources.message_id
      WHERE memories.id = ? AND memories.character_id = ?
      ORDER BY memory_sources.created_at ASC LIMIT ?`).all(memoryId, characterId,
      Math.max(1, Math.min(20, limit))) as { message_id: string; conversation_id: string;
        content: string; evidence: string; created_at: string }[];
    return rows.map((row) => ({ messageId: row.message_id, conversationId: row.conversation_id,
      excerpt: row.content.slice(0, 180), evidence: row.evidence, createdAt: new Date(row.created_at) }));
  }

  public async getRelations(characterId: string, memoryId: string): Promise<{
    memoryId: string; subject: string; content: string; state: StoredMemory['state'];
    relation: 'contradicts' | 'supersedes'; direction: 'outgoing' | 'incoming';
  }[]> {
    const rows = this.database.sqlite.prepare(`SELECT related.id, related.subject, related.content,
      related.state, memory_links.relation,
      CASE WHEN memory_links.from_memory_id = anchor.id THEN 'outgoing' ELSE 'incoming' END AS direction
      FROM memories AS anchor
      JOIN memory_links ON anchor.id IN (memory_links.from_memory_id, memory_links.to_memory_id)
      JOIN memories AS related ON related.id = CASE WHEN memory_links.from_memory_id = anchor.id
        THEN memory_links.to_memory_id ELSE memory_links.from_memory_id END
      WHERE anchor.id = ? AND anchor.character_id = ? AND related.character_id = ?
      ORDER BY memory_links.created_at DESC LIMIT 20`).all(memoryId, characterId, characterId) as {
        id: string; subject: string; content: string; state: StoredMemory['state'];
        relation: 'contradicts' | 'supersedes'; direction: 'outgoing' | 'incoming';
      }[];
    return rows.map((row) => ({ memoryId: row.id, subject: row.subject, content: row.content,
      state: row.state, relation: row.relation, direction: row.direction }));
  }

  public async updateStrength(id: string, strength: number, state: StoredMemory['state']): Promise<void> {
    this.database.sqlite.prepare('UPDATE memories SET recall_strength = ?, state = ? WHERE id = ?')
      .run(strength, state, id);
  }

  public async correct(characterId: string, id: string, content: string, importance: number, at: Date): Promise<boolean> {
    const result = this.database.sqlite.prepare(`UPDATE memories SET content = ?, importance = ?, last_seen_at = ?
      WHERE id = ? AND character_id = ?`).run(content, Math.max(0, Math.min(1, importance)),
      at.toISOString(), id, characterId);
    return result.changes > 0;
  }

  public async softDelete(characterId: string, id: string): Promise<boolean> {
    return this.database.sqlite.transaction(() => {
      const result = this.database.sqlite.prepare(`UPDATE memories SET state = 'expired', recall_strength = 0
        WHERE id = ? AND character_id = ? AND state = 'active'`).run(id, characterId);
      if (!result.changes) return false;
      this.database.sqlite.prepare(`INSERT OR REPLACE INTO memory_deletions(memory_id, character_id, deleted_at)
        VALUES (?, ?, ?)`).run(id, characterId, new Date().toISOString());
      return true;
    })();
  }

  public async wasSoftDeleted(characterId: string, id: string): Promise<boolean> {
    return Boolean(this.database.sqlite.prepare(`SELECT 1 FROM memory_deletions
      WHERE memory_id = ? AND character_id = ?`).get(id, characterId));
  }

  public async restore(characterId: string, id: string, now: Date): Promise<boolean> {
    return this.database.sqlite.transaction(() => {
      const eligible = this.database.sqlite.prepare(`SELECT memories.id FROM memories
        JOIN memory_deletions ON memory_deletions.memory_id = memories.id
        WHERE memories.id = ? AND memories.character_id = ? AND memory_deletions.character_id = ?
        AND memories.state = 'expired' AND (memories.expires_at IS NULL OR memories.expires_at > ?)`)
        .get(id, characterId, characterId, now.toISOString());
      if (!eligible) return false;
      this.database.sqlite.prepare(`UPDATE memories SET state = 'active', recall_strength = 0.5,
        last_seen_at = ? WHERE id = ? AND character_id = ?`).run(now.toISOString(), id, characterId);
      this.database.sqlite.prepare('DELETE FROM memory_deletions WHERE memory_id = ? AND character_id = ?')
        .run(id, characterId);
      return true;
    })();
  }

  private insertSource(memoryId: string, messageId: string, evidence: string, at: Date): boolean {
    const result = this.database.sqlite.prepare(`INSERT OR IGNORE INTO memory_sources(
      memory_id, message_id, evidence, created_at) VALUES (?, ?, ?, ?)`)
      .run(memoryId, messageId, evidence, at.toISOString());
    return result.changes > 0;
  }
}

export class SqliteFutureIntentionRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async save(characterId: string, intention: FutureIntention): Promise<void> {
    this.database.sqlite.prepare(`INSERT OR REPLACE INTO future_intentions(
      id, character_id, description, trigger_type, trigger_data, priority, source_memory_ids,
      status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(intention.id, characterId, intention.description, intention.triggerType,
        JSON.stringify(intention.triggerData), intention.priority, JSON.stringify(intention.sourceMemoryIds),
        intention.status, intention.createdAt.toISOString(), intention.expiresAt?.toISOString() ?? null);
  }

  public async listPending(characterId: string, now: Date): Promise<FutureIntention[]> {
    const rows = this.database.sqlite.prepare(`SELECT * FROM future_intentions
      WHERE character_id = ? AND status = 'pending' AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY priority DESC`).all(characterId, now.toISOString()) as FutureIntentionRow[];
    return rows.map(toFutureIntention);
  }

  public async updateStatus(id: string, status: FutureIntention['status']): Promise<void> {
    this.database.sqlite.prepare('UPDATE future_intentions SET status = ? WHERE id = ?').run(status, id);
  }

  public async expireBefore(characterId: string, now: Date): Promise<void> {
    this.database.sqlite.prepare(`UPDATE future_intentions SET status = 'expired'
      WHERE character_id = ? AND status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?`)
      .run(characterId, now.toISOString());
  }

  public async hasForSourceMemory(sourceMemoryId: string): Promise<boolean> {
    const rows = this.database.sqlite.prepare('SELECT source_memory_ids FROM future_intentions').all() as unknown as
      { source_memory_ids: string }[];
    return rows.some((row) => parseStringArray(row.source_memory_ids).includes(sourceMemoryId));
  }
}

export class SqliteConsolidatedMemoryRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async saveOrReinforce(characterId: string, memory: ConsolidatedMemory): Promise<void> {
    this.database.sqlite.transaction(() => {
      const existing = this.database.sqlite.prepare(`SELECT id FROM consolidated_memories
        WHERE character_id = ? AND type = ? AND statement = ? AND status = 'active' LIMIT 1`)
        .get(characterId, memory.type, memory.statement) as { id: string } | undefined;
      const id = existing?.id ?? memory.id;
      if (!existing) {
        this.database.sqlite.prepare(`INSERT INTO consolidated_memories(id, character_id, type,
          statement, confidence, importance, reinforcement_count, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, characterId, memory.type, memory.statement,
          memory.confidence, memory.importance, memory.reinforcementCount, memory.status,
          memory.createdAt.toISOString());
      }
      let added = 0;
      for (const episodeId of memory.sourceEpisodeIds) {
        added += this.database.sqlite.prepare(`INSERT OR IGNORE INTO consolidated_memory_sources(
          consolidated_memory_id, episode_id) VALUES (?, ?)`).run(id, episodeId).changes;
      }
      if (existing && added) this.database.sqlite.prepare(`UPDATE consolidated_memories SET
        reinforcement_count = reinforcement_count + ?, confidence = MAX(confidence, ?),
        importance = MAX(importance, ?) WHERE id = ?`).run(added, memory.confidence, memory.importance, id);
    })();
  }

  public async listActive(characterId: string): Promise<ConsolidatedMemory[]> {
    const rows = this.database.sqlite.prepare(`SELECT * FROM consolidated_memories
      WHERE character_id = ? AND status = 'active' ORDER BY importance DESC, created_at DESC`)
      .all(characterId) as ConsolidatedMemoryRow[];
    const sources = this.database.sqlite.prepare(`SELECT episode_id FROM consolidated_memory_sources
      WHERE consolidated_memory_id = ?`);
    return rows.map((row) => ({ id: row.id, type: row.type as ConsolidatedMemory['type'],
      statement: row.statement, confidence: row.confidence, importance: row.importance,
      sourceEpisodeIds: (sources.all(row.id) as { episode_id: string }[]).map(({ episode_id }) => episode_id),
      createdAt: new Date(row.created_at), reinforcementCount: row.reinforcement_count,
      status: row.status as ConsolidatedMemory['status'] }));
  }
}

export class SqliteSelfModelRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async saveIfNew(entry: Omit<SelfModelEntry, 'version'>): Promise<SelfModelEntry | null> {
    const existing = this.database.sqlite.prepare(`SELECT id FROM self_model_entries
      WHERE character_id = ? AND category = ? AND statement = ? LIMIT 1`)
      .get(entry.characterId, entry.category, entry.statement) as { id: string } | undefined;
    if (existing) return null;
    const row = this.database.sqlite.prepare(`SELECT COALESCE(MAX(version), 0) AS version
      FROM self_model_entries WHERE character_id = ?`).get(entry.characterId) as { version: number };
    const stored = { ...entry, version: row.version + 1 };
    this.database.sqlite.prepare(`INSERT INTO self_model_entries(id, character_id, category, statement,
      confidence, version, source_message_id, reason, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(stored.id, stored.characterId, stored.category,
        stored.statement, stored.confidence, stored.version, stored.sourceMessageId, stored.reason,
        stored.status, stored.createdAt.toISOString());
    return stored;
  }

  public async listActive(characterId: string, limit = 20): Promise<SelfModelEntry[]> {
    const rows = this.database.sqlite.prepare(`SELECT * FROM self_model_entries
      WHERE character_id = ? AND status = 'active' ORDER BY version DESC LIMIT ?`)
      .all(characterId, limit) as SelfModelRow[];
    return rows.map((row) => ({ id: row.id, characterId: row.character_id,
      category: row.category as SelfModelEntry['category'], statement: row.statement,
      confidence: row.confidence, version: row.version, sourceMessageId: row.source_message_id,
      reason: row.reason, status: row.status as SelfModelEntry['status'], createdAt: new Date(row.created_at) }));
  }
}

type SelfModelRow = { id: string; character_id: string; category: string; statement: string;
  confidence: number; version: number; source_message_id: string | null; reason: string;
  status: string; created_at: string };

type ConsolidatedMemoryRow = { id: string; type: string; statement: string; confidence: number;
  importance: number; reinforcement_count: number; status: string; created_at: string };

type FutureIntentionRow = { id: string; description: string; trigger_type: string; trigger_data: string;
  priority: number; source_memory_ids: string; status: string; created_at: string; expires_at: string | null };

function toFutureIntention(row: FutureIntentionRow): FutureIntention {
  return { id: row.id, description: row.description, triggerType: row.trigger_type as FutureIntention['triggerType'],
    triggerData: JSON.parse(row.trigger_data) as FutureIntention['triggerData'], priority: row.priority,
    sourceMemoryIds: JSON.parse(row.source_memory_ids) as string[], status: row.status as FutureIntention['status'],
    createdAt: new Date(row.created_at), expiresAt: row.expires_at ? new Date(row.expires_at) : null };
}

type EpisodeRow = {
  id: string; character_id: string; conversation_id: string; kind: string; fingerprint: string;
  title: string; summary: string; context: string | null; participants: string;
  user_action: string; ai_action: string | null; user_emotion: string | null; ai_emotion: string | null;
  relationship_relevance: number; emotional_weight: number; importance: number; confidence: number;
  reinforcement_count: number; status: string; related_memory_ids: string; tags: string;
  event_time: string; created_at: string; last_recalled_at: string | null;
};

export class SqliteEpisodicMemoryRepository implements EpisodicMemoryRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async findByFingerprint(characterId: string, fingerprint: string): Promise<StoredEpisode | null> {
    const row = this.database.sqlite.prepare(`SELECT * FROM episodic_memories
      WHERE character_id = ? AND fingerprint = ? AND status IN ('active', 'faded') LIMIT 1`)
      .get(characterId, fingerprint) as EpisodeRow | undefined;
    return row ? this.toEpisode(row) : null;
  }

  public async save(episode: StoredEpisode, sources: EpisodeSource[]): Promise<void> {
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare(`INSERT INTO episodic_memories(id, character_id, conversation_id,
        kind, fingerprint, title, summary, context, participants, user_action, ai_action,
        user_emotion, ai_emotion, relationship_relevance, emotional_weight, importance, confidence,
        reinforcement_count, status, related_memory_ids, tags, event_time, created_at, last_recalled_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(episode.id, episode.characterId, episode.conversationId, episode.kind,
          episode.fingerprint, episode.title, episode.summary, episode.context,
          JSON.stringify(episode.participants), episode.userAction, episode.aiAction,
          episode.userEmotion, episode.aiEmotion, episode.relationshipRelevance,
          episode.emotionalWeight, episode.importance, episode.confidence,
          episode.reinforcementCount, episode.status, JSON.stringify(episode.relatedMemoryIds),
          JSON.stringify(episode.tags), episode.eventTime.toISOString(), episode.createdAt.toISOString(),
          episode.lastRecalledAt?.toISOString() ?? null);
      this.insertSources(episode.id, sources, episode.createdAt);
    })();
  }

  public async reinforce(id: string, sources: EpisodeSource[], relatedMemoryIds: string[]): Promise<void> {
    this.database.sqlite.transaction(() => {
      const row = this.database.sqlite.prepare('SELECT related_memory_ids FROM episodic_memories WHERE id = ?')
        .get(id) as { related_memory_ids: string } | undefined;
      if (!row) return;
      const inserted = this.insertSources(id, sources, new Date());
      const related = [...new Set([...parseStringArray(row.related_memory_ids), ...relatedMemoryIds])];
      this.database.sqlite.prepare(`UPDATE episodic_memories SET
        reinforcement_count = reinforcement_count + ?, related_memory_ids = ?, status = 'active'
        WHERE id = ?`).run(inserted ? 1 : 0, JSON.stringify(related), id);
    })();
  }

  public async searchCandidates(
    characterId: string,
    query: string,
    includeRecent: boolean,
    limit: number,
  ): Promise<StoredEpisode[]> {
    const found = new Map<string, EpisodeRow>();
    const ftsQuery = toFtsQuery(query);
    if (ftsQuery) {
      const rows = this.database.sqlite.prepare(`SELECT episodic_memories.* FROM episodic_memories
        JOIN episodes_fts ON episodes_fts.episode_id = episodic_memories.id
        WHERE character_id = ? AND status IN ('active', 'faded') AND episodes_fts MATCH ?
        LIMIT ?`).all(characterId, ftsQuery, limit) as EpisodeRow[];
      for (const row of rows) found.set(row.id, row);
    }
    if (includeRecent) {
      const rows = this.database.sqlite.prepare(`SELECT * FROM episodic_memories
        WHERE character_id = ? AND status IN ('active', 'faded')
        ORDER BY importance DESC, event_time DESC LIMIT ?`).all(characterId, limit) as EpisodeRow[];
      for (const row of rows) found.set(row.id, row);
    }
    return [...found.values()].slice(0, limit).map((row) => this.toEpisode(row));
  }

  public async recordRecall(episodeId: string, queryMessageId: string, score: number, at: Date): Promise<void> {
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare('UPDATE episodic_memories SET last_recalled_at = ? WHERE id = ?')
        .run(at.toISOString(), episodeId);
      this.database.sqlite.prepare(`INSERT INTO episode_recalls(
        episode_id, query_message_id, score, recalled_at) VALUES (?, ?, ?, ?)`)
        .run(episodeId, queryMessageId, score, at.toISOString());
    })();
  }

  private insertSources(episodeId: string, sources: EpisodeSource[], at: Date): boolean {
    const insert = this.database.sqlite.prepare(`INSERT OR IGNORE INTO episode_sources(
      episode_id, message_id, role, created_at) VALUES (?, ?, ?, ?)`);
    return sources.reduce((changed, source) => insert.run(
      episodeId, source.messageId, source.role, at.toISOString(),
    ).changes > 0 || changed, false);
  }

  private toEpisode(row: EpisodeRow): StoredEpisode {
    const sources = this.database.sqlite.prepare(`SELECT message_id FROM episode_sources
      WHERE episode_id = ? ORDER BY created_at,
      CASE role WHEN 'user' THEN 0 ELSE 1 END, message_id`).all(row.id) as { message_id: string }[];
    return { id: row.id, characterId: row.character_id, conversationId: row.conversation_id,
      kind: row.kind as StoredEpisode['kind'], fingerprint: row.fingerprint,
      title: row.title, summary: row.summary, context: row.context,
      participants: parseStringArray(row.participants), userAction: row.user_action,
      aiAction: row.ai_action, userEmotion: row.user_emotion, aiEmotion: row.ai_emotion,
      relationshipRelevance: row.relationship_relevance, emotionalWeight: row.emotional_weight,
      importance: row.importance, confidence: row.confidence,
      reinforcementCount: row.reinforcement_count, status: row.status as StoredEpisode['status'],
      sourceMessageIds: sources.map(({ message_id }) => message_id),
      relatedMemoryIds: parseStringArray(row.related_memory_ids), tags: parseStringArray(row.tags),
      eventTime: new Date(row.event_time), createdAt: new Date(row.created_at),
      lastRecalledAt: row.last_recalled_at ? new Date(row.last_recalled_at) : null };
  }
}

type EmotionRow = { id: string; character_id: string; valence: number; arousal: number;
  security: number; affection: number; reason: string; source_message_id: string | null;
  rule_version: string; recorded_at: string };
type RelationshipRow = { trust: number; intimacy: number; affection: number; familiarity: number;
  comfort: number; conflict: number };
type PersonalityRow = { warmth: number; energy: number; reserve: number; playfulness: number;
  maturity: number; rationality: number; initiative: number };

export class SqliteCognitionRepository implements CognitionRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async getCurrent(characterId: string): Promise<CognitionSnapshot | null> {
    const emotion = this.database.sqlite.prepare(`SELECT * FROM emotion_states
      WHERE character_id = ? ORDER BY recorded_at DESC, rowid DESC LIMIT 1`).get(characterId) as
      EmotionRow | undefined;
    if (!emotion) return null;
    const relationship = this.database.sqlite.prepare(`SELECT trust, intimacy, affection, familiarity,
      comfort, conflict FROM relationship_states WHERE character_id = ?
      ORDER BY recorded_at DESC, rowid DESC LIMIT 1`).get(characterId) as RelationshipRow | undefined;
    const personality = this.database.sqlite.prepare(`SELECT warmth, energy, reserve, playfulness,
      maturity, rationality, initiative FROM personality_states WHERE character_id = ?
      ORDER BY recorded_at DESC, rowid DESC LIMIT 1`).get(characterId) as PersonalityRow | undefined;
    if (!relationship || !personality) throw new Error('Incomplete cognition snapshot');
    return { id: emotion.id, characterId: emotion.character_id,
      emotion: { valence: emotion.valence, arousal: emotion.arousal,
        security: emotion.security, affection: emotion.affection },
      relationship, personality, reason: emotion.reason,
      sourceMessageId: emotion.source_message_id, ruleVersion: emotion.rule_version,
      recordedAt: new Date(emotion.recorded_at) };
  }

  public async saveSnapshot(snapshot: CognitionSnapshot): Promise<void> {
    const common = [snapshot.reason, snapshot.sourceMessageId, snapshot.ruleVersion,
      snapshot.recordedAt.toISOString()];
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare(`INSERT INTO emotion_states(id, character_id, valence, arousal,
        security, affection, reason, source_message_id, rule_version, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(snapshot.id, snapshot.characterId,
        snapshot.emotion.valence, snapshot.emotion.arousal, snapshot.emotion.security,
        snapshot.emotion.affection, ...common);
      this.database.sqlite.prepare(`INSERT INTO relationship_states(id, character_id, trust, intimacy,
        affection, familiarity, comfort, conflict, reason, source_message_id, rule_version, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(snapshot.id, snapshot.characterId,
        snapshot.relationship.trust, snapshot.relationship.intimacy, snapshot.relationship.affection,
        snapshot.relationship.familiarity, snapshot.relationship.comfort,
        snapshot.relationship.conflict, ...common);
      this.database.sqlite.prepare(`INSERT INTO personality_states(id, character_id, warmth, energy,
        reserve, playfulness, maturity, rationality, initiative, reason, source_message_id,
        rule_version, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(snapshot.id, snapshot.characterId, snapshot.personality.warmth, snapshot.personality.energy,
          snapshot.personality.reserve, snapshot.personality.playfulness, snapshot.personality.maturity,
          snapshot.personality.rationality, snapshot.personality.initiative, ...common);
    })();
  }

  public async addEvidence(evidence: EvolutionEvidence): Promise<number> {
    this.database.sqlite.prepare(`INSERT OR IGNORE INTO personality_evidence(character_id, trait,
      direction, source_message_id, reason, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      evidence.characterId, evidence.trait, evidence.direction, evidence.sourceMessageId,
      evidence.reason, evidence.recordedAt.toISOString(),
    );
    const result = this.database.sqlite.prepare(`SELECT COUNT(*) AS count FROM personality_evidence
      WHERE character_id = ? AND trait = ? AND direction = ?`).get(
      evidence.characterId, evidence.trait, evidence.direction,
    ) as { count: number };
    return result.count;
  }

  public async listEvidence(characterId: string, limit = 100): Promise<EvolutionEvidence[]> {
    const rows = this.database.sqlite.prepare(`SELECT trait, direction, source_message_id, reason, recorded_at
      FROM personality_evidence WHERE character_id = ? ORDER BY recorded_at DESC, id DESC LIMIT ?`)
      .all(characterId, limit) as { trait: string; direction: number; source_message_id: string;
        reason: string; recorded_at: string }[];
    return rows.map((row) => ({ characterId, trait: row.trait as EvolutionEvidence['trait'],
      direction: row.direction as EvolutionEvidence['direction'], sourceMessageId: row.source_message_id,
      reason: row.reason, recordedAt: new Date(row.recorded_at) }));
  }

  public async saveReflection(reflection: ReflectionRecord): Promise<void> {
    this.database.sqlite.prepare(`INSERT INTO reflections(id, character_id, trigger_message_id,
      summary, importance, rule_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      reflection.id, reflection.characterId, reflection.triggerMessageId, reflection.summary,
      reflection.importance, reflection.ruleVersion, reflection.createdAt.toISOString(),
    );
  }
}

function toStoredMemory(row: MemoryRow): StoredMemory {
  return { id: row.id, userId: row.user_id, characterId: row.character_id,
    type: row.type as StoredMemory['type'], subject: row.subject, content: row.content,
    normalizedKey: row.normalized_key, confidence: row.confidence, importance: row.importance,
    emotionalWeight: row.emotional_weight, polarity: row.polarity as StoredMemory['polarity'],
    recallStrength: row.recall_strength, reinforcementCount: row.reinforcement_count,
    state: row.state as StoredMemory['state'], firstSeenAt: new Date(row.first_seen_at),
    lastSeenAt: new Date(row.last_seen_at),
    lastRecalledAt: row.last_recalled_at ? new Date(row.last_recalled_at) : null,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null, evidence: row.content };
}

function toFtsQuery(query: string): string {
  const normalized = query.replace(/[^\p{L}\p{N}]+/gu, '');
  if (normalized.length < 3) return '';
  const terms = Array.from({ length: Math.min(normalized.length - 2, 16) },
    (_, index) => normalized.slice(index, index + 3));
  return [...new Set(terms)].map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

export { CURRENT_SCHEMA_VERSION, migrate } from './migrations';
export { assets, characters, characterVisualIdentities, conversations, emotionStates, memories, episodicMemories,
  consolidatedMemories, desktopPetWindowState, futureIntentions, memoryDeletions, messages, modelProfiles, personalityBaselines, personalityStates, reflections, selfModelEntries,
  relationshipStates, users } from './schema';
