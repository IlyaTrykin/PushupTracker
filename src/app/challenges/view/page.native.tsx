'use client';

import { Suspense } from 'react';
import ChallengeDetailsPage from '../[id]/page';

/** `/challenges/view?id=` — соревнование в приложении (на сайте `/challenges/<id>`). */
export default function NativeChallengeViewPage() {
  return (
    <Suspense fallback={null}>
      <ChallengeDetailsPage />
    </Suspense>
  );
}
