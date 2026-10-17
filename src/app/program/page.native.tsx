'use client';

import { Suspense } from 'react';
import ProgramPage from './page';

/** Экран приложения: та же страница, что на сайте (useSearchParams — под Suspense). */
export default function NativeProgramPage() {
  return (
    <Suspense fallback={null}>
      <ProgramPage />
    </Suspense>
  );
}
