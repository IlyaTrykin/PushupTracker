import { enMessages } from '@/i18n/messages/en';
import { ruMessages } from '@/i18n/messages/ru';
import type { Locale } from '@/i18n/locale';

type WidenLiterals<T> =
  T extends string ? string :
  T extends number ? number :
  T extends boolean ? boolean :
  T extends readonly (infer U)[] ? WidenLiterals<U>[] :
  T extends object ? { [K in keyof T]: WidenLiterals<T[K]> } :
  T;

export type Messages = WidenLiterals<typeof ruMessages>;
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const MESSAGE_OVERRIDES: Record<Locale, DeepPartial<Messages>> = {
  ru: {},
  en: enMessages,
};

function mergeMessages<T extends Record<string, any>>(base: T, override?: DeepPartial<T>): T {
  if (!override) return base;

  const out: Record<string, any> = Array.isArray(base) ? [...base] : { ...base };

  for (const key of Object.keys(override) as Array<keyof T>) {
    const baseValue = base[key];
    const overrideValue = override[key];

    if (overrideValue === undefined) continue;

    const isObject =
      baseValue &&
      overrideValue &&
      typeof baseValue === 'object' &&
      typeof overrideValue === 'object' &&
      !Array.isArray(baseValue) &&
      !Array.isArray(overrideValue);

    out[key as string] = isObject
      ? mergeMessages(baseValue as Record<string, any>, overrideValue as DeepPartial<Record<string, any>>)
      : overrideValue;
  }

  return out as T;
}

export function getMessages(locale: Locale): Messages {
  return mergeMessages(ruMessages as Messages, MESSAGE_OVERRIDES[locale]);
}
