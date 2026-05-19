// Pre-provision users via the Supabase Admin API.
//
// Usage:
//   pnpm exec tsx scripts/invite-users.ts
//
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local
// (or in the shell environment). The service-role key is required to call
// admin.* methods. Edit USERS below to change the seed list.
//
// What it does for each user:
//   1. createUser({ email, email_confirm: true }) — idempotent: if the
//      user already exists (422), we look them up and continue.
//   2. Optionally promote to admin (is_admin = true) on the profiles row
//      created by the on_auth_user_created trigger.
//   3. Send a magic link so the user can sign in immediately.

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Node 20 doesn't ship native WebSocket; @supabase/realtime-js needs one.
(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
  WebSocket as unknown as typeof globalThis.WebSocket;

config({ path: '.env.local' });

type Seed = {
  email: string;
  full_name: string;
  is_admin?: boolean;
};

const USERS: Seed[] = [
  { email: 'rootsmanteo@gmail.com', full_name: 'Matteo Marini', is_admin: true },
  { email: 'concasgabriele@gmail.com', full_name: 'Gabriele Concas', is_admin: true },
];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://reelificio-pm.vercel.app';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local',
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email: string) {
  // listUsers paginates; for a handful of users page 1 is enough but we
  // walk pages defensively in case the project grows.
  let page = 1;
  while (page < 50) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const hit = data.users.find(
      (u) => (u.email ?? '').toLowerCase() === email.toLowerCase(),
    );
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page += 1;
  }
  return null;
}

async function ensureUser(seed: Seed) {
  console.log(`\n→ ${seed.email} (${seed.full_name})`);

  // 1. Create or find
  const { data: created, error: createErr } =
    await admin.auth.admin.createUser({
      email: seed.email,
      email_confirm: true,
      user_metadata: { full_name: seed.full_name },
    });

  let userId: string;
  if (createErr) {
    if (createErr.message.toLowerCase().includes('already')) {
      console.log('  · already exists, looking up id…');
      const existing = await findUserByEmail(seed.email);
      if (!existing) throw new Error(`User exists but lookup failed`);
      userId = existing.id;
    } else {
      throw createErr;
    }
  } else {
    userId = created.user!.id;
    console.log('  · created auth user:', userId);
  }

  // 2. Upsert profile (the on_auth_user_created trigger should have made
  // the row, but we update the name/admin flag explicitly to be safe).
  const { error: profileErr } = await admin
    .from('profiles')
    .update({
      full_name: seed.full_name,
      is_admin: seed.is_admin ?? false,
    })
    .eq('id', userId);
  if (profileErr) {
    console.warn('  · profile update warning:', profileErr.message);
  } else {
    console.log('  · profile updated');
  }

  // 3. Magic link so they can log in immediately
  const { data: link, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: seed.email,
      options: { redirectTo: `${APP_URL}/auth/callback` },
    });
  if (linkErr) {
    console.warn('  · magiclink warning:', linkErr.message);
  } else if (link?.properties?.action_link) {
    console.log('  · magic link (deliver privately):');
    console.log('   ', link.properties.action_link);
  }
}

async function main() {
  for (const u of USERS) {
    try {
      await ensureUser(u);
    } catch (err) {
      console.error(`  ✗ ${u.email}:`, err);
    }
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
