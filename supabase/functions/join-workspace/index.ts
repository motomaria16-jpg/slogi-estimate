import { validateSupabaseServiceUrl } from '../_shared/listings/supabase-url.ts';

interface EnvironmentReader {
  get(name: string): string | undefined;
}

interface JoinWorkspaceDependencies {
  environment?: EnvironmentReader;
  fetch?: typeof fetch;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function runtimeEnvironment(): EnvironmentReader {
  return { get: (name: string) => typeof Deno !== 'undefined' ? Deno.env.get(name) : undefined };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function uuid(value: unknown): string | null {
  const normalized = String(value || '').toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > 4096) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 4096) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function createJoinWorkspaceHandler(dependencies: JoinWorkspaceDependencies = {}): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (request.method !== 'POST') return response({ status: 'invalid_request', error: 'Method not allowed' }, 405);

    const authorization = request.headers.get('Authorization') || '';
    if (!/^Bearer\s+[^\s]+$/i.test(authorization)) return response({ status: 'unauthorized', error: 'Unauthorized' }, 401);
    const body = await readJson(request);
    if (!body || Object.keys(body).length !== 1 || typeof body.code !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(body.code.trim())) {
      return response({ status: 'workspace_not_available', error: 'Рабочее пространство недоступно.' }, 404);
    }

    const environment = dependencies.environment || runtimeEnvironment();
    const baseUrlValue = String(environment.get('SUPABASE_URL') || '').trim();
    const anonKey = String(environment.get('SUPABASE_ANON_KEY') || '').trim();
    const serviceKey = String(environment.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
    const pepper = String(environment.get('SLOGI_WORKSPACE_CODE_PEPPER') || '').trim();
    if (!baseUrlValue || !anonKey || !serviceKey || pepper.length < 32) {
      return response({ status: 'provider_error', error: 'Workspace service is not configured.' }, 503);
    }

    let baseUrl: string;
    try { baseUrl = validateSupabaseServiceUrl(baseUrlValue); }
    catch { return response({ status: 'provider_error', error: 'Workspace service is not configured.' }, 503); }
    const fetchImpl = dependencies.fetch || fetch;

    try {
      const userResponse = await fetchImpl(`${baseUrl}/auth/v1/user`, {
        headers: { apikey: anonKey, Authorization: authorization, Accept: 'application/json' },
      });
      if (!userResponse.ok) return response({ status: 'unauthorized', error: 'Unauthorized' }, 401);
      const user = await userResponse.json().catch(() => null) as Record<string, unknown> | null;
      const userId = uuid(user?.id);
      if (!userId || user?.is_anonymous !== true) return response({ status: 'unauthorized', error: 'Anonymous session required.' }, 401);

      const codeHash = await sha256Hex(`${pepper}:${body.code.trim()}`);
      const rpcResponse = await fetchImpl(`${baseUrl}/rest/v1/rpc/slogi_join_shared_workspace_member`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ p_code_hash: codeHash, p_user_id: userId }),
      });
      if (!rpcResponse.ok) return response({ status: 'workspace_not_available', error: 'Рабочее пространство недоступно.' }, 404);
      const workspaceId = uuid(await rpcResponse.json().catch(() => null));
      if (!workspaceId) return response({ status: 'workspace_not_available', error: 'Рабочее пространство недоступно.' }, 404);
      return response({ status: 'connected', workspaceId });
    } catch {
      return response({ status: 'provider_error', error: 'Workspace service is temporarily unavailable.' }, 503);
    }
  };
}

if (typeof Deno !== 'undefined' && import.meta.main) {
  Deno.serve(createJoinWorkspaceHandler());
}
