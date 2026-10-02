import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';

// Sentry receives errors only, never personal data or script text.
// `dataCollection` in sentry-options.ts already turns off bodies, cookies,
// user info and stack-frame variables; this pass covers what remains:
// error messages, extras, contexts and breadcrumbs.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Keys whose values may hold script text (reel blocks, notes, comments).
const SCRIPT_KEY_RE =
  /^(hook|corpo|chiusura|cta|raw_?content|notes?|body|script|text|content|caption|email)$/i;

export const REDACTED = '[redacted]';

function redactString(value: string): string {
  return value.replace(EMAIL_RE, REDACTED);
}

function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactString(value);
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SCRIPT_KEY_RE.test(key) ? REDACTED : redactValue(v, depth + 1);
  }
  return out;
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  // Console breadcrumbs can carry anything the app logged.
  if (crumb.category === 'console') return null;
  return {
    ...crumb,
    message: crumb.message ? redactString(crumb.message) : crumb.message,
    data: crumb.data ? (redactValue(crumb.data) as Breadcrumb['data']) : crumb.data,
  };
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed: ErrorEvent = { ...event };

  if (scrubbed.user) {
    scrubbed.user = scrubbed.user.id ? { id: scrubbed.user.id } : undefined;
  }

  if (scrubbed.request) {
    // Keep method and URL only: no body, cookies, headers or query string.
    const { method, url } = scrubbed.request;
    scrubbed.request = {
      ...(method ? { method } : {}),
      ...(url ? { url: redactString(url) } : {}),
    };
  }

  if (scrubbed.message) scrubbed.message = redactString(scrubbed.message);

  if (scrubbed.exception?.values) {
    scrubbed.exception = {
      ...scrubbed.exception,
      values: scrubbed.exception.values.map((ex) => ({
        ...ex,
        value: ex.value ? redactString(ex.value) : ex.value,
      })),
    };
  }

  if (scrubbed.extra) scrubbed.extra = redactValue(scrubbed.extra) as ErrorEvent['extra'];
  if (scrubbed.contexts) {
    scrubbed.contexts = redactValue(scrubbed.contexts) as ErrorEvent['contexts'];
  }
  if (scrubbed.tags) scrubbed.tags = redactValue(scrubbed.tags) as ErrorEvent['tags'];

  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs
      .map(scrubBreadcrumb)
      .filter((b): b is Breadcrumb => b !== null);
  }

  return scrubbed;
}
