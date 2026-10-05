// Inline button payloads (docs/fase1-plan.md D4): `v1:<op>:<taskId>[:<rev>]`.
// No signature: callback data only comes from messages the bot sent, the
// webhook is authenticated, and SQL checks the actor again on every action.
// `rev` is the script revision shown in the message (script approvals).

export const CALLBACK_OPS = [
  'acc', // accept a work task
  'dec', // decline it ("Non posso")
  'apr', // approve
  'rim', // send back: ask for confirmation
  'rimc', // send back: confirmed
  'ann', // cancel the send-back, buttons back
] as const;
export type CallbackOp = (typeof CALLBACK_OPS)[number];

export type Callback = { op: CallbackOp; taskId: string; rev: number | null };

// Telegram's limit on callback_data.
export const CALLBACK_MAX_BYTES = 64;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function formatCallback({ op, taskId, rev }: Callback): string {
  const data = ['v1', op, taskId, ...(rev === null ? [] : [String(rev)])].join(':');
  if (Buffer.byteLength(data) > CALLBACK_MAX_BYTES) throw new Error(`callback data too long: ${data}`);
  return data;
}

export function parseCallback(data: string): Callback | null {
  const parts = data.split(':');
  if (parts.length < 3 || parts.length > 4 || parts[0] !== 'v1') return null;
  const [, op, taskId, rev] = parts;
  if (!(CALLBACK_OPS as readonly string[]).includes(op) || !UUID.test(taskId)) return null;
  if (rev !== undefined && !/^\d{1,9}$/.test(rev)) return null;
  return { op: op as CallbackOp, taskId, rev: rev === undefined ? null : Number(rev) };
}
