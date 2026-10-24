'use client';

import { useCallback, useState, type FormEvent } from 'react';
import { InfoButton, Sheet } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { feedbackTypeMessages } from '@/i18n/messages/features/feedback-types';
import type { FeedbackType } from '@/lib/feedback';
import styles from './FeedbackSheet.module.css';

/** Как `FEEDBACK_MAX_LENGTH` на сервере (`src/lib/feedback.ts` тянет почту — в клиент его не берём). */
const MAX_LENGTH = 4000;
/** Порядок кнопок = ключи `types` (тест сверяет их с белым списком сервера `FEEDBACK_TYPES`). */
const TYPE_OPTIONS = Object.keys(feedbackTypeMessages.ru.types) as FeedbackType[];
const DEFAULT_TYPE: FeedbackType = 'bug';

type SubmitState = 'idle' | 'sending' | 'sent' | 'error' | 'tooMany';

/**
 * Обратная связь (G05): тип «Ошибка / Идея / Жалоба» и текст уходят письмом администратору
 * (адрес — на сервере, тип — в теме). Окно на общем `Sheet`: над шапкой, Escape и аппаратная
 * «назад» Android его закрывают.
 */
export default function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { messages } = useI18n();
  return (
    <Sheet open={open} onClose={onClose} title={messages.feedback.title} testId="feedback-sheet">
      {/* Содержимое монтируется заново на каждое открытие — состояние формы сбрасывается само. */}
      <FeedbackForm onClose={onClose} />
    </Sheet>
  );
}

function FeedbackForm({ onClose }: { onClose: () => void }) {
  const { locale, messages } = useI18n();
  const typeText = feedbackTypeMessages[locale];
  const [text, setText] = useState('');
  const [type, setType] = useState<FeedbackType>(DEFAULT_TYPE);
  const [state, setState] = useState<SubmitState>('idle');

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const message = text.trim();
      if (!message) return;

      setState('sending');
      try {
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, type }),
        });
        setState(res.ok ? 'sent' : res.status === 429 ? 'tooMany' : 'error');
      } catch {
        setState('error');
      }
    },
    [text, type],
  );

  if (state === 'sent') {
    return (
      <div className={styles.done}>
        <p className={styles.doneText} role="status">
          {messages.feedback.sent}
        </p>
        <button type="button" className={styles.submit} onClick={onClose}>
          {messages.feedback.close}
        </button>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <fieldset className={styles.types}>
        <legend className={styles.typesLegend}>
          {typeText.typeLabel}
          <InfoButton title={messages.feedback.title}>
            <p>{messages.feedback.hint}</p>
            <p>{typeText.complaintInfo}</p>
          </InfoButton>
        </legend>
        <div className={styles.typeRow} role="radiogroup" aria-label={typeText.typeLabel}>
          {TYPE_OPTIONS.map((value) => (
            <label key={value} className={`${styles.typeOption} ${type === value ? styles.typeOptionActive : ''}`}>
              <input
                type="radio"
                name="feedback-type"
                value={value}
                checked={type === value}
                onChange={() => setType(value)}
                className={styles.typeInput}
                data-testid={`feedback-type-${value}`}
              />
              {typeText.types[value]}
            </label>
          ))}
        </div>
      </fieldset>
      <textarea
        className={styles.textarea}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={6}
        maxLength={MAX_LENGTH}
        placeholder={messages.feedback.placeholder}
        aria-label={messages.feedback.title}
      />
      {state === 'error' || state === 'tooMany' ? (
        <p role="alert" className={styles.error}>
          {state === 'tooMany' ? typeText.tooMany : messages.feedback.error}
        </p>
      ) : null}
      <button type="submit" className={styles.submit} disabled={!text.trim() || state === 'sending'}>
        {state === 'sending' ? messages.feedback.sending : messages.feedback.send}
      </button>
    </form>
  );
}
