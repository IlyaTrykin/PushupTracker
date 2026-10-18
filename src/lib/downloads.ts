import path from 'path';

/**
 * Файлы для скачивания по прямой ссылке `/downloads/<имя>` (APK для тестеров).
 * Лежат в отдельном томе (`/app/downloads` в контейнере), а не в `public/uploads`:
 * тот уходит в ежечасный бэкап, а сборку приложения всегда можно пересобрать.
 */

export type DownloadFile = { fileName: string; contentType: string };

const CONTENT_TYPES: Record<string, string> = {
  apk: 'application/vnd.android.package-archive',
};

// Начало — буква или цифра: временные и скрытые файлы (`.x.tmp`) не отдаются.
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,80}\.([a-z0-9]+)$/i;

/** Имя из URL → файл, который можно отдать; всё остальное (в т.ч. `..`, `/`, чужие расширения) → null. */
export function resolveDownload(name: string): DownloadFile | null {
  const match = NAME_RE.exec(name);
  if (!match || name.includes('..')) return null;
  const contentType = CONTENT_TYPES[match[1].toLowerCase()];
  return contentType ? { fileName: name, contentType } : null;
}

/** Папка загрузок: `DOWNLOADS_DIR` или `<cwd>/downloads`. */
export function downloadsDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.DOWNLOADS_DIR?.trim() || path.join(process.cwd(), 'downloads');
}
