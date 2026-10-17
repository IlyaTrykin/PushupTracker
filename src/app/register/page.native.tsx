'use client';

import { Suspense } from 'react';
import RegisterPage from './page';

/** Экран приложения: та же страница, что на сайте (useSearchParams — под Suspense). */
export default function NativeRegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterPage />
    </Suspense>
  );
}
