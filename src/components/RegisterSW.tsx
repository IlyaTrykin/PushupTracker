'use client';

import { useEffect } from 'react';

export default function RegisterSW() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const onLoad = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');

        // Если есть waiting — просим активироваться сразу
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        // При появлении новой версии — тоже активируем сразу
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;

          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed') {
              worker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        // Периодически проверяем обновления SW
        setInterval(() => reg.update(), 60 * 60 * 1000);
      } catch {
        // игнорируем
      }
    };

    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  return null;
}
