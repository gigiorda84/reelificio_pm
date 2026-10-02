'use client';

import { Button } from '@/components/ui/button';

export function SentryClientTest() {
  return (
    <Button
      variant="outline"
      onClick={() => {
        throw new Error('Sentry S0 test (client) for test.user@example.com');
      }}
    >
      Errore di prova (client)
    </Button>
  );
}
