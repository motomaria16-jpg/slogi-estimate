export interface EnvironmentReader {
  get(name: string): string | undefined;
}

export const INVITE_TOKEN_BYTES = 32;
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITE_MAX_USES = 5;

export function uuid(value: unknown): string | null {
  const normalized = String(value || '').toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null;
}

export function validInviteToken(value: unknown): value is string {
  return typeof value === 'string' && INVITE_TOKEN_PATTERN.test(value);
}

export function generateOpaqueInviteToken(randomBytes?: Uint8Array): string {
  const bytes = randomBytes || crypto.getRandomValues(new Uint8Array(INVITE_TOKEN_BYTES));
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== INVITE_TOKEN_BYTES) {
    throw new Error('invite_random_invalid');
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function inviteTokenHmacHex(token: string, pepper: string): Promise<string> {
  if (!validInviteToken(token) || typeof pepper !== 'string' || pepper.length < 32) {
    throw new Error('invite_digest_invalid');
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(token));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > 4096) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 4096) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function runtimeEnvironment(): EnvironmentReader {
  return { get: (name: string) => typeof Deno !== 'undefined' ? Deno.env.get(name) : undefined };
}
