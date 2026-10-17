'use client';

import { Suspense } from 'react';
import ChallengesPage from './page';

/** Экран приложения: та же страница, что на сайте (useSearchParams — под Suspense). */
export default function NativeChallengesPage() {
  return (
    <Suspense fallback={null}>
      <ChallengesPage />
    </Suspense>
  );
}
