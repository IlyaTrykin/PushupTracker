/**
 * Единый слой отправки писем.
 *
 * Провайдер выбирается так: MAIL_PROVIDER (resend|smtp), если задан и настроен;
 * иначе `prefer` вызывающего кода; иначе SMTP; иначе Resend. Уведомления
 * продолжают уходить по SMTP, обратная связь просит Resend явно — поэтому
 * добавление RESEND_API_KEY не переключает существующие письма молча.
 */

export type MailProvider = 'resend' | 'smtp';

export type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Адрес для ответа (Reply-To), напр. почта автора обратной связи. */
  replyTo?: string;
};

export type SendMailResult = { sent: boolean; provider?: MailProvider };

function isConfigured(provider: MailProvider): boolean {
  if (provider === 'resend') return Boolean(process.env.RESEND_API_KEY);
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function resolveProvider(prefer?: MailProvider): MailProvider | null {
  const explicitRaw = (process.env.MAIL_PROVIDER || '').trim().toLowerCase();
  const explicit: MailProvider | null = explicitRaw === 'resend' || explicitRaw === 'smtp' ? explicitRaw : null;

  const order: MailProvider[] = [];
  for (const candidate of [explicit, prefer, 'smtp' as const, 'resend' as const]) {
    if (candidate && !order.includes(candidate)) order.push(candidate);
  }

  return order.find(isConfigured) ?? null;
}

function getMailFrom(): string {
  return process.env.MAIL_FROM || process.env.SMTP_FROM || 'noreply@localhost';
}

async function sendViaResend(input: SendMailInput): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: getMailFrom(),
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
  });

  if (!res.ok) {
    const details = await res.text().catch(() => '');
    throw new Error(`Resend send failed (${res.status}): ${details.slice(0, 500)}`);
  }
}

async function sendViaSmtp(input: SendMailInput): Promise<void> {
  const smtpPort = Number(process.env.SMTP_PORT);
  const secure = process.env.SMTP_SECURE === 'true' || smtpPort === 465;

  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: smtpPort,
    secure,
    auth: { user: process.env.SMTP_USER as string, pass: process.env.SMTP_PASS as string },
  });

  await transporter.sendMail({
    from: getMailFrom(),
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    replyTo: input.replyTo,
  });
}

/**
 * Отправляет письмо. Возвращает `{ sent: false }`, если ни один провайдер не
 * настроен (локальная разработка), и бросает исключение, если отправка сорвалась.
 */
export async function sendMail(input: SendMailInput, opts?: { prefer?: MailProvider }): Promise<SendMailResult> {
  const provider = resolveProvider(opts?.prefer);

  if (!provider) {
    console.info('[mail] no provider configured', { to: input.to, subject: input.subject });
    return { sent: false };
  }

  if (provider === 'resend') await sendViaResend(input);
  else await sendViaSmtp(input);

  return { sent: true, provider };
}
