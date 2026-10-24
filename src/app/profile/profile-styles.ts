import type React from 'react';

/** Общие стили профиля и его разделов (объекты `style`, как было на странице). */

export const profilePage: React.CSSProperties = {
  maxWidth: 860,
  display: 'grid',
  gap: 18,
};

export const heroCard: React.CSSProperties = {
  display: 'grid',
  gap: 14,
  padding: 'clamp(18px, 3vw, 28px)',
  borderRadius: 30,
  border: '1px solid rgba(251, 146, 60, 0.24)',
  background:
    'radial-gradient(circle at top right, rgba(251, 146, 60, 0.16), transparent 28%), linear-gradient(145deg, rgba(255, 250, 243, 0.96) 0%, rgba(255, 255, 255, 0.92) 54%, rgba(239, 246, 255, 0.9) 100%)',
  boxShadow: '0 28px 80px rgba(15, 23, 42, 0.12)',
};

export const panelCard: React.CSSProperties = {
  display: 'grid',
  gap: 16,
  padding: 'clamp(18px, 3vw, 24px)',
  borderRadius: 28,
  border: '1px solid rgba(255, 255, 255, 0.86)',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(248, 250, 252, 0.88) 100%)',
  boxShadow: '0 20px 52px rgba(15, 23, 42, 0.08)',
};

export const dangerCard: React.CSSProperties = {
  ...panelCard,
  border: '1px solid rgba(248, 113, 113, 0.26)',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(254, 242, 242, 0.88) 100%)',
};

export const avatarCircle: React.CSSProperties = {
  borderRadius: 999,
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.88) 0%, rgba(226, 232, 240, 0.92) 100%)',
  border: '1px solid rgba(255, 255, 255, 0.86)',
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 900,
  color: '#111827',
  boxShadow: '0 16px 34px rgba(15, 23, 42, 0.1)',
};

export const eyebrow: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#c2410c',
};

export const heroTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 'clamp(28px, 4vw, 40px)',
  lineHeight: 0.98,
  fontWeight: 900,
  letterSpacing: '-0.05em',
  color: '#0f172a',
};

export const heroMeta: React.CSSProperties = {
  color: '#475569',
  fontSize: 14,
  fontWeight: 700,
};

export const sectionTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 900,
  color: '#0f172a',
};

export const fieldLabel: React.CSSProperties = {
  fontWeight: 800,
  color: '#0f172a',
};

export const fieldHint: React.CSSProperties = {
  fontSize: 13,
  color: '#64748b',
  lineHeight: 1.5,
};

export const fieldInput: React.CSSProperties = {
  width: '100%',
  minHeight: 50,
  padding: '0 14px',
  borderRadius: 16,
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(255, 255, 255, 0.88)',
  color: '#0f172a',
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.7)',
};

export const buttonPrimary: React.CSSProperties = {
  minHeight: 48,
  padding: '10px 16px',
  borderRadius: 14,
  border: 'none',
  background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
  boxShadow: '0 16px 30px rgba(234, 88, 12, 0.24)',
  color: '#fff',
  fontWeight: 900,
};

export const buttonSecondary: React.CSSProperties = {
  minHeight: 48,
  padding: '10px 16px',
  borderRadius: 14,
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(255, 255, 255, 0.82)',
  color: '#0f172a',
  fontWeight: 900,
};

export const buttonDanger: React.CSSProperties = {
  minHeight: 48,
  padding: '10px 16px',
  borderRadius: 14,
  border: '1px solid rgba(239, 68, 68, 0.22)',
  background: 'rgba(255, 255, 255, 0.86)',
  color: '#b91c1c',
  fontWeight: 900,
  cursor: 'pointer',
};

export const errorBox: React.CSSProperties = {
  margin: 0,
  padding: '14px 16px',
  borderRadius: 18,
  background: 'rgba(254, 226, 226, 0.92)',
  border: '1px solid rgba(248, 113, 113, 0.34)',
  color: '#b91c1c',
  fontWeight: 700,
};

export const infoText: React.CSSProperties = {
  margin: 0,
};

export const okText: React.CSSProperties = {
  ...fieldHint,
  color: '#15803d',
  fontWeight: 800,
};

export const titleRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

export const fromHealthBadge: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 22,
  padding: '0 8px',
  borderRadius: 999,
  background: 'rgba(254, 226, 226, 0.7)',
  border: '1px solid rgba(248, 113, 113, 0.3)',
  color: '#be123c',
  fontSize: 12,
  fontWeight: 800,
};
