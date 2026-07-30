'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import styles from './FeedbackSheet.module.css';

const MAX_LENGTH = 4000;

type SubmitState = 'idle' | 'sending' | 'sent' | 'error';

/** Форма обратной связи: текст уходит письмом администратору (адрес — на сервере). */
export default function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Диалог монтируется заново на каждое открытие — состояние формы сбрасывается само.
  if (!open) return null;
  return <FeedbackDialog onClose={onClose} />;
}

function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const { messages } = useI18n();
  const [text, setText] = useState('');
  const [state, setState] = useState<SubmitState>('idle');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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
          body: JSON.stringify({ message }),
        });
        setState(res.ok ? 'sent' : 'error');
      } catch {
        setState('error');
      }
    },
    [text],
  );

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={messages.feedback.title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.head}>
          <div className={styles.title}>{messages.feedback.title}</div>
          <button type="button" className={styles.close} onClick={onClose} aria-label={messages.nav.closeAria}>
            ✕
          </button>
        </div>

        {state === 'sent' ? (
          <div className={styles.done}>
            <p className={styles.doneText}>{messages.feedback.sent}</p>
            <button type="button" className={styles.submit} onClick={onClose}>
              {messages.feedback.close}
            </button>
          </div>
        ) : (
          <form className={styles.form} onSubmit={submit}>
            <p className={styles.hint}>{messages.feedback.hint}</p>
            <textarea
              className={styles.textarea}
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={6}
              maxLength={MAX_LENGTH}
              placeholder={messages.feedback.placeholder}
              aria-label={messages.feedback.title}
            />
            {state === 'error' ? (
              <p role="alert" className={styles.error}>
                {messages.feedback.error}
              </p>
            ) : null}
            <button type="submit" className={styles.submit} disabled={!text.trim() || state === 'sending'}>
              {state === 'sending' ? messages.feedback.sending : messages.feedback.send}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
