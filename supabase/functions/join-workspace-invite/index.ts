import { validateSupabaseServiceUrl } from '../_shared/listings/supabase-url.ts';
import type { EnvironmentReader } from '../_shared/workspace-invites.ts';
import {
  inviteTokenHmacHex,
  readJsonObject,
  runtimeEnvironment,
  uuid,
  validInviteToken,
} from '../_shared/workspace-invites.ts';

interface Dependencies {
  environment?: EnvironmentReader;
  fetch?: typeof fetch;
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

export function createJoinWorkspaceInviteHandler(dependencies: Dependencies = {}): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (request.method !== 'POST') return response({ status: 'invalid_request' }, 405);

    const authorization = request.headers.get('Authorization') || '';
    if (!/^Bearer\s+[^\s]+$/i.test(authorization)) return response({ status: 'unauthorized' }, 401);
    const body = await readJsonObject(request);
    if (!body || Object.keys(body).length !== 1 || !validInviteToken(body.token)) {
      return response({ status: 'invite_not_available' }, 404);
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

      const tokenHash = await inviteTokenHmacHex(body.token, pepper);
      const rpcResponse = await fetchImpl(`${baseUrl}/rest/v1/rpc/slogi_accept_shared_workspace_invite`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ p_user_id: userId, p_token_hash: tokenHash }),
      });
      if (!rpcResponse.ok) return response({ status: 'invite_not_available' }, 404);
      const accepted = await rpcResponse.json().catch(() => null);
      if (accepted !== true) return response({ status: 'invite_not_available' }, 404);
      return response({ status: 'connected' });
    } catch {
      return response({ status: 'provider_error' }, 503);
    }
  };
}

if (typeof Deno !== 'undefined' && import.meta.main) {
  Deno.serve(createJoinWorkspaceInviteHandler());
}
