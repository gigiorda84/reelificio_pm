import 'server-only';
import { Resend } from 'resend';

let cached: Resend | null = null;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!cached) cached = new Resend(key);
  return cached;
}

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const resend = getResend();
  if (!resend) return { ok: false, error: 'resend_not_configured' };

  const from = process.env.EMAIL_FROM || 'Reelificio <noreply@alphatechnology.ai>';
  // Bounded wait, so a slow Resend cannot hold a drain past its deadline.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SendEmailResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: 'email_timeout' }), 10_000);
  });
  const send = resend.emails
    .send({ from, to: input.to, subject: input.subject, html: input.html, text: input.text })
    .then(({ data, error }): SendEmailResult =>
      error ? { ok: false, error: error.message ?? 'unknown' } : { ok: true, id: data?.id ?? '' },
    );
  try {
    return await Promise.race([send, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
