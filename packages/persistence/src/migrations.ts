import type Database from 'better-sqlite3';

const migrations = [{
  version: 1,
  sql: `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, locale TEXT NOT NULL,
      timezone TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL, gender TEXT NOT NULL, age_setting TEXT NOT NULL,
      identity TEXT NOT NULL, background TEXT NOT NULL, appearance TEXT NOT NULL,
      speaking_style TEXT NOT NULL, personality_template_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'archived')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS characters_one_active
      ON characters(user_id) WHERE status = 'active';
    CREATE TABLE IF NOT EXISTS personality_baselines (
      character_id TEXT PRIMARY KEY NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      warmth REAL NOT NULL CHECK(warmth BETWEEN 0 AND 1),
      energy REAL NOT NULL CHECK(energy BETWEEN 0 AND 1),
      reserve REAL NOT NULL CHECK(reserve BETWEEN 0 AND 1),
      playfulness REAL NOT NULL CHECK(playfulness BETWEEN 0 AND 1),
      maturity REAL NOT NULL CHECK(maturity BETWEEN 0 AND 1),
      rationality REAL NOT NULL CHECK(rationality BETWEEN 0 AND 1),
      initiative REAL NOT NULL CHECK(initiative BETWEEN 0 AND 1), created_at TEXT NOT NULL
    );
  `,
}, {
  version: 2,
  sql: `
    CREATE TABLE IF NOT EXISTS model_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('openai-compatible', 'ollama')),
      endpoint TEXT NOT NULL,
      model TEXT NOT NULL,
      encrypted_api_key TEXT,
      updated_at TEXT NOT NULL
    );
  `,
}, {
  version: 3,
  sql: `
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      character_id TEXT NOT NULL REFERENCES characters(id),
      title TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_message_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conversations_character_recent
      ON conversations(character_id, last_message_at DESC);
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY NOT NULL,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('streaming', 'completed', 'failed', 'cancelled')),
      model TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_conversation_order
      ON messages(conversation_id, created_at, id);
  `,
}, {
  version: 4,
  sql: `
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      character_id TEXT NOT NULL REFERENCES characters(id),
      type TEXT NOT NULL CHECK(type IN ('semantic', 'preference', 'plan', 'episodic', 'relationship')),
      subject TEXT NOT NULL,
      content TEXT NOT NULL,
      normalized_key TEXT NOT NULL,
      confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
      importance REAL NOT NULL CHECK(importance BETWEEN 0 AND 1),
      emotional_weight REAL NOT NULL CHECK(emotional_weight BETWEEN 0 AND 1),
      polarity TEXT NOT NULL CHECK(polarity IN ('positive', 'negative', 'neutral')),
      recall_strength REAL NOT NULL CHECK(recall_strength BETWEEN 0 AND 1),
      reinforcement_count INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('active', 'superseded', 'expired')),
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_recalled_at TEXT,
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS memories_lookup
      ON memories(character_id, normalized_key, state);
    CREATE INDEX IF NOT EXISTS memories_rank
      ON memories(character_id, state, type, importance DESC, last_seen_at DESC);
    CREATE TABLE IF NOT EXISTS memory_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES messages(id),
      evidence TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(memory_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS memory_links (
      from_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      to_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      relation TEXT NOT NULL CHECK(relation IN ('contradicts', 'supersedes')),
      created_at TEXT NOT NULL,
      PRIMARY KEY(from_memory_id, to_memory_id, relation)
    );
    CREATE TABLE IF NOT EXISTS memory_recalls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      query_message_id TEXT NOT NULL REFERENCES messages(id),
      score REAL NOT NULL,
      recalled_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      memory_id UNINDEXED, subject, content, tokenize='trigram'
    );
    CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(memory_id, subject, content) VALUES (new.id, new.subject, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE OF subject, content ON memories BEGIN
      DELETE FROM memories_fts WHERE memory_id = old.id;
      INSERT INTO memories_fts(memory_id, subject, content) VALUES (new.id, new.subject, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
      DELETE FROM memories_fts WHERE memory_id = old.id;
    END;
  `,
}, {
  version: 5,
  sql: `
    CREATE TABLE IF NOT EXISTS emotion_states (
      id TEXT PRIMARY KEY NOT NULL,
      character_id TEXT NOT NULL REFERENCES characters(id),
      valence REAL NOT NULL CHECK(valence BETWEEN 0 AND 1),
      arousal REAL NOT NULL CHECK(arousal BETWEEN 0 AND 1),
      security REAL NOT NULL CHECK(security BETWEEN 0 AND 1),
      affection REAL NOT NULL CHECK(affection BETWEEN 0 AND 1),
      reason TEXT NOT NULL, source_message_id TEXT REFERENCES messages(id),
      rule_version TEXT NOT NULL, recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS emotion_states_current
      ON emotion_states(character_id, recorded_at DESC);
    CREATE TABLE IF NOT EXISTS relationship_states (
      id TEXT PRIMARY KEY NOT NULL,
      character_id TEXT NOT NULL REFERENCES characters(id),
      trust REAL NOT NULL CHECK(trust BETWEEN 0 AND 1),
      intimacy REAL NOT NULL CHECK(intimacy BETWEEN 0 AND 1),
      affection REAL NOT NULL CHECK(affection BETWEEN 0 AND 1),
      familiarity REAL NOT NULL CHECK(familiarity BETWEEN 0 AND 1),
      comfort REAL NOT NULL CHECK(comfort BETWEEN 0 AND 1),
      conflict REAL NOT NULL CHECK(conflict BETWEEN 0 AND 1),
      reason TEXT NOT NULL, source_message_id TEXT REFERENCES messages(id),
      rule_version TEXT NOT NULL, recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS relationship_states_current
      ON relationship_states(character_id, recorded_at DESC);
    CREATE TABLE IF NOT EXISTS personality_states (
      id TEXT PRIMARY KEY NOT NULL,
      character_id TEXT NOT NULL REFERENCES characters(id),
      warmth REAL NOT NULL CHECK(warmth BETWEEN 0 AND 1),
      energy REAL NOT NULL CHECK(energy BETWEEN 0 AND 1),
      reserve REAL NOT NULL CHECK(reserve BETWEEN 0 AND 1),
      playfulness REAL NOT NULL CHECK(playfulness BETWEEN 0 AND 1),
      maturity REAL NOT NULL CHECK(maturity BETWEEN 0 AND 1),
      rationality REAL NOT NULL CHECK(rationality BETWEEN 0 AND 1),
      initiative REAL NOT NULL CHECK(initiative BETWEEN 0 AND 1),
      reason TEXT NOT NULL, source_message_id TEXT REFERENCES messages(id),
      rule_version TEXT NOT NULL, recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS personality_states_current
      ON personality_states(character_id, recorded_at DESC);
    CREATE TABLE IF NOT EXISTS personality_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id TEXT NOT NULL REFERENCES characters(id),
      trait TEXT NOT NULL,
      direction INTEGER NOT NULL CHECK(direction IN (-1, 1)),
      source_message_id TEXT NOT NULL REFERENCES messages(id),
      reason TEXT NOT NULL, recorded_at TEXT NOT NULL,
      UNIQUE(character_id, trait, source_message_id)
    );
    CREATE TABLE IF NOT EXISTS reflections (
      id TEXT PRIMARY KEY NOT NULL,
      character_id TEXT NOT NULL REFERENCES characters(id),
      trigger_message_id TEXT NOT NULL REFERENCES messages(id),
      summary TEXT NOT NULL,
      importance REAL NOT NULL CHECK(importance BETWEEN 0 AND 1),
      rule_version TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reflections_character_recent
      ON reflections(character_id, created_at DESC);
  `,
}] as const;

export function migrate(database: Database.Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL
  );`);
  const applied = database.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
  const versions = new Set(applied.map((row) => row.version));
  for (const migration of migrations) {
    if (versions.has(migration.version)) continue;
    database.transaction(() => {
      database.exec(migration.sql);
      database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
        .run(migration.version, new Date().toISOString());
    })();
  }
}
