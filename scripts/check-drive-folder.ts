// What is really in a reel's Drive folder, against what the database says
// (docs/fase1-plan.md §S5, scenario E8, AC8; R2 step "check-drive-folder").
//
//   pnpm exec tsx scripts/check-drive-folder.ts <reel code> [--target staging|production]
//
// Prints the root, archivio/ and the permissions, then checks:
// - the folder name and the file names follow the standard;
// - every ready file is where the database says (root or archivio/), and the
//   root holds nothing the app does not know;
// - from animazione on: kit_ready_at is set and the root has the script kit
//   with the approved audio (or the link file of a legacy kit);
// - the direct permissions are exactly the shares the tasks want (Shared
//   Drive members, inherited, are listed apart).
// Exit code 1 when a check fails. Read-only on Drive and in the database.
import { JWT } from 'google-auth-library';
import { reelFolderName } from '../src/lib/drive/naming';
import { loadTarget } from './lib/target';

const API = 'https://www.googleapis.com/drive/v3';

type DriveItem = { id: string; name: string; mimeType: string; size?: string; appProperties?: Record<string, string> };
type Permission = {
  id: string;
  type: string;
  role: string;
  emailAddress?: string;
  permissionDetails?: { inherited?: boolean }[];
};

let jwt: JWT | null = null;
async function drive<T>(path: string, query: Record<string, string>): Promise<T> {
  if (!jwt) {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!email || !key) throw new Error('Drive service account env missing');
    jwt = new JWT({ email, key, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  }
  const { token } = await jwt.getAccessToken();
  const url = new URL(`${API}${path}`);
  url.searchParams.set('supportsAllDrives', 'true');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

async function children(folderId: string): Promise<DriveItem[]> {
  const res = await drive<{ files: DriveItem[] }>('/files', {
    q: `'${folderId}' in parents and trashed = false`,
    corpora: 'allDrives',
    includeItemsFromAllDrives: 'true',
    fields: 'files(id,name,mimeType,size,appProperties)',
    pageSize: '200',
  });
  return res.files;
}

let failures = 0;
function check(ok: boolean, label: string) {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}`);
  if (!ok) failures += 1;
}

async function main() {
  const { admin, args, target } = await loadTarget(process.argv.slice(2), { allowProduction: true });
  const code = args[0];
  if (!code) throw new Error('usage: check-drive-folder.ts <reel code> [--target staging|production]');

  const { data: reel, error } = await admin
    .from('reels')
    .select('id, code, title, state, published_at, drive_folder_id, drive_archive_folder_id, kit_ready_at')
    .eq('code', code)
    .maybeSingle();
  if (error || !reel) throw new Error(`reel ${code} not found on ${target}`);
  if (!reel.drive_folder_id) throw new Error(`${code} has no Drive folder yet (state ${reel.state})`);

  const [{ data: files }, { data: shares }, { data: state }] = await Promise.all([
    admin.from('reel_files').select('id, kind, version, status, name, drive_file_id, approved_at, archived_at, kit_hash').eq('reel_id', reel.id),
    admin.from('reel_folder_shares').select('email, role, drive_permission_id, last_error').eq('reel_id', reel.id).is('revoked_at', null),
    admin.rpc('drive_desired_state', { p_reel_id: reel.id }),
  ]);
  const desired = ((state as { shares?: { email: string; role: string }[] } | null)?.shares ?? []).map((s) => `${s.email} ${s.role}`);

  const folder = await drive<DriveItem>(`/files/${reel.drive_folder_id}`, { fields: 'id,name,mimeType' });
  const root = await children(reel.drive_folder_id);
  const archiveFolder = root.find((f) => f.mimeType === 'application/vnd.google-apps.folder' && f.name === 'archivio');
  const archived = archiveFolder ? await children(archiveFolder.id) : [];
  const perms = (
    await drive<{ permissions: Permission[] }>(`/files/${reel.drive_folder_id}/permissions`, {
      fields: 'permissions(id,type,role,emailAddress,permissionDetails(inherited))',
    })
  ).permissions;
  const direct = perms.filter((p) => !p.permissionDetails?.length || p.permissionDetails.some((d) => d.inherited === false));
  const inherited = perms.filter((p) => !direct.includes(p));

  console.log(`${target} · ${reel.code} · ${reel.state} · kit ${reel.kit_ready_at ? `ready ${reel.kit_ready_at}` : 'not ready'}`);
  console.log(`folder: ${folder.name}  https://drive.google.com/drive/folders/${folder.id}`);
  console.log('root:');
  for (const f of root) console.log(`  ${f.mimeType.endsWith('folder') ? '[dir] ' : ''}${f.name}${f.size ? `  ${f.size} B` : ''}`);
  console.log('archivio/:');
  for (const f of archived) console.log(`  ${f.name}`);
  console.log('permissions (direct):');
  for (const p of direct) console.log(`  ${p.type} ${p.emailAddress ?? '(link)'} ${p.role}`);
  console.log(`permissions (inherited from the Shared Drive): ${inherited.length}`);
  console.log('checks:');

  check(folder.name === reelFolderName(reel.code, reel.title), `folder name "${folder.name}"`);
  const pattern = new RegExp(`^${reel.code}_(audio_v\\d+\\.[a-z0-9]+|video_v\\d+\\.[a-z0-9]+|script_v\\d+\\.txt|audio_link\\.txt)$`);
  for (const f of [...root, ...archived].filter((x) => !x.mimeType.endsWith('folder'))) {
    check(pattern.test(f.name), `file name ${f.name}`);
  }

  const ready = (files ?? []).filter((f) => f.status === 'ready');
  const rootIds = new Set(root.map((f) => f.id));
  const archivedIds = new Set(archived.map((f) => f.id));
  for (const f of ready) {
    const where = f.archived_at ? archivedIds : rootIds;
    check(where.has(f.drive_file_id), `${f.name} in ${f.archived_at ? 'archivio/' : 'the root'}`);
  }
  const known = new Set(ready.map((f) => f.drive_file_id));
  const strangers = root.filter((f) => !f.mimeType.endsWith('folder') && !known.has(f.id));
  check(strangers.length === 0, `no unknown files in the root${strangers.length ? `: ${strangers.map((f) => f.name).join(', ')}` : ''}`);

  if (!reel.published_at && ['animazione', 'approvazione_finale', 'programmato'].includes(reel.state)) {
    check(!!reel.kit_ready_at, 'kit_ready_at set');
    const rootReady = ready.filter((f) => !f.archived_at);
    check(rootReady.some((f) => f.kind === 'script'), 'script kit in the root');
    check(
      rootReady.some((f) => f.kind === 'audio' && f.approved_at) || rootReady.some((f) => f.kind === 'other'),
      'approved audio (or the link of a legacy kit) in the root',
    );
  }

  const onDrive = direct.filter((p) => p.type === 'user').map((p) => `${(p.emailAddress ?? '').toLowerCase()} ${p.role}`);
  const sa = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '').toLowerCase();
  const extra = onDrive.filter((p) => !desired.includes(p) && !p.startsWith(`${sa} `));
  const missing = desired.filter((d) => !onDrive.includes(d));
  check(extra.length === 0, `no permission beyond the tasks${extra.length ? `: ${extra.join(', ')}` : ''}`);
  check(missing.length === 0, `every wanted share granted${missing.length ? `: missing ${missing.join(', ')}` : ''}`);
  check(!direct.some((p) => p.type === 'anyone'), 'no link sharing');
  for (const s of shares ?? []) if (s.last_error) console.log(`  note  share ${s.email}: ${s.last_error}`);

  console.log(failures ? `${failures} check(s) failed` : 'OK');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('FAIL:', (err as Error).message);
  process.exit(1);
});
