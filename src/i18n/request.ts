import { getRequestConfig } from 'next-intl/server';

const DEFAULT_LOCALE = 'it';

export default getRequestConfig(async () => {
  const locale = DEFAULT_LOCALE;
  const messages = (await import(`../messages/${locale}.json`)).default;
  return { locale, messages };
});
