'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { getIntlLocale } from '@/i18n/translate';
import { moderationText } from '@/i18n/messages/features/moderation';

type ReportRow = {
  id: string;
  context: 'profile' | 'group' | 'reaction';
  contextId: string | null;
  groupName: string | null;
  reason: 'spam' | 'abuse' | 'inappropriate' | 'cheating' | 'other';
  text: string | null;
  status: 'new' | 'reviewed';
  createdAt: string;
  reporter: { id: string; username: string };
  target: { id: string; username: string; deleted: boolean };
};

type Filter = 'new' | 'reviewed' | 'all';

/** Admin list of reports (R33): filter by status, mark «рассмотрена» / back to new. */
export default function AdminReportsClient() {
  const { locale } = useI18n();
  const text = moderationText(locale);
  const localeTag = getIntlLocale(locale);
  const [filter, setFilter] = useState<Filter>('new');
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const query = filter === 'all' ? '' : `?status=${filter}`;
      const res = await fetch(`/api/admin/reports${query}`, { cache: 'no-store', credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { reports: ReportRow[]; counts: Record<string, number> };
      setRows(data.reports);
      setCounts(data.counts ?? {});
      setError(null);
    } catch {
      setError(text.adminError);
    }
  }, [filter, text.adminError]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (row: ReportRow, status: ReportRow['status']) => {
    setBusyId(row.id);
    try {
      const res = await fetch('/api/admin/reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: row.id, status }),
      });
      if (!res.ok) throw new Error(String(res.status));
      await load();
    } catch {
      setError(text.adminError);
    } finally {
      setBusyId(null);
    }
  };

  const filters: Array<[Filter, string]> = [
    ['new', `${text.adminFilterNew} (${counts.new ?? 0})`],
    ['reviewed', `${text.adminFilterReviewed} (${counts.reviewed ?? 0})`],
    ['all', text.adminFilterAll],
  ];

  return (
    <div className="app-page" style={{ display: 'grid', gap: 16, maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{text.adminTitle}</h1>
        <a href="/admin/users" style={linkBtn}>{text.adminUsersLink}</a>
      </div>

      <div role="group" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {filters.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            style={{ ...linkBtn, ...(filter === value ? activeBtn : {}) }}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}
      {rows && rows.length === 0 ? <div style={{ color: '#64748b' }}>{text.adminEmpty}</div> : null}

      {rows && rows.length ? (
        <div className="table-scroll">
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760, background: '#fff', borderRadius: 16 }} data-testid="admin-reports">
            <thead>
              <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                <th style={th}>{text.adminDate}</th>
                <th style={th}>{text.adminTarget}</th>
                <th style={th}>{text.adminReporter}</th>
                <th style={th}>{text.adminWhere}</th>
                <th style={th}>{text.adminReason}</th>
                <th style={th}>{text.adminText}</th>
                <th style={th}>{text.adminStatus}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{ borderTop: '1px solid #e2e8f0', verticalAlign: 'top' }}>
                  <td style={td}>{new Date(row.createdAt).toLocaleString(localeTag)}</td>
                  <td style={td}>
                    <b>{row.target.username}</b>
                    {row.target.deleted ? <span style={{ color: '#64748b' }}> ({text.adminDeleted})</span> : null}
                  </td>
                  <td style={td}>{row.reporter.username}</td>
                  <td style={td}>
                    {text.adminContexts[row.context]}
                    {row.groupName ? `: ${row.groupName}` : ''}
                  </td>
                  <td style={td}>{text.reasons[row.reason] ?? row.reason}</td>
                  <td style={{ ...td, whiteSpace: 'pre-wrap', maxWidth: 320 }}>{row.text ?? '—'}</td>
                  <td style={td}>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <span style={{ fontWeight: 800, color: row.status === 'new' ? '#b45309' : '#047857' }}>
                        {row.status === 'new' ? text.adminStatusNew : text.adminStatusReviewed}
                      </span>
                      <button
                        type="button"
                        style={linkBtn}
                        disabled={busyId === row.id}
                        onClick={() => void setStatus(row, row.status === 'new' ? 'reviewed' : 'new')}
                      >
                        {row.status === 'new' ? text.adminMarkReviewed : text.adminMarkNew}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

const th: React.CSSProperties = { padding: '10px 12px', fontSize: 13, fontWeight: 800, color: '#334155' };
const td: React.CSSProperties = { padding: '10px 12px', fontSize: 14, color: '#0f172a' };
const linkBtn: React.CSSProperties = {
  border: '1px solid #cbd5e1',
  borderRadius: 999,
  padding: '6px 12px',
  fontWeight: 800,
  fontSize: 13,
  background: '#fff',
  color: '#0f172a',
  cursor: 'pointer',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
};
const activeBtn: React.CSSProperties = { background: '#0f172a', color: '#fff', border: '1px solid #0f172a' };
