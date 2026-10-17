'use client';

import { Suspense } from 'react';
import FriendsPage from './page';

/** Экран приложения: та же страница, что на сайте (useSearchParams — под Suspense). */
export default function NativeFriendsPage() {
  return (
    <Suspense fallback={null}>
      <FriendsPage />
    </Suspense>
  );
}
