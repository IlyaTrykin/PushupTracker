'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import styles from './ThirdOfSeptemberEgg.module.css';

// Совпадает с длительностью анимации peek в ThirdOfSeptemberEgg.module.css.
const SLIDE_IN_MS = 600;
const HOLD_MS = 2000;
const SLIDE_OUT_MS = 500;
const TOTAL_MS = SLIDE_IN_MS + HOLD_MS + SLIDE_OUT_MS;

function isThirdOfSeptember(date: Date) {
  return date.getMonth() === 8 && date.getDate() === 3;
}

export default function ThirdOfSeptemberEgg() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const forced = new URLSearchParams(window.location.search).has('3sept');
    if (!forced && !isThirdOfSeptember(new Date())) return;

    let hideTimer = 0;
    // Ждём кадр, чтобы въезд не конкурировал с первой отрисовкой страницы.
    const frame = window.requestAnimationFrame(() => {
      setShown(true);
      hideTimer = window.setTimeout(() => setShown(false), TOTAL_MS);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(hideTimer);
    };
  }, []);

  if (!shown) return null;

  return (
    <div className={styles.root} aria-hidden="true">
      <Image
        className={styles.image}
        src="/easter-eggs/third-of-september.png"
        alt=""
        width={520}
        height={618}
        priority
      />
    </div>
  );
}
