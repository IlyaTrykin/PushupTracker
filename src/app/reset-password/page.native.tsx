'use client';

import { Suspense } from 'react';
import ResetPasswordPage from './page';

/** Экран приложения: та же страница, что на сайте (useSearchParams — под Suspense). */
export default function NativeResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordPage />
    </Suspense>
  );
}
