// Аватар (S17): принимаем только настоящие картинки (проверка сигнатуры, а не заявленного
// MIME) и всегда перекодируем на сервере в WebP 256×256 — метаданные (EXIF, GPS, ICC)
// при этом отбрасываются, а нестандартные «полиглоты» не переживают декодирование.
import sharp from 'sharp';

export const AVATAR_SIZE = 256;
export const MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;
// Защита от «бомб»: картинка больше 40 мегапикселей не декодируется.
const MAX_INPUT_PIXELS = 40_000_000;

export type AvatarImageFormat = 'jpeg' | 'png' | 'webp' | 'gif';

export class AvatarImageError extends Error {
  constructor(message = 'Файл не является изображением JPEG, PNG, WebP или GIF') {
    super(message);
    this.name = 'AvatarImageError';
  }
}

function startsWith(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((byte, i) => buf[offset + i] === byte);
}

const ascii = (s: string) => Array.from(s, (ch) => ch.charCodeAt(0));

export function detectImageFormat(buf: Uint8Array): AvatarImageFormat | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(buf, ascii('GIF87a')) || startsWith(buf, ascii('GIF89a'))) return 'gif';
  if (startsWith(buf, ascii('RIFF')) && startsWith(buf, ascii('WEBP'), 8)) return 'webp';
  return null;
}

/** Проверяет сигнатуру и перекодирует в квадратный WebP без метаданных. Иначе — AvatarImageError. */
export async function normalizeAvatarImage(input: Buffer): Promise<Buffer> {
  const format = detectImageFormat(input);
  if (!format) throw new AvatarImageError();

  try {
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false, failOn: 'error' });
    const meta = await image.metadata();
    if (meta.format !== format) throw new AvatarImageError();

    return await image
      .rotate() // учесть ориентацию из EXIF до того, как метаданные будут отброшены
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (e) {
    if (e instanceof AvatarImageError) throw e;
    throw new AvatarImageError();
  }
}
