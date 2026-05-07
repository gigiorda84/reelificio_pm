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

  const from = process.env.EMAIL_FROM || 'Reellificio PM <onboarding@resend.dev>';
  const { data, error } = await resend.emails.send({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
  if (error) return { ok: false, error: error.message ?? 'unknown' };
  return { ok: true, id: data?.id ?? '' };
}
