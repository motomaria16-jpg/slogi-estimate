import { validateSupabaseServiceUrl } from './listings/supabase-url.ts';

export interface EnvironmentReader {
  get(name: string): string | undefined;
}

export interface GateEnvironment {
  baseUrl: string;
  anonKey: string;
  serviceKey: string;
  signingKey: Uint8Array;
  rateLimitKey: Uint8Array;
}

export interface GrantClaims {
  grantId: string;
  userId: string;
  workspaceId: string;
  version: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export type GateAuthorization =
  | { ok: true; userId: string; grant: string; claims: GrantClaims }
  | { ok: false; status: number };

const encoder = new TextEncoder();
const GRANT_PREFIX = 'sg1';
const OPAQUE_BYTES = 32;
const OPAQUE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PASSWORD_KDF_ITERATIONS = 210_000;
const PASSWORD_KDF_BITS = 256;
const PASSWORD_PROOF_MESSAGE = encoder.encode('slogi-password-gate-proof-v1');

export function runtimeEnvironment(): EnvironmentReader {
  return { get: (name: string) => typeof Deno !== 'undefined' ? Deno.env.get(name) : undefined };
}

export function uuid(value: unknown): string | null {
  const normalized = String(value || '').toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid_base64url');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  let binary: string;
  try { binary = atob(padded); } catch { throw new Error('invalid_base64url'); }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomOpaqueToken(randomBytes?: Uint8Array): string {
  const bytes = randomBytes || crypto.getRandomValues(new Uint8Array(OPAQUE_BYTES));
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== OPAQUE_BYTES) throw new Error('invalid_random');
  return base64Url(bytes);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function importHmacKey(bytes: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 32) throw new Error('invalid_key');
  return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

export async function hmacHex(keyBytes: Uint8Array, value: string): Promise<string> {
  const key = await importHmacKey(keyBytes, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacBase64Url(keyBytes: Uint8Array, value: string): Promise<string> {
  const key = await importHmacKey(keyBytes, ['sign']);
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

async function verifyHmacBase64Url(keyBytes: Uint8Array, value: string, signature: string): Promise<boolean> {
  if (!OPAQUE_PATTERN.test(signature)) return false;
  const key = await importHmacKey(keyBytes, ['verify']);
  return crypto.subtle.verify('HMAC', key, decodeBase64Url(signature), encoder.encode(value));
}

async function derivePasswordKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_KDF_ITERATIONS },
    material,
    PASSWORD_KDF_BITS,
  );
  return new Uint8Array(bits);
}

export async function passwordMatches(candidate: string, configured: string, salt: Uint8Array): Promise<boolean> {
  if (typeof candidate !== 'string' || typeof configured !== 'string' || !configured || salt.byteLength < 32) return false;
  const [candidateBytes, expectedBytes] = await Promise.all([
    derivePasswordKey(candidate, salt),
    derivePasswordKey(configured, salt),
  ]);
  const expectedKey = await importHmacKey(expectedBytes, ['sign']);
  const proof = await crypto.subtle.sign('HMAC', expectedKey, PASSWORD_PROOF_MESSAGE);
  const candidateKey = await importHmacKey(candidateBytes, ['verify']);
  return crypto.subtle.verify('HMAC', candidateKey, proof, PASSWORD_PROOF_MESSAGE);
}

export async function signGrant(claims: GrantClaims, signingKey: Uint8Array): Promise<string> {
  if (!uuid(claims.grantId) || !uuid(claims.userId) || !uuid(claims.workspaceId)
      || !Number.isSafeInteger(claims.version) || claims.version < 1
      || !Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt)
      || claims.expiresAt <= claims.issuedAt || !OPAQUE_PATTERN.test(claims.nonce)) {
    throw new Error('invalid_grant_claims');
  }
  const payload = [
    GRANT_PREFIX, claims.grantId, claims.userId, claims.workspaceId,
    claims.version, claims.issuedAt, claims.expiresAt, claims.nonce,
  ].join('.');
  return payload + '.' + await hmacBase64Url(signingKey, payload);
}

export async function verifyGrant(token: unknown, signingKey: Uint8Array, nowMs = Date.now()): Promise<GrantClaims | null> {
  if (typeof token !== 'string' || token.length > 512) return null;
  const parts = token.split('.');
  if (parts.length !== 9 || parts[0] !== GRANT_PREFIX) return null;
  const payload = parts.slice(0, 8).join('.');
  if (!await verifyHmacBase64Url(signingKey, payload, parts[8]).catch(() => false)) return null;
  const grantId = uuid(parts[1]);
  const userId = uuid(parts[2]);
  const workspaceId = uuid(parts[3]);
  const version = Number(parts[4]);
  const issuedAt = Number(parts[5]);
  const expiresAt = Number(parts[6]);
  if (!grantId || !userId || !workspaceId || !Number.isSafeInteger(version) || version < 1
      || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)
      || expiresAt <= Math.floor(nowMs / 1000) || expiresAt <= issuedAt
      || !OPAQUE_PATTERN.test(parts[7])) return null;
  return { grantId, userId, workspaceId, version, issuedAt, expiresAt, nonce: parts[7] };
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > 4096) return null;
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > 4096) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function readGateEnvironment(environment: EnvironmentReader): GateEnvironment {
  const baseUrlValue = String(environment.get('SUPABASE_URL') || '').trim();
  const anonKey = String(environment.get('SUPABASE_ANON_KEY') || '').trim();
  const serviceKey = String(environment.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  const signingRaw = String(environment.get('SLOGI_GATE_SIGNING_KEY') || '').trim();
  const rateRaw = String(environment.get('SLOGI_GATE_RATE_LIMIT_KEY') || '').trim();
  if (!baseUrlValue || !anonKey || !serviceKey || !signingRaw || !rateRaw) throw new Error('gate_not_configured');
  const signingKey = decodeBase64Url(signingRaw);
  const rateLimitKey = decodeBase64Url(rateRaw);
  if (signingKey.byteLength < 32 || rateLimitKey.byteLength < 32) throw new Error('gate_not_configured');
  return {
    baseUrl: validateSupabaseServiceUrl(baseUrlValue),
    anonKey,
    serviceKey,
    signingKey,
    rateLimitKey,
  };
}

export async function authenticateAnonymous(
  request: Request,
  gate: GateEnvironment,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer\s+[^\s]+$/i.test(authorization)) return null;
  const response = await fetchImpl(gate.baseUrl + '/auth/v1/user', {
    headers: { apikey: gate.anonKey, Authorization: authorization, Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null) as Record<string, unknown> | null;
  return user?.is_anonymous === true ? uuid(user.id) : null;
}

export async function serviceRpc(
  gate: GateEnvironment,
  name: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  return fetchImpl(gate.baseUrl + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      apikey: gate.serviceKey,
      Authorization: 'Bearer ' + gate.serviceKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
}

export async function authorizeDeviceGrant(
  request: Request,
  environment: EnvironmentReader = runtimeEnvironment(),
  fetchImpl: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<GateAuthorization> {
  let gate: GateEnvironment;
  try { gate = readGateEnvironment(environment); } catch { return { ok: false, status: 503 }; }
  const userId = await authenticateAnonymous(request, gate, fetchImpl).catch(() => null);
  if (!userId) return { ok: false, status: 401 };
  const grant = String(request.headers.get('x-slogi-device-grant') || '');
  const claims = await verifyGrant(grant, gate.signingKey, nowMs).catch(() => null);
  if (!claims || claims.userId !== userId) return { ok: false, status: 401 };
  const tokenHash = await sha256Hex(grant);
  if (!TOKEN_HASH_PATTERN.test(tokenHash)) return { ok: false, status: 401 };
  const validation = await serviceRpc(gate, 'slogi_validate_password_gate_grant', {
    p_user_id: userId,
    p_grant_id: claims.grantId,
    p_token_hash: tokenHash,
  }, fetchImpl).catch(() => null);
  if (!validation?.ok) return { ok: false, status: validation?.status && validation.status >= 500 ? 503 : 401 };
  const rows = await validation.json().catch(() => null) as unknown;
  const row = Array.isArray(rows) ? rows[0] as Record<string, unknown> | undefined : null;
  if (!row || uuid(row.workspace_id) !== claims.workspaceId
      || Number(row.grant_version) !== claims.version
      || !Number.isFinite(new Date(String(row.expires_at || '')).getTime())) {
    return { ok: false, status: 401 };
  }
  return { ok: true, userId, grant, claims };
}
