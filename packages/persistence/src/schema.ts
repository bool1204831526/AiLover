import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  locale: text('locale').notNull(),
  timezone: text('timezone').notNull(),
  createdAt: text('created_at').notNull(),
  passwordHash: text('password_hash'),
});

export const companionSettings = sqliteTable('companion_settings', {
  id: text('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  intervalMinutes: integer('interval_minutes').notNull(),
  quietStart: text('quiet_start').notNull(),
  quietEnd: text('quiet_end').notNull(),
  desktopPetEnabled: integer('desktop_pet_enabled', { mode: 'boolean' }).notNull(),
  desktopPetRoamingEnabled: integer('desktop_pet_roaming_enabled', { mode: 'boolean' }).notNull(),
  lastPromptAt: text('last_prompt_at'),
  updatedAt: text('updated_at').notNull(),
});

export const desktopPetWindowState = sqliteTable('desktop_pet_window_state', {
  id: text('id').primaryKey(),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  updatedAt: text('updated_at').notNull(),
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

export const characterLore = sqliteTable('character_lore', {
  characterId: text('character_id').primaryKey().references(() => characters.id),
  originWorld: text('origin_world').notNull(), lifeStory: text('life_story').notNull(),
  worldview: text('worldview').notNull(), coreMotivations: text('core_motivations').notNull(),
  knowledgeBoundaries: text('knowledge_boundaries').notNull(), arrivalStory: text('arrival_story').notNull(),
  source: text('source').notNull(), updatedAt: text('updated_at').notNull(),
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

export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  characterId: text('character_id').notNull().references(() => characters.id),
  type: text('type').notNull(),
  subject: text('subject').notNull(),
  content: text('content').notNull(),
  normalizedKey: text('normalized_key').notNull(),
  confidence: real('confidence').notNull(),
  importance: real('importance').notNull(),
  emotionalWeight: real('emotional_weight').notNull(),
  polarity: text('polarity').notNull(),
  recallStrength: real('recall_strength').notNull(),
  reinforcementCount: integer('reinforcement_count').notNull(),
  state: text('state').notNull(),
  firstSeenAt: text('first_seen_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  lastRecalledAt: text('last_recalled_at'),
  expiresAt: text('expires_at'),
});

export const episodicMemories = sqliteTable('episodic_memories', {
  id: text('id').primaryKey(),
  characterId: text('character_id').notNull().references(() => characters.id),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  kind: text('kind').notNull(), fingerprint: text('fingerprint').notNull(),
  title: text('title').notNull(), summary: text('summary').notNull(), context: text('context'),
  participants: text('participants').notNull(), userAction: text('user_action').notNull(),
  aiAction: text('ai_action'), userEmotion: text('user_emotion'), aiEmotion: text('ai_emotion'),
  relationshipRelevance: real('relationship_relevance').notNull(),
  emotionalWeight: real('emotional_weight').notNull(), importance: real('importance').notNull(),
  confidence: real('confidence').notNull(), reinforcementCount: integer('reinforcement_count').notNull(),
  status: text('status').notNull(), relatedMemoryIds: text('related_memory_ids').notNull(),
  tags: text('tags').notNull(), eventTime: text('event_time').notNull(),
  createdAt: text('created_at').notNull(), lastRecalledAt: text('last_recalled_at'),
});

export const emotionStates = sqliteTable('emotion_states', {
  id: text('id').primaryKey(),
  characterId: text('character_id').notNull().references(() => characters.id),
  valence: real('valence').notNull(), arousal: real('arousal').notNull(),
  security: real('security').notNull(), affection: real('affection').notNull(),
  reason: text('reason').notNull(), sourceMessageId: text('source_message_id'),
  ruleVersion: text('rule_version').notNull(), recordedAt: text('recorded_at').notNull(),
});

export const relationshipStates = sqliteTable('relationship_states', {
  id: text('id').primaryKey(),
  characterId: text('character_id').notNull().references(() => characters.id),
  trust: real('trust').notNull(), intimacy: real('intimacy').notNull(),
  affection: real('affection').notNull(), familiarity: real('familiarity').notNull(),
  comfort: real('comfort').notNull(), conflict: real('conflict').notNull(),
  reason: text('reason').notNull(), sourceMessageId: text('source_message_id'),
  ruleVersion: text('rule_version').notNull(), recordedAt: text('recorded_at').notNull(),
});

export const personalityStates = sqliteTable('personality_states', {
  id: text('id').primaryKey(),
  characterId: text('character_id').notNull().references(() => characters.id),
  warmth: real('warmth').notNull(), energy: real('energy').notNull(),
  reserve: real('reserve').notNull(), playfulness: real('playfulness').notNull(),
  maturity: real('maturity').notNull(), rationality: real('rationality').notNull(),
  initiative: real('initiative').notNull(), reason: text('reason').notNull(),
  sourceMessageId: text('source_message_id'), ruleVersion: text('rule_version').notNull(),
  recordedAt: text('recorded_at').notNull(),
});

export const reflections = sqliteTable('reflections', {
  id: text('id').primaryKey(),
  characterId: text('character_id').notNull().references(() => characters.id),
  triggerMessageId: text('trigger_message_id').notNull().references(() => messages.id),
  summary: text('summary').notNull(), importance: real('importance').notNull(),
  ruleVersion: text('rule_version').notNull(), createdAt: text('created_at').notNull(),
});

export const characterVisualIdentities = sqliteTable('character_visual_identities', {
  characterId: text('character_id').primaryKey().references(() => characters.id),
  identityDescription: text('identity_description').notNull(),
  generationPrompt: text('generation_prompt').notNull(),
  negativePrompt: text('negative_prompt').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  characterId: text('character_id').notNull().references(() => characters.id),
  type: text('type').notNull(), source: text('source').notNull(),
  version: integer('version').notNull(), localPath: text('local_path').notNull(),
  mimeType: text('mime_type').notNull(), checksum: text('checksum').notNull(),
  fileName: text('file_name').notNull(), metadata: text('metadata').notNull(),
  createdAt: text('created_at').notNull(),
});

export const futureIntentions = sqliteTable('future_intentions', {
  id: text('id').primaryKey(), characterId: text('character_id').notNull().references(() => characters.id),
  description: text('description').notNull(), triggerType: text('trigger_type').notNull(),
  triggerData: text('trigger_data').notNull(), priority: real('priority').notNull(),
  sourceMemoryIds: text('source_memory_ids').notNull(), status: text('status').notNull(),
  createdAt: text('created_at').notNull(), expiresAt: text('expires_at'),
});

export const consolidatedMemories = sqliteTable('consolidated_memories', {
  id: text('id').primaryKey(), characterId: text('character_id').notNull().references(() => characters.id),
  type: text('type').notNull(), statement: text('statement').notNull(), confidence: real('confidence').notNull(),
  importance: real('importance').notNull(), reinforcementCount: integer('reinforcement_count').notNull(),
  status: text('status').notNull(), createdAt: text('created_at').notNull(),
});

export const selfModelEntries = sqliteTable('self_model_entries', {
  id: text('id').primaryKey(), characterId: text('character_id').notNull().references(() => characters.id),
  category: text('category').notNull(), statement: text('statement').notNull(), confidence: real('confidence').notNull(),
  version: integer('version').notNull(), sourceMessageId: text('source_message_id').references(() => messages.id),
  reason: text('reason').notNull(), status: text('status').notNull(), createdAt: text('created_at').notNull(),
});

export const memoryDeletions = sqliteTable('memory_deletions', {
  memoryId: text('memory_id').primaryKey().references(() => memories.id),
  characterId: text('character_id').notNull().references(() => characters.id),
  deletedAt: text('deleted_at').notNull(),
});

export const memoryResolutions = sqliteTable('memory_resolutions', {
  id: text('id').primaryKey(),
  characterId: text('character_id').notNull().references(() => characters.id),
  memoryId: text('memory_id').notNull().references(() => memories.id),
  relatedMemoryId: text('related_memory_id').notNull().references(() => memories.id),
  action: text('action').notNull(), chosenMemoryId: text('chosen_memory_id').references(() => memories.id),
  mergedContent: text('merged_content'), previousState: text('previous_state').notNull(),
  createdAt: text('created_at').notNull(),
  passwordHash: text('password_hash'),
});
