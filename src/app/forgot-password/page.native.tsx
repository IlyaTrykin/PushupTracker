'use client';

import { Suspense } from 'react';
import ForgotPasswordPage from './page';

/** Экран приложения: та же страница, что на сайте (useSearchParams — под Suspense). */
export default function NativeForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordPage />
    </Suspense>
  );
}
