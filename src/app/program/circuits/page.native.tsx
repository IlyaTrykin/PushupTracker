'use client';

import { Suspense } from 'react';
import CircuitsScreen from './CircuitsScreen';

/** Экран приложения «Круговые»: тот же экран, что на сайте (`/program/circuits`). */
export default function NativeCircuitsPage() {
  return (
    <Suspense fallback={null}>
      <CircuitsScreen />
    </Suspense>
  );
}
