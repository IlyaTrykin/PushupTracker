import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getRequestLocale } from '@/i18n/server';
import { growthMessages } from '@/i18n/messages/features/growth';
import { getAuthUserFromSessionToken } from '@/lib/auth';
import { buildGrowthReport, ratePercent, type Rate } from '@/lib/growth-metrics';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata: Metadata = { robots: { index: false } };

function rate(r: Rate, empty: string) {
  const pct = ratePercent(r);
  return pct === null ? empty : `${pct}% (${r.hit}/${r.of})`;
}

export default async function AdminGrowthPage() {
  const store = await cookies();
  const me = await getAuthUserFromSessionToken(store.get('session')?.value);
  if (!me?.isAdmin) notFound();
  const m = growthMessages[(await getRequestLocale()) === 'en' ? 'en' : 'ru'];

  const [users, workouts] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true, createdAt: true, signupSource: true, referredById: true },
    }),
    prisma.workout.findMany({ select: { userId: true, time: true } }),
  ]);
  const r = buildGrowthReport(users, workouts, new Date(), me.timeZone);

  const totals: [string, number][] = [
    [m.users, r.totals.users],
    [m.activated, r.totals.activated],
    [m.wau, r.totals.wau],
    [m.mau, r.totals.mau],
    [m.referred, r.totals.referred],
    [m.inviters, r.totals.inviters],
  ];
  const funnel: [string, string][] = [
    [m.act24, rate(r.activation.within24h, m.noData)],
    [m.act7, rate(r.activation.within7d, m.noData)],
    [m.ret1, rate(r.retention.week1, m.noData)],
    [m.ret4, rate(r.retention.week4, m.noData)],
  ];

  return (
    <main className="app-page" style={{ display: 'grid', gap: 14 }}>
      <section style={card}>
        <h2 style={h2}>{m.totals}</h2>
        <div style={grid}>
          {totals.map(([label, value]) => (
            <div key={label} style={tile}>
              <div style={{ fontSize: 26, fontWeight: 800 }}>{value}</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={card}>
        <h2 style={h2}>{m.funnel}</h2>
        <table style={table}>
          <tbody>
            {funnel.map(([label, value]) => (
              <tr key={label}>
                <td style={td}>{label}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <h2 style={h2}>{m.weeks}</h2>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>{m.week}</th>
              <th style={{ ...th, textAlign: 'right' }}>{m.signups}</th>
              <th style={{ ...th, textAlign: 'right' }}>{m.viaInvite}</th>
            </tr>
          </thead>
          <tbody>
            {[...r.signupsByWeek].reverse().map((w) => (
              <tr key={w.week}>
                <td style={td}>{w.week}</td>
                <td style={{ ...td, textAlign: 'right' }}>{w.signups}</td>
                <td style={{ ...td, textAlign: 'right' }}>{w.referred}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <h2 style={h2}>{m.sources}</h2>
        <table style={table}>
          <tbody>
            {r.sources.map((s) => (
              <tr key={s.source}>
                <td style={td}>{s.source === 'unknown' ? m.unknown : s.source}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{s.users}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ margin: '10px 0 0', fontSize: 13, color: '#64748b', lineHeight: 1.45 }}>{m.hint}</p>
      </section>
    </main>
  );
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 14 };
const h2: React.CSSProperties = { margin: '0 0 10px', fontSize: 18 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 };
const tile: React.CSSProperties = { background: '#f8fafc', borderRadius: 12, padding: 10 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', color: '#64748b', fontWeight: 600, padding: '6px 4px', borderBottom: '1px solid #e5e7eb' };
const td: React.CSSProperties = { padding: '6px 4px', borderBottom: '1px solid #f1f5f9' };
