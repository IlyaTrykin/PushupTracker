'use client';

import { useEffect, useState } from 'react';

type VersionPayload = {
  name?: string;
  buildTime?: string | null;
  gitSha?: string | null;
};

export default function VersionInfo() {
  const [v, setV] = useState<VersionPayload | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as VersionPayload;
        setV(data);
      } catch {
        // ignore
      }
    })();
  }, []);

  if (!v) return null;

  const parts: string[] = [];
  if (v.gitSha) parts.push(v.gitSha);
  if (v.buildTime) parts.push(v.buildTime);

  if (parts.length === 0) return null;

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #e5e7eb', fontSize: 12, opacity: 0.75 }}>
      <div>Version</div>
      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
        {parts.join(' • ')}
      </div>
    </div>
  );
}
