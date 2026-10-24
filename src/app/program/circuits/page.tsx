'use client';

import { Suspense } from 'react';
import CircuitsScreen from './CircuitsScreen';

/** `/program/circuits` — экран «Круговые» (уровни внутри — через `?section=`, useSearchParams под Suspense). */
export default function CircuitsPage() {
  return (
    <Suspense fallback={null}>
      <CircuitsScreen />
    </Suspense>
  );
}
