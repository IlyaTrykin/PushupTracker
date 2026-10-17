'use client';

import { Suspense } from 'react';
import NotificationsPage from './page';

/** Экран приложения: та же страница, что на сайте (useSearchParams — под Suspense). */
export default function NativeNotificationsPage() {
  return (
    <Suspense fallback={null}>
      <NotificationsPage />
    </Suspense>
  );
}
