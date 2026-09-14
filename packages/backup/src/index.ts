import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { z } from 'zod';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_ASSETS = 500;

const BackupEntrySchema = z.object({
  path: z.string().min(1).max(500),
  size: z.number().int().nonnegative().max(MAX_TOTAL_BYTES),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  data: z.string().min(1),
}).strict();

export const CHARACTER_CARD_TABLES = [
  'characters', 'personality_baselines', 'character_lore', 'conversations', 'messages', 'memories',
  'memory_sources', 'memory_links', 'memory_recalls', 'emotion_states', 'relationship_states',
  'personality_states', 'personality_evidence', 'reflections', 'character_visual_identities', 'assets',
  'episodic_memories', 'episode_sources', 'episode_recalls', 'future_intentions', 'consolidated_memories',
  'consolidated_memory_sources', 'self_model_entries', 'memory_deletions', 'memory_resolutions',
] as const;
const CardScalarSchema = z.union([z.string(), z.number(), z.null()]);
const CardRowSchema = z.record(z.string().min(1).max(100), CardScalarSchema);
const CharacterCardBaseSchema = z.object({ format: z.literal('ailover-character'),
  appVersion: z.string().min(1).max(50), createdAt: z.iso.datetime(), characterName: z.string().min(1).max(40), environment: z.string().max(3000).nullable(),
  data: z.record(z.string(), z.array(CardRowSchema).max(100_000)).superRefine((data, context) => {
    const allowed = new Set<string>(CHARACTER_CARD_TABLES);
    if (Object.keys(data).some((table) => !allowed.has(table))) context.addIssue({ code: 'custom', message: '角色卡包含未知数据表。' });
  }),
  assets: z.array(BackupEntrySchema).max(MAX_ASSETS),
});
const CharacterCardSchema = z.discriminatedUnion('version', [
  CharacterCardBaseSchema.extend({ version: z.literal(1) }).strict(),
  CharacterCardBaseSchema.extend({ version: z.literal(2), familiarUserId: z.uuid() }).strict(),
]);
export type CharacterCardData = Record<string, Record<string, string | number | null>[]>;
const STRANGER_CARD_TABLES = new Set([
  'characters', 'personality_baselines', 'character_lore', 'character_visual_identities', 'assets',
]);

export function prepareCharacterCardImportData(
  data: CharacterCardData, recognizedUser: boolean,
): CharacterCardData {
  if (recognizedUser) return data;
  return Object.fromEntries(
    Object.entries(data).filter(([table]) => STRANGER_CARD_TABLES.has(table)),
  );
}
export type ParsedCharacterCard = { appVersion: string; createdAt: Date; characterName: string;
  data: CharacterCardData; assets: BackupBinaryEntry[]; environment: string | null;
  familiarUserId: string | null };
const BackupDocumentSchema = z.object({
  format: z.literal('ailover-backup'),
  version: z.literal(1),
  appVersion: z.string().min(1).max(50),
  createdAt: z.iso.datetime(),
  credentialsIncluded: z.literal(false),
  database: BackupEntrySchema,
  assets: z.array(BackupEntrySchema).max(MAX_ASSETS),
}).strict();

export type BackupBinaryEntry = { path: string; data: Buffer };
export type ParsedBackup = {
  appVersion: string; createdAt: Date; database: Buffer; assets: BackupBinaryEntry[];
};

function checksum(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function assertSafeRelativePath(path: string): void {
  if (path.includes('\\') || path.startsWith('/') || path.includes(':')) {
    throw new Error('备份包含无效路径。');
  }
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('备份包含无效路径。');
  }
}

function encodeEntry(entry: BackupBinaryEntry, maximumBytes: number) {
  assertSafeRelativePath(entry.path);
  if (entry.data.byteLength > maximumBytes) throw new Error('备份中的单个文件过大。');
  return { path: entry.path, size: entry.data.byteLength, checksum: checksum(entry.data),
    data: entry.data.toString('base64') };
}

export function createBackupDocument(input: {
  appVersion: string; createdAt: Date; database: Buffer; assets: BackupBinaryEntry[];
}): string {
  const total = input.database.byteLength
    + input.assets.reduce((sum, asset) => sum + asset.data.byteLength, 0);
  if (total > MAX_TOTAL_BYTES) throw new Error('备份数据超过 512 MB 限制。');
  return JSON.stringify(BackupDocumentSchema.parse({
    format: 'ailover-backup', version: 1, appVersion: input.appVersion,
    createdAt: input.createdAt.toISOString(), credentialsIncluded: false,
    database: encodeEntry({ path: 'data/ailover.sqlite', data: input.database }, MAX_TOTAL_BYTES),
    assets: input.assets.map((asset) => encodeEntry(asset, MAX_FILE_BYTES)),
  }));
}

export function parseBackupDocument(source: string): ParsedBackup {
  const document = BackupDocumentSchema.parse(JSON.parse(source) as unknown);
  const decode = (entry: z.infer<typeof BackupEntrySchema>): BackupBinaryEntry => {
    assertSafeRelativePath(entry.path);
    const data = Buffer.from(entry.data, 'base64');
    if (data.toString('base64') !== entry.data || data.byteLength !== entry.size
      || checksum(data) !== entry.checksum) throw new Error('备份文件完整性校验失败。');
    return { path: entry.path, data };
  };
  const database = decode(document.database);
  const assets = document.assets.map(decode);
  if (assets.some(({ data }) => data.byteLength > MAX_FILE_BYTES)) {
    throw new Error('备份中的单个文件过大。');
  }
  const uniquePaths = new Set(assets.map(({ path }) => path));
  if (uniquePaths.size !== assets.length) throw new Error('备份包含重复资产路径。');
  const total = database.data.byteLength + assets.reduce((sum, asset) => sum + asset.data.byteLength, 0);
  if (total > MAX_TOTAL_BYTES) throw new Error('备份数据超过 512 MB 限制。');
  return { appVersion: document.appVersion, createdAt: new Date(document.createdAt),
    database: database.data, assets };
}

export function createCharacterCardDocument(input: { appVersion: string; createdAt: Date;
  characterName: string; familiarUserId: string; data: CharacterCardData;
  assets: BackupBinaryEntry[]; environment?: string }): string {
  const total = input.assets.reduce((sum, asset) => sum + asset.data.byteLength, 0);
  if (total > MAX_TOTAL_BYTES) throw new Error('角色卡资产超过 512 MB 限制。');
  return JSON.stringify(CharacterCardSchema.parse({ format: 'ailover-character', version: 2,
    appVersion: input.appVersion, createdAt: input.createdAt.toISOString(), characterName: input.characterName,
    familiarUserId: input.familiarUserId, environment: input.environment ?? null, data: input.data,
    assets: input.assets.map((asset) => encodeEntry(asset, MAX_FILE_BYTES)) }));
}

export function parseCharacterCardDocument(source: string): ParsedCharacterCard {
  if (Buffer.byteLength(source, 'utf8') > 700 * 1024 * 1024) throw new Error('角色卡文件过大。');
  const document = CharacterCardSchema.parse(JSON.parse(source) as unknown);
  const assets = document.assets.map((entry) => {
    assertSafeRelativePath(entry.path); const data = Buffer.from(entry.data, 'base64');
    if (data.toString('base64') !== entry.data || data.byteLength !== entry.size || checksum(data) !== entry.checksum)
      throw new Error('角色卡资产完整性校验失败。');
    return { path: entry.path, data };
  });
  return { appVersion: document.appVersion, createdAt: new Date(document.createdAt),
    characterName: document.characterName, environment: document.environment, data: document.data, assets,
    familiarUserId: document.version === 2 ? document.familiarUserId : null };
}
export async function readAssetEntries(root: string): Promise<BackupBinaryEntry[]> {
  const entries: BackupBinaryEntry[] = [];
  async function visit(directory: string): Promise<void> {
    let children;
    try { children = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const child of children) {
      const absolute = join(directory, child.name);
      if (child.isSymbolicLink()) throw new Error('资产目录不能包含符号链接。');
      if (child.isDirectory()) await visit(absolute);
      else if (child.isFile()) {
        const path = relative(root, absolute).split(sep).join('/');
        entries.push({ path: `assets/${path}`, data: await readFile(absolute) });
      }
    }
  }
  await visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}
