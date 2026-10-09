import path from 'path';
import { randomBytes } from 'crypto';
import fs from 'fs/promises';

const REL_DIR = 'uploads/avatars';

export function avatarDir(): string {
  return path.join(process.cwd(), 'public', REL_DIR);
}

/** Пишет уже перекодированный WebP как `<userId>.webp` (атомарно через временный файл) и возвращает avatarPath. */
export async function saveAvatarFile(userId: string, webp: Buffer): Promise<string> {
  if (!/^[a-z0-9-]{10,}$/i.test(userId)) throw new Error('bad avatar owner id');
  const dir = avatarDir();
  await fs.mkdir(dir, { recursive: true });
  const filename = `${userId}.webp`;
  const tmp = path.join(dir, `.${filename}.${randomBytes(6).toString('hex')}.tmp`);
  await fs.writeFile(tmp, webp);
  await fs.rename(tmp, path.join(dir, filename));
  return `/${REL_DIR}/${filename}?t=${Date.now()}`;
}
