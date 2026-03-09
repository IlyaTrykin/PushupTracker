'use client';

import { useEffect } from 'react';

export default function RegisterSW() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let intervalId: number | undefined;
    let reloaded = false;

    const reload = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };

    const onLoad = async () => {
      try {
        navigator.serviceWorker.addEventListener('controllerchange', reload);

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
        intervalId = window.setInterval(() => reg.update(), 60 * 60 * 1000);
      } catch {
        // игнорируем
      }
    };

    window.addEventListener('load', onLoad);
    return () => {
      window.removeEventListener('load', onLoad);
      navigator.serviceWorker.removeEventListener('controllerchange', reload);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);

  return null;
}
