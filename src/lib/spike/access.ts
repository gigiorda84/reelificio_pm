import 'server-only';
import type { NextRequest } from 'next/server';
import { getAdminStatus } from '@/lib/auth/admin';
import { verifySpike, type SpikePurpose } from './sign';

// /api/spike/* is a public path (see proxy) so signed links open without an
// app session; without a valid signature an admin session is required.
export async function canAccessSpike(req: NextRequest, purpose: SpikePurpose, id: string) {
  const { searchParams } = req.nextUrl;
  if (verifySpike(purpose, id, searchParams.get('exp'), searchParams.get('sig'))) return true;
  const { isAdmin } = await getAdminStatus();
  return isAdmin;
}

export const DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,100}$/;

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
