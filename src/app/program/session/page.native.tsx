'use client';

import { Suspense } from 'react';
import ProgramSessionPage from './[id]/page';

/** `/program/session?id=` — сессия программы в приложении (на сайте `/program/session/<id>`). */
export default function NativeProgramSessionPage() {
  return (
    <Suspense fallback={null}>
      <ProgramSessionPage />
    </Suspense>
  );
}
