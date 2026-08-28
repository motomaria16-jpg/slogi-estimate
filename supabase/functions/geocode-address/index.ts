import { GeocodeAddressService, GeocodeServiceError } from './service.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-slogi-client',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...extraHeaders } });
}

function environmentInteger(name: string, fallback: number) {
  const value = Math.trunc(Number(Deno.env.get(name)));
  return Number.isFinite(value) ? value : fallback;
}

const geocoder = new GeocodeAddressService({
  timeoutMs: environmentInteger('GEOCODER_TIMEOUT_MS', 8_000),
  maxAttempts: environmentInteger('GEOCODER_MAX_ATTEMPTS', 3),
  minProviderIntervalMs: environmentInteger('GEOCODER_MIN_INTERVAL_MS', 120),
  clientRateLimit: environmentInteger('GEOCODER_CLIENT_RATE_LIMIT', 600),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json();
    const address = String(body?.address || '').trim();
    if (address.length < 5) return json({ error: 'Укажите адрес.' }, 400);
    const key = String(Deno.env.get('YANDEX_GEOCODER_API_KEY') || body?.apikey || '').trim();
    if (!key) return json({ error: 'Не настроен ключ API Геокодера.' }, 500);

    const clientKey = [req.headers.get('x-forwarded-for') || '', req.headers.get('origin') || '', req.headers.has('authorization') ? 'session' : 'anonymous'].join('|');
    const result = await geocoder.geocode({ address, apiKey: key, ll: String(body?.ll || ''), spn: String(body?.spn || ''), clientKey, referer: String(req.headers.get('origin') || '') });
    return json(result);
  } catch (error) {
    if (error instanceof GeocodeServiceError) {
      const headers = error.retryAfterSeconds == null ? {} : { 'Retry-After': String(error.retryAfterSeconds) };
      return json({ error: error.code, diagnostic: { status: error.code } }, error.status, headers);
    }
    return json({ error: 'geocoder_internal_error', diagnostic: { status: 'geocoder_internal_error' } }, 500);
  }
});
