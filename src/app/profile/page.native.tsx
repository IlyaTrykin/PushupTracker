'use client';

import { Suspense } from 'react';
import ProfilePage from './page';

/** Экран приложения: та же страница, что на сайте (useSearchParams — под Suspense). */
export default function NativeProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfilePage />
    </Suspense>
  );
}
