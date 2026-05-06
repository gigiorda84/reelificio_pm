import { JWT } from 'google-auth-library';

let cached: JWT | null = null;

function getServiceAccount() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error(
      'Drive service account not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.',
    );
  }
  // .env stores the key with literal \n; restore real newlines for PEM parsing.
  const privateKey = rawKey.replace(/\\n/g, '\n');
  return { email, privateKey };
}

export function getDriveAuth(): JWT {
  if (cached) return cached;
  const { email, privateKey } = getServiceAccount();
  cached = new JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return cached;
}

// Reset for tests / hot-reload safety.
export function _resetDriveAuthForTests() {
  cached = null;
}
