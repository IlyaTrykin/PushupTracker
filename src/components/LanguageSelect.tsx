'use client';

import { useI18n } from '@/i18n/provider';
import { SUPPORTED_LOCALES, type Locale, getLocaleFlag, getLocaleNativeLabel } from '@/i18n/locale';

export default function LanguageSelect({
  value,
  onChange,
  label,
  disabled = false,
  containerStyle,
  labelStyle,
  selectStyle,
}: {
  value: Locale;
  onChange: (locale: Locale) => void;
  label?: string;
  disabled?: boolean;
  containerStyle?: React.CSSProperties;
  labelStyle?: React.CSSProperties;
  selectStyle?: React.CSSProperties;
}) {
  const { messages } = useI18n();

  return (
    <label style={{ display: 'grid', gap: 6, ...containerStyle }}>
      {label ? <span style={{ fontWeight: 800, ...labelStyle }}>{label}</span> : null}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Locale)}
        style={{ padding: 10, borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', ...selectStyle }}
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {getLocaleFlag(locale)} {messages.common.languages[locale] || getLocaleNativeLabel(locale)}
          </option>
        ))}
      </select>
    </label>
  );
}
