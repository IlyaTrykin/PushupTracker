'use client';

import { Suspense } from 'react';
import ProgressPage from './page';

/** Экран приложения: та же страница, что на сайте (useSearchParams — под Suspense). */
export default function NativeProgressPage() {
  return (
    <Suspense fallback={null}>
      <ProgressPage />
    </Suspense>
  );
}
