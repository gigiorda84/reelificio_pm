'use client';

import * as Sentry from '@sentry/nextjs';
import { createTranslator } from 'next-intl';
import { useEffect } from 'react';
import messages from '@/messages/it.json';

// Replaces the root layout when it throws, so there is no intl provider here.
const t = createTranslator({ locale: 'it', messages, namespace: 'globalError' });

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="it">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          maxWidth: 480,
          margin: '15vh auto',
          padding: '0 16px',
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>{t('title')}</h1>
        <p style={{ color: '#555' }}>{t('body')}</p>
        <button type="button" onClick={reset} style={{ marginTop: 16 }}>
          {t('retry')}
        </button>
      </body>
    </html>
  );
}
