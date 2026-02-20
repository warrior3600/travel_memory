import { promises as fs } from 'node:fs';
import path from 'node:path';

export const STORAGE_ROOT = path.resolve(process.cwd(), 'server/storage');
export const UPLOADS_ROOT = path.join(STORAGE_ROOT, 'uploads');
export const VIDEOS_ROOT = path.join(STORAGE_ROOT, 'videos');
export const TMP_ROOT = path.join(STORAGE_ROOT, 'tmp');

export async function ensureStorageDirs() {
  await Promise.all([
    fs.mkdir(UPLOADS_ROOT, { recursive: true }),
    fs.mkdir(VIDEOS_ROOT, { recursive: true }),
    fs.mkdir(TMP_ROOT, { recursive: true })
  ]);
}

export function buildPublicUploadUrl(relativePath) {
  return `/api/uploads/${relativePath.replace(/\\/g, '/')}`;
}

export function buildPublicVideoUrl(relativePath) {
  return `/api/videos/${relativePath.replace(/\\/g, '/')}`;
}
