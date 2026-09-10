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
