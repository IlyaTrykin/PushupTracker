'use client';

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/i18n/provider';
import { publicLink } from '@/lib/platform';
import { shareMessages } from '@/i18n/messages/features/share';
import {
  buildShareCard,
  displayLink,
  fillShareText,
  shareCardFileName,
  shareCardUrl,
  type ShareCardInput,
} from '@/lib/share-card';
import { renderShareCard } from './share-card-render';
import styles from './ShareCardSheet.module.css';

let invitePromise: Promise<string | null> | null = null;

/** The caller's invite link, fetched once per page; `null` when it could not be loaded. */
function loadInviteUrl(): Promise<string | null> {
  if (!invitePromise) {
    invitePromise = fetch('/api/invite', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ url?: unknown }>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => (typeof d.url === 'string' ? d.url : null))
      .catch(() => {
        invitePromise = null; // try again next time
        return null;
      });
  }
  return invitePromise;
}

type Prepared = { blob: Blob; previewUrl: string; link: string };
type Status = 'idle' | 'copied' | 'error';

/** Preview of a share card with «Отправить» / «Сохранить картинку» / «Скопировать ссылку». */
export default function ShareCardSheet({ input, onClose }: { input: ShareCardInput | null; onClose: () => void }) {
  // Mounted anew for every card, so the picture and statuses start fresh.
  // Portal: a parent with transform or backdrop-filter would otherwise trap the fixed overlay.
  if (!input || typeof document === 'undefined') return null;
  return createPortal(<ShareDialog key={JSON.stringify(input)} input={input} onClose={onClose} />, document.body);
}

function ShareDialog({ input, onClose }: { input: ShareCardInput; onClose: () => void }) {
  const { locale: appLocale } = useI18n();
  const locale = appLocale === 'en' ? 'en' : 'ru';
  const text = shareMessages[locale];
  // Parents pass a fresh object literal on every render; the dialog is keyed by its content,
  // so the first one is enough — otherwise each parent render would redraw the picture.
  const [stableInput] = useState(input);
  const card = useMemo(() => buildShareCard(stableInput, locale), [stableInput, locale]);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    let previewUrl: string | null = null;
    void (async () => {
      try {
        const invite = await loadInviteUrl();
        const link = invite ? shareCardUrl(invite, card.kind) : publicLink('/').replace(/\/$/, '');
        const blob = await renderShareCard(card, displayLink(invite ?? link), text.cta);
        if (cancelled) return;
        previewUrl = URL.createObjectURL(blob);
        setPrepared({ blob, previewUrl, link });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [card, text.cta]);

  const copyLink = useCallback(async () => {
    if (!prepared) return;
    try {
      await navigator.clipboard.writeText(prepared.link);
      setStatus('copied');
    } catch {
      setStatus('error');
    }
  }, [prepared]);

  // Called straight from the click: the picture is ready, so the share sheet keeps the user gesture.
  const send = useCallback(async () => {
    if (!prepared) return;
    const file = new File([prepared.blob], shareCardFileName(card.kind), { type: 'image/png' });
    try {
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        // Many targets drop `url` when files are attached, so the link goes into the text.
        await navigator.share({ files: [file], text: `${card.text}\n${prepared.link}` });
      } else {
        await navigator.share({ title: 'Pushup Tracker', text: card.text, url: prepared.link });
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // the user closed the sheet
      await copyLink();
    }
  }, [prepared, card, copyLink]);

  const stop = (event: MouseEvent) => event.stopPropagation();
  const what = card.label;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={text.sheetTitle} onClick={stop}>
        <div className={styles.head}>
          <div className={styles.title}>{text.sheetTitle}</div>
          <button type="button" className={styles.close} onClick={onClose} aria-label={text.close}>
            ✕
          </button>
        </div>

        <div className={styles.preview}>
          {prepared ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={prepared.previewUrl} alt={fillShareText(text.previewAlt, { what })} />
          ) : (
            <span>{failed ? text.failed : text.preparing}</span>
          )}
        </div>

        <p className={styles.hint}>{text.hint}</p>

        {canShare ? (
          <button type="button" className={styles.primary} onClick={() => void send()} disabled={!prepared}>
            {text.send}
          </button>
        ) : null}
        <div className={styles.row}>
          <a
            className={styles.secondary}
            href={prepared?.previewUrl}
            download={shareCardFileName(card.kind)}
            aria-disabled={prepared ? undefined : 'true'}
          >
            {text.download}
          </a>
          <button type="button" className={styles.secondary} onClick={() => void copyLink()} aria-disabled={prepared ? undefined : 'true'}>
            {text.copyLink}
          </button>
        </div>
        <p className={status === 'error' ? `${styles.status} ${styles.statusError}` : styles.status} role="status">
          {status === 'copied' ? text.copied : status === 'error' ? text.failed : ''}
        </p>
      </div>
    </div>
  );
}

/** Small «Поделиться» button that opens the sheet for `input`. */
export function ShareButton({ input, iconOnly = false, className }: { input: ShareCardInput; iconOnly?: boolean; className?: string }) {
  const { locale: appLocale } = useI18n();
  const locale = appLocale === 'en' ? 'en' : 'ru';
  const text = shareMessages[locale];
  const [open, setOpen] = useState(false);
  const label = fillShareText(text.buttonAria, { what: buildShareCard(input, locale).label });
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        className={[styles.shareButton, iconOnly ? styles.shareIconOnly : '', className ?? ''].filter(Boolean).join(' ')}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label={label}
        title={label}
      >
        <ShareIcon />
        {iconOnly ? null : <span>{text.button}</span>}
      </button>
      <ShareCardSheet input={open ? input : null} onClose={close} />
    </>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="M7 8l5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}
