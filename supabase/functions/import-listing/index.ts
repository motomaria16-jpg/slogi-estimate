const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-slogi-client',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

type Provider = 'cian' | 'avito';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function cleanUrl(raw: string) {
  const u = new URL(raw);
  u.hash = '';
  if (/^(?:www\.)?(?:cian\.ru|avito\.ru)$/i.test(u.hostname)) u.search = '';
  return u.toString();
}
function providerOf(url: string): Provider | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'cian.ru' || host.endsWith('.cian.ru')) return 'cian';
    if (host === 'avito.ru' || host.endsWith('.avito.ru')) return 'avito';
  } catch (_) {}
  return null;
}
function n(value: string | null | undefined) {
  if (!value) return null;
  const v = Number(String(value).replace(/\u00a0/g, ' ').replace(/[^0-9,.-]/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}
function money(value: string | null | undefined) {
  if (!value) return null;
  const digits = String(value).replace(/\u00a0/g, ' ').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}
function first(text: string, patterns: RegExp[]) {
  for (const p of patterns) { const m = text.match(p); if (m?.[1]) return m[1].trim(); }
  return '';
}
function decodeJsonText(s: string) {
  try { return JSON.parse('"' + s.replace(/"/g, '\\"') + '"'); } catch (_) { return s.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))); }
}
function normalizeAddress(v: string) {
  return v.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').replace(/^адрес\s*[:—-]?\s*/i, '').trim();
}
function extract(html: string, markdown: string, provider: Provider, url: string) {
  const text = (markdown || html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, '\n')).replace(/&nbsp;/gi, ' ');
  const raw = html + '\n' + text;
  let address = first(raw, [
    /"streetAddress"\s*:\s*"([^"]{3,180})"/i,
    /"address"\s*:\s*"([^"{][^"]{4,220})"/i,
    /(?:Адрес|Расположение|Местоположение)\s*[:—-]?\s*([^\n<]{5,180})/i,
    /(Москва\s*,\s*(?:ул\.|улица|ш\.|шоссе|проспект|пр-т|пер\.|переулок|наб\.|набережная)[^\n<]{3,140}?\d+[А-Яа-яA-Za-z0-9/\-]*)/i,
  ]);
  address = normalizeAddress(decodeJsonText(address));
  let area = n(first(raw, [
    /"floorSize"[\s\S]{0,100}?"value"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)/i,
    /(?:Площадь|Общая площадь)\s*[:—-]?\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:м²|м2|кв\.?\s*м)/i,
    /([0-9]+(?:[.,][0-9]+)?)\s*(?:м²|м2|кв\.?\s*м)/i,
  ]));
  if (area == null && provider === 'avito') area = n(first(decodeURIComponent(new URL(url).pathname), [/(?:^|_)(\d+(?:[.,]\d+)?)_m(?:_|\/|$)/i, /pomeschenie_(\d+(?:[.,]\d+)?)/i]));
  const rent = money(first(raw, [
    /"price"\s*:\s*"?([0-9][0-9\s\u00a0]{3,})"?/i,
    /(?:Арендная плата|Стоимость аренды|Аренда|Цена)\s*[:—-]?\s*([0-9][0-9\s\u00a0]*)\s*(?:₽|руб)/i,
    /([0-9][0-9\s\u00a0]{3,})\s*(?:₽|руб)[^\n]{0,24}(?:мес|месяц)/i,
  ]));
  const ceilingHeight = n(first(raw, [/(?:Высота потолк(?:а|ов))\s*[:—-]?\s*([0-9]+(?:[.,][0-9]+)?)\s*м/i]));
  const windowsCount = n(first(raw, [/(?:Количество окон|Окон)\s*[:—-]?\s*([0-9]+)/i, /([0-9]+)\s+окон(?:а|о)?\b/i]));
  const lat = n(first(raw, [/"(?:lat|latitude)"\s*:\s*"?([0-9]{2}\.[0-9]+)/i]));
  const lng = n(first(raw, [/"(?:lng|lon|longitude)"\s*:\s*"?([0-9]{2}\.[0-9]+)/i]));
  return { address, area, rentMonthly: rent, ceilingHeight, windowsCount, latitude: lat, longitude: lng };
}

async function fetchDirect(url: string) {
  const r = await fetch(url, { headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml',
  }, redirect: 'follow' });
  if (!r.ok) throw new Error(`source HTTP ${r.status}`);
  return { html: await r.text(), markdown: '', strategy: 'server-fetch' };
}
async function fetchBrowserless(url: string) {
  const token = Deno.env.get('BROWSERLESS_TOKEN') || '';
  if (!token) throw new Error('BROWSERLESS_TOKEN is not configured');
  const base = (Deno.env.get('BROWSERLESS_URL') || 'https://production-sfo.browserless.io').replace(/\/$/, '');
  const r = await fetch(`${base}/smart-scrape?token=${encodeURIComponent(token)}&timeout=30000`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formats: ['html', 'markdown'], proxy: 'residential' }),
  });
  if (!r.ok) throw new Error(`Browserless HTTP ${r.status}`);
  const out = await r.json();
  if (!out?.ok || !out?.content) throw new Error(out?.message || 'Browserless returned no content');
  return { html: String(out.content || ''), markdown: String(out.markdown || ''), strategy: String(out.strategy || 'browserless') };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json();
    const rawUrl = String(body?.url || '').trim();
    const provider = providerOf(rawUrl);
    if (!provider) return response({ error: 'Поддерживаются только ссылки ЦИАН и Авито.' }, 400);
    const url = cleanUrl(rawUrl);
    let page: { html: string; markdown: string; strategy: string };
    const errors: string[] = [];
    try { page = await fetchDirect(url); }
    catch (e) { errors.push(String(e)); try { page = await fetchBrowserless(url); } catch (b) { errors.push(String(b)); return response({ error: 'Источник блокирует серверное чтение. Для стабильного импорта настройте BROWSERLESS_TOKEN в Supabase Edge Function.', details: errors }, 502); } }
    let data = extract(page.html, page.markdown, provider, url);
    const score = [data.address, data.area, data.rentMonthly, data.ceilingHeight, data.windowsCount, data.latitude, data.longitude].filter(v => v !== null && v !== '').length;
    if (score < 2 && Deno.env.get('BROWSERLESS_TOKEN') && page.strategy === 'server-fetch') {
      try { const b = await fetchBrowserless(url); page = b; data = extract(b.html, b.markdown, provider, url); } catch (e) { errors.push(String(e)); }
    }
    return response({ data: { ...data, source: provider, listingUrl: rawUrl }, meta: { strategy: page.strategy, errors } });
  } catch (e) {
    return response({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
