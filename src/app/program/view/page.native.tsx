'use client';

import { Suspense } from 'react';
import ProgramDetailPage from '../[id]/page';

/** `/program/view?id=` — программа в приложении (на сайте `/program/<id>`). */
export default function NativeProgramViewPage() {
  return (
    <Suspense fallback={null}>
      <ProgramDetailPage />
    </Suspense>
  );
}
