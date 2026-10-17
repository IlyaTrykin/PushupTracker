'use client';

import { Suspense } from 'react';
import LoginPage from './page';

/** Экран приложения: та же страница, что на сайте (useSearchParams — под Suspense). */
export default function NativeLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPage />
    </Suspense>
  );
}
