import type { ErrorEvent } from '@sentry/nextjs';
import { describe, expect, it } from 'vitest';
import { REDACTED, scrubBreadcrumb, scrubEvent } from './scrub';

describe('scrubEvent', () => {
  it('redacts emails in messages and exception values', () => {
    const event: ErrorEvent = {
      type: undefined,
      message: 'invite failed for mario.rossi+test@example.com',
      exception: { values: [{ type: 'Error', value: 'no profile for a@b.it' }] },
    };
    const out = scrubEvent(event);
    expect(out.message).toBe(`invite failed for ${REDACTED}`);
    expect(out.exception?.values?.[0].value).toBe(`no profile for ${REDACTED}`);
  });

  it('keeps only the user id', () => {
    const out = scrubEvent({
      type: undefined,
      user: { id: 'u-1', email: 'x@y.com', ip_address: '1.2.3.4' },
    });
    expect(out.user).toEqual({ id: 'u-1' });
  });

  it('drops request bodies, cookies, headers and query strings', () => {
    const out = scrubEvent({
      type: undefined,
      request: {
        url: 'https://app.reelificio.com/reels/1',
        data: { hook: 'testo segreto' },
        cookies: { sb: 'token' },
        headers: { cookie: 'sb=token' },
        query_string: 'email=x@y.com',
      },
    });
    expect(out.request).toEqual({ url: 'https://app.reelificio.com/reels/1' });
  });

  it('redacts script fields nested in extras and contexts', () => {
    const out = scrubEvent({
      type: undefined,
      extra: { reel: { code: 'PP-2606-01', hook: 'Lo sapevi che…', corpo: 'testo' } },
      contexts: { reel: { raw_content: 'tutto lo script', phase: 'dubbing' } },
    });
    expect(out.extra).toEqual({ reel: { code: 'PP-2606-01', hook: REDACTED, corpo: REDACTED } });
    expect(out.contexts).toEqual({ reel: { raw_content: REDACTED, phase: 'dubbing' } });
  });

  it('drops console breadcrumbs and redacts the rest', () => {
    const out = scrubEvent({
      type: undefined,
      breadcrumbs: [
        { category: 'console', message: 'CORPO: testo' },
        { category: 'fetch', message: 'POST to a@b.it', data: { body: 'x', status: 500 } },
      ],
    });
    expect(out.breadcrumbs).toEqual([
      { category: 'fetch', message: `POST to ${REDACTED}`, data: { body: REDACTED, status: 500 } },
    ]);
  });
});

describe('scrubBreadcrumb', () => {
  it('returns null for console breadcrumbs', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'x' })).toBeNull();
  });
});
