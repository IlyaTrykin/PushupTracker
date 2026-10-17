'use client';

import { Suspense } from 'react';
import GroupsPage from './page';

/** Экран приложения: та же страница, что на сайте (useSearchParams — под Suspense). */
export default function NativeGroupsPage() {
  return (
    <Suspense fallback={null}>
      <GroupsPage />
    </Suspense>
  );
}
