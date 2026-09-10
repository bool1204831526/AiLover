import { real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  locale: text('locale').notNull(),
  timezone: text('timezone').notNull(),
  createdAt: text('created_at').notNull(),
});

export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(), gender: text('gender').notNull(),
  ageSetting: text('age_setting').notNull(), identity: text('identity').notNull(),
  background: text('background').notNull(), appearance: text('appearance').notNull(),
  speakingStyle: text('speaking_style').notNull(),
  personalityTemplateId: text('personality_template_id').notNull(),
  status: text('status').notNull(), createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const personalityBaselines = sqliteTable('personality_baselines', {
  characterId: text('character_id').primaryKey().references(() => characters.id),
  warmth: real('warmth').notNull(), energy: real('energy').notNull(),
  reserve: real('reserve').notNull(), playfulness: real('playfulness').notNull(),
  maturity: real('maturity').notNull(), rationality: real('rationality').notNull(),
  initiative: real('initiative').notNull(), createdAt: text('created_at').notNull(),
});

export const modelProfiles = sqliteTable('model_profiles', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  endpoint: text('endpoint').notNull(),
  model: text('model').notNull(),
  encryptedApiKey: text('encrypted_api_key'),
  updatedAt: text('updated_at').notNull(),
});

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  characterId: text('character_id').notNull().references(() => characters.id),
  title: text('title').notNull(),
  startedAt: text('started_at').notNull(),
  lastMessageAt: text('last_message_at').notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  role: text('role').notNull(),
  content: text('content').notNull(),
  status: text('status').notNull(),
  model: text('model'),
  createdAt: text('created_at').notNull(),
});
