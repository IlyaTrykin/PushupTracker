'use client';

import { useEffect } from 'react';
import { captureAttribution } from '@/lib/attribution-client';

/** Invisible: stores invite code / ref / utm from the URL so signup can credit the source. */
export default function AttributionCapture({ inviteCode }: { inviteCode?: string }) {
  useEffect(() => {
    captureAttribution(inviteCode);
  }, [inviteCode]);
  return null;
}
