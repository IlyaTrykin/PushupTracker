'use client';

import { Suspense } from 'react';
import DashboardPage from './page';

/** Экран приложения: та же страница, что на сайте (useSearchParams — под Suspense). */
export default function NativeDashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardPage />
    </Suspense>
  );
}
