import { validateSupabaseServiceUrl } from '../_shared/listings/supabase-url.ts';
import type { EnvironmentReader } from '../_shared/workspace-invites.ts';
import {
  generateOpaqueInviteToken,
  INVITE_MAX_USES,
  INVITE_TTL_MS,
  inviteTokenHmacHex,
  readJsonObject,
  runtimeEnvironment,
  uuid,
  validInviteToken,
} from '../_shared/workspace-invites.ts';

interface Dependencies {
  environment?: EnvironmentReader;
  fetch?: typeof fetch;
  now?: () => number;
  generateToken?: () => string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function exactKeys(body: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(body).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function createWorkspaceInvitesHandler(dependencies: Dependencies = {}): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (request.method !== 'POST') return response({ status: 'invalid_request' }, 405);

    const authorization = request.headers.get('Authorization') || '';
    if (!/^Bearer\s+[^\s]+$/i.test(authorization)) return response({ status: 'unauthorized' }, 401);
    const body = await readJsonObject(request);
    const action = body?.action;
    if (!body || (action !== 'create' && action !== 'revoke')) return response({ status: 'invalid_request' }, 400);
    if (action === 'create' && !exactKeys(body, ['action'])) return response({ status: 'invalid_request' }, 400);
    if (action === 'revoke' && (!exactKeys(body, ['action', 'inviteId']) || !uuid(body.inviteId))) {
      return response({ status: 'invalid_request' }, 400);
    }

    const environment = dependencies.environment || runtimeEnvironment();
    const baseUrlValue = String(environment.get('SUPABASE_URL') || '').trim();
    const anonKey = String(environment.get('SUPABASE_ANON_KEY') || '').trim();
    const serviceKey = String(environment.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
    const pepper = String(environment.get('SLOGI_WORKSPACE_INVITE_PEPPER') || '').trim();
    if (!baseUrlValue || !anonKey || !serviceKey || pepper.length < 32) {
      return response({ status: 'provider_error' }, 503);
    }

    let baseUrl: string;
    try { baseUrl = validateSupabaseServiceUrl(baseUrlValue); }
    catch { return response({ status: 'provider_error' }, 503); }
    const fetchImpl = dependencies.fetch || fetch;

    try {
      const userResponse = await fetchImpl(`${baseUrl}/auth/v1/user`, {
        headers: { apikey: anonKey, Authorization: authorization, Accept: 'application/json' },
      });
      if (!userResponse.ok) return response({ status: 'unauthorized' }, 401);
      const user = await userResponse.json().catch(() => null) as Record<string, unknown> | null;
      const userId = uuid(user?.id);
      if (!userId || user?.is_anonymous !== true) return response({ status: 'unauthorized' }, 401);

      if (action === 'revoke') {
        const rpcResponse = await fetchImpl(`${baseUrl}/rest/v1/rpc/slogi_revoke_shared_workspace_invite`, {
          method: 'POST',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ p_user_id: userId, p_invite_id: uuid(body.inviteId) }),
        });
        if (!rpcResponse.ok || await rpcResponse.json().catch(() => null) !== true) {
          return response({ status: 'invite_not_available' }, 404);
        }
        return response({ status: 'revoked' });
      }

      const token = (dependencies.generateToken || generateOpaqueInviteToken)();
      if (!validInviteToken(token)) return response({ status: 'provider_error' }, 503);
      const tokenHash = await inviteTokenHmacHex(token, pepper);
      const now = (dependencies.now || Date.now)();
      const expiresAt = new Date(now + INVITE_TTL_MS).toISOString();
      const rpcResponse = await fetchImpl(`${baseUrl}/rest/v1/rpc/slogi_create_shared_workspace_invite`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          p_user_id: userId,
          p_token_hash: tokenHash,
          p_expires_at: expiresAt,
          p_max_uses: INVITE_MAX_USES,
        }),
      });
      if (!rpcResponse.ok) return response({ status: 'invite_not_available' }, 404);
      const rows = await rpcResponse.json().catch(() => null) as unknown;
      const row = Array.isArray(rows) ? rows[0] as Record<string, unknown> | undefined : null;
      const inviteId = uuid(row?.invite_id);
      const confirmedExpiry = typeof row?.expires_at === 'string' ? row.expires_at : '';
      if (!inviteId || !confirmedExpiry) return response({ status: 'provider_error' }, 503);
      return response({ status: 'created', inviteToken: token, inviteId, expiresAt: confirmedExpiry });
    } catch {
      return response({ status: 'provider_error' }, 503);
    }
  };
}

if (typeof Deno !== 'undefined' && import.meta.main) {
  Deno.serve(createWorkspaceInvitesHandler());
}
