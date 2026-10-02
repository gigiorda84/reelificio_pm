import type { BrowserOptions } from '@sentry/nextjs';
import { scrubBreadcrumb, scrubEvent } from './scrub';

// Shared by the client, server and edge configs. Errors only: no tracing,
// no session replay, no logs. Without NEXT_PUBLIC_SENTRY_DSN the SDK is a
// no-op, so local dev and unconfigured environments send nothing.
export const sentryOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    process.env.NEXT_PUBLIC_VERCEL_ENV ??
    'development',
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    databaseQueryData: false,
    stackFrameVariables: false,
  },
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
} satisfies BrowserOptions;
