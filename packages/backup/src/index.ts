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
