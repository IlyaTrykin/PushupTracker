/**
 * Данные оператора для юридических страниц (`/privacy`, `/terms`, `/support`, `/account-deletion`).
 * Репозиторий публичный, поэтому имя и email берутся только из env сервера
 * (`LEGAL_OPERATOR_NAME`, `LEGAL_CONTACT_EMAIL`) и читаются во время запроса.
 */
export type LegalOperator = {
  name: string | null;
  email: string | null;
  /** Заданы и имя, и email. */
  configured: boolean;
};

type LegalEnv = Record<string, string | undefined>;

function clean(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : null;
}

export function readLegalOperator(env: LegalEnv = process.env): LegalOperator {
  const name = clean(env.LEGAL_OPERATOR_NAME);
  const rawEmail = clean(env.LEGAL_CONTACT_EMAIL);
  const email = rawEmail && /^[^\s@]+@[^\s@]+$/.test(rawEmail) ? rawEmail : null;
  return { name, email, configured: Boolean(name && email) };
}

/** Подставляет `{operator}` и `{email}`; для незаданных значений — видимая заглушка. */
export function fillLegal(
  text: string,
  operator: LegalOperator,
  placeholders: { operator: string; email: string },
): string {
  return text
    .replaceAll('{operator}', operator.name ?? placeholders.operator)
    .replaceAll('{email}', operator.email ?? placeholders.email);
}
