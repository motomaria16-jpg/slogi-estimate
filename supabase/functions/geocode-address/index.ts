const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-slogi-client',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function parseResults(payload: any, fallbackAddress: string) {
  const members = payload?.response?.GeoObjectCollection?.featureMember;
  if (!Array.isArray(members)) return [];
  return members.map((item: any) => {
    const obj = item?.GeoObject || {};
    const meta = obj?.metaDataProperty?.GeocoderMetaData || {};
    const pos = String(obj?.Point?.pos || '').trim().split(/\s+/).map(Number);
    if (pos.length < 2 || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) return null;
    return {
      address: String(meta?.Address?.formatted || meta?.text || [obj?.description, obj?.name].filter(Boolean).join(', ') || fallbackAddress),
      lng: pos[0],
      lat: pos[1],
      precision: String(meta?.precision || ''),
    };
  }).filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json();
    const address = String(body?.address || '').trim();
    if (address.length < 5) return json({ error: 'Укажите адрес.' }, 400);
    const key = String(Deno.env.get('YANDEX_GEOCODER_API_KEY') || body?.apikey || '').trim();
    if (!key) return json({ error: 'Не настроен ключ API Геокодера.' }, 500);

    const url = new URL('https://geocode-maps.yandex.ru/v1/');
    url.searchParams.set('apikey', key);
    url.searchParams.set('geocode', address);
    url.searchParams.set('lang', 'ru_RU');
    url.searchParams.set('format', 'json');
    url.searchParams.set('results', '10');
    url.searchParams.set('rspn', '0');
    if (body?.ll) url.searchParams.set('ll', String(body.ll));
    if (body?.spn) url.searchParams.set('spn', String(body.spn));

    const origin = String(req.headers.get('origin') || '').trim();
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (origin) headers['Referer'] = origin.endsWith('/') ? origin : `${origin}/`;
    const response = await fetch(url.toString(), { headers });
    let payload: any = null;
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) return json({ error: payload?.message || `Yandex Geocoder HTTP ${response.status}`, status: response.status }, response.status);
    return json({ results: parseResults(payload, address) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
