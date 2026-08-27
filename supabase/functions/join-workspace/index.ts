const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

export function createJoinWorkspaceHandler(): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (request.method !== 'POST') return response({ status: 'invalid_request', error: 'Method not allowed' }, 405);
    return response({ status: 'invite_required', error: 'Используйте ссылку-приглашение.' }, 410);
  };
}

if (typeof Deno !== 'undefined' && import.meta.main) {
  Deno.serve(createJoinWorkspaceHandler());
}
