import { getTranslations } from 'next-intl/server';

type Reel = {
  hook: string | null;
  corpo: string | null;
  chiusura: string | null;
  cta: string | null;
};

export async function InviteScript({ reel }: { reel: Reel }) {
  const t = await getTranslations('invites.public');
  const sections: Array<[string, string | null]> = [
    [t('hook'), reel.hook],
    [t('corpo'), reel.corpo],
    [t('chiusura'), reel.chiusura],
    [t('cta'), reel.cta],
  ];
  return (
    <section className="rounded-lg border bg-background p-4 space-y-4">
      <h2 className="text-sm font-medium">{t('scriptTitle')}</h2>
      {sections.every(([, v]) => !v) ? (
        <p className="text-xs text-muted-foreground">{t('scriptEmpty')}</p>
      ) : (
        <dl className="space-y-3">
          {sections.map(([label, value]) =>
            value ? (
              <div key={label}>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {label}
                </dt>
                <dd className="text-sm whitespace-pre-wrap">{value}</dd>
              </div>
            ) : null,
          )}
        </dl>
      )}
    </section>
  );
}
