const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-slogi-client',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

type Provider = 'cian' | 'avito';
type Page = { html: string; markdown: string; strategy: string; statusCode?: number | null; attempted?: string[]; contentType?: string; links?: string[]; diagnostics?: string[]; captcha?: boolean; captchaSolved?: boolean; proxyPlanLimited?: boolean; blockReason?: string; };

type Listing = {
  source: Provider;
  listingUrl: string;
  address: string;
  area: number | null;
  floor: number | null;
  rentMonthly: number | null;
  latitude: number | null;
  longitude: number | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  previousRentMonthly?: number | null;
  marketStatus?: 'new' | 'active' | 'removed';
  priceChanged?: boolean;
  clusterName?: string;
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
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
  try { return JSON.parse('"' + s.replace(/"/g, '\\"') + '"'); }
  catch (_) { return s.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))); }
}
function decodeHtml(s: string) {
  const named: Record<string,string> = {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '};
  return String(s||'').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, x) => {
    if (x[0] === '#') { const hex=x[1]?.toLowerCase()==='x'; const n=parseInt(x.slice(hex?2:1),hex?16:10); return Number.isFinite(n)?String.fromCodePoint(n):_; }
    return named[String(x).toLowerCase()] ?? _;
  });
}
function normalizeAddress(v: string) {
  return decodeHtml(v).replace(/<[^>]+>/g, ' ').replace(/\\[nrt]/g,' ').replace(/\s+/g, ' ').replace(/^адрес\s*[:—-]?\s*/i, '').trim().replace(/[|·•]\s*$/,'').slice(0,240);
}
function plausibleAddress(v: unknown) {
  const s=normalizeAddress(String(v??''));
  if (s.length < 6 || s.length > 240) return '';
  if (/^(https?:|www\.|цена|аренда|площадь|этаж)/i.test(s)) return '';
  return s;
}
function numeric(v: unknown) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  return n(v);
}
function moneyCandidate(v: unknown) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 1000 ? Math.round(v) : null;
  if (typeof v !== 'string') return null;
  const m=money(v); return m!=null && m>1000 ? m : null;
}
function walkJson(root: unknown, cb: (key:string,value:unknown,parent:any)=>void, depth=0, seen=new Set<any>()) {
  if (depth > 14 || root == null || typeof root !== 'object' || seen.has(root)) return;
  seen.add(root);
  if (Array.isArray(root)) { for (const v of root.slice(0,500)) walkJson(v,cb,depth+1,seen); return; }
  for (const [k,v] of Object.entries(root as Record<string,unknown>)) { cb(k,v,root); walkJson(v,cb,depth+1,seen); }
}
function jsonCandidates(html: string) {
  const out:any[]=[];
  const scripts=html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of scripts) {
    let t=decodeHtml(m[1]||'').trim();
    if (!t || t.length>8_000_000) continue;
    const variants=[t];
    const a=t.indexOf('{'), b=t.lastIndexOf('}'); if(a>=0&&b>a) variants.push(t.slice(a,b+1));
    for(const v of variants){ try{const parsed=JSON.parse(v);out.push(parsed);break}catch(_){} }
  }
  return out;
}
function extractStructured(html:string) {
  let address='', area:null|number=null, floor:null|number=null, rent:null|number=null, latitude:null|number=null, longitude:null|number=null;
  const addressKeys=/^(streetAddress|address|fullAddress|formattedAddress|locationAddress|geoAddress|addressName)$/i;
  const areaKeys=/^(floorSize|totalArea|area|square|squareMeters|objectArea)$/i;
  const floorKeys=/^(floor|floorNumber|floorNum|objectFloor)$/i;
  const priceKeys=/^(price|rentPrice|monthlyPrice|rentMonthly|priceValue)$/i;
  const latKeys=/^(lat|latitude)$/i, lonKeys=/^(lng|lon|longitude)$/i;
  for(const root of jsonCandidates(html)) walkJson(root,(key,value,parent)=>{
    if(!address && addressKeys.test(key)) {
      if(typeof value==='string') address=plausibleAddress(value);
      else if(value&&typeof value==='object') {
        const o=value as any; address=plausibleAddress([o.addressLocality,o.streetAddress,o.house,o.addressRegion].filter(Boolean).join(', '));
      }
    }
    if(area==null && areaKeys.test(key)) {
      if(value&&typeof value==='object' && 'value' in (value as any)) area=numeric((value as any).value); else area=numeric(value);
      if(area!=null && (area<5||area>100000)) area=null;
    }
    if(floor==null && floorKeys.test(key)) { const x=numeric(value); if(x!=null&&x>=-5&&x<=200) floor=x; }
    if(rent==null && priceKeys.test(key)) { const x=moneyCandidate(value); if(x!=null&&x<1_000_000_000) rent=x; }
    if(latitude==null && latKeys.test(key)){const x=numeric(value);if(x!=null&&x>=40&&x<=75)latitude=x;}
    if(longitude==null && lonKeys.test(key)){const x=numeric(value);if(x!=null&&x>=15&&x<=65)longitude=x;}
  });
  return {address,area,floor,rent,latitude,longitude};
}
function metaContent(html:string, names:string[]) {
  for(const name of names){
    const escName=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const patterns=[new RegExp(`<meta[^>]+(?:property|name)=["']${escName}["'][^>]+content=["']([^"']+)["']`,'i'),new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escName}["']`,'i')];
    for(const p of patterns){const m=html.match(p);if(m?.[1])return decodeHtml(m[1]);}
  }
  return '';
}
function cleanListingUrl(raw: string, provider: Provider) {
  try {
    const u = new URL(raw); u.hash = '';
    if (provider === 'cian') u.search = '';
    if (provider === 'avito') ['context','utm_source','utm_medium','utm_campaign'].forEach(k=>u.searchParams.delete(k));
    return u.toString().replace(/\/$/, '');
  } catch (_) { return raw; }
}
function extract(html: string, markdown: string, provider: Provider, url: string): Listing {
  const structured=extractStructured(html);
  const visible=(markdown||'').replace(/\r/g,'\n');
  const htmlText=decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,'\n'));
  const text=(visible+'\n'+htmlText).replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n');
  const meta=[metaContent(html,['og:title']),metaContent(html,['og:description']),metaContent(html,['description'])].join('\n');
  const raw=meta+'\n'+text+'\n'+html;
  let address=structured.address || first(raw,[
    /"streetAddress"\s*:\s*"([^"]{3,180})"/i,
    /(?:Адрес|Расположение|Местоположение)\s*[:—-]?\s*([^\n<]{5,200})/i,
    /(?:Москва|Московская область)[,\s]+([^\n|]{6,190}(?:\d+[А-Яа-яA-Za-z0-9/\-]*))/i,
  ]);
  address=plausibleAddress(decodeJsonText(address));
  let area=structured.area ?? n(first(raw,[
    /(?:Площадь|Общая площадь|помещение)\s*[:—-]?\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:м²|м2|м\^2|кв\.?\s*м)/i,
    /([0-9]+(?:[.,][0-9]+)?)\s*(?:м²|м2|м\^2|кв\.?\s*м)/i,
  ]));
  if(area==null&&provider==='avito'){try{area=n(first(decodeURIComponent(new URL(url).pathname),[/(?:^|_)(\d+(?:[.,]\d+)?)_m(?:_|\/|$)/i,/pomeschenie_(\d+(?:[.,]\d+)?)/i]))}catch(_){}}
  let rent=structured.rent ?? money(first(raw,[
    /(?:Арендная плата|Стоимость аренды|Аренда|Цена)\s*[:—-]?\s*([0-9][0-9\s\u00a0]{3,})\s*(?:₽|руб)/i,
    /([0-9][0-9\s\u00a0]{3,})\s*(?:₽|руб)[^\n]{0,35}(?:мес|месяц)/i,
  ]));
  let floor=structured.floor ?? n(first(raw,[/(?:Этаж|Этаж помещения)\s*[:—-]?\s*(-?\d{1,3})(?:\s*\/\s*\d{1,3})?/i,/(-?\d{1,3})-й\s+этаж/i]));
  if(area!=null&&(area<5||area>100000))area=null;if(floor!=null&&(floor<-5||floor>200))floor=null;if(rent!=null&&(rent<1000||rent>1_000_000_000))rent=null;
  return {source:provider,listingUrl:url,address,area,floor,rentMonthly:rent,latitude:structured.latitude,longitude:structured.longitude};
}

function dbConfig() {
  const url = Deno.env.get('SUPABASE_URL') || '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  return { url: url.replace(/\/$/, ''), key };
}
async function dbFetch(path: string, init: RequestInit = {}) {
  const { url, key } = dbConfig();
  if (!url || !key) throw new Error('Supabase service role environment is unavailable');
  const headers = new Headers(init.headers || {});
  headers.set('apikey', key); headers.set('Authorization', `Bearer ${key}`);
  headers.set('Content-Type', 'application/json');
  const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers });
  const text = await r.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!r.ok) throw new Error(`market DB HTTP ${r.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}
function dbRowToListing(row: any): Listing {
  return { source: row.source, listingUrl: row.listing_url, address: row.address || '', area: row.area == null ? null : Number(row.area), floor: row.floor == null ? null : Number(row.floor), rentMonthly: row.rent_monthly == null ? null : Number(row.rent_monthly), latitude: row.latitude == null ? null : Number(row.latitude), longitude: row.longitude == null ? null : Number(row.longitude), firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, previousRentMonthly: row.previous_rent_monthly == null ? null : Number(row.previous_rent_monthly), marketStatus: row.market_status || 'active', priceChanged: Boolean(row.price_changed), clusterName: row.cluster_name || '' };
}
async function persistListings(items: Listing[], provider: Provider, scanAt: string) {
  const urls = items.map(x => x.listingUrl);
  const encoded = urls.map(u => `"${u.replace(/"/g, '\"')}"`).join(',');
  let existing: any[] = [];
  if (encoded) existing = await dbFetch(`slogi_market_listings?source=eq.${provider}&listing_url=in.(${encodeURIComponent(encoded)})&select=listing_url,rent_monthly,first_seen_at,market_status,address,area,floor,latitude,longitude,cluster_name`);
  const byUrl = new Map(existing.map(r => [r.listing_url, r]));
  const historyRows: any[] = [];
  const rows = items.map(x => {
    const old = byUrl.get(x.listingUrl); const oldRent = old?.rent_monthly == null ? null : Number(old.rent_monthly);
    const changed = oldRent != null && x.rentMonthly != null && oldRent !== x.rentMonthly;
    x.firstSeenAt = old?.first_seen_at || scanAt; x.lastSeenAt = scanAt; x.previousRentMonthly = changed ? oldRent : null; x.priceChanged = changed; x.marketStatus = old ? 'active' : 'new';
    if (x.rentMonthly != null && (!old || changed)) historyRows.push({source:x.source,listing_url:x.listingUrl,rent_monthly:x.rentMonthly,recorded_at:scanAt});
    return { source:x.source, listing_url:x.listingUrl, address:x.address||old?.address||null, area:x.area??(old?.area==null?null:Number(old.area)), floor:x.floor??(old?.floor==null?null:Number(old.floor)), rent_monthly:x.rentMonthly??oldRent, previous_rent_monthly:changed?oldRent:null, latitude:x.latitude??(old?.latitude==null?null:Number(old.latitude)), longitude:x.longitude??(old?.longitude==null?null:Number(old.longitude)), cluster_name:x.clusterName||old?.cluster_name||null, first_seen_at:x.firstSeenAt, last_seen_at:scanAt, last_checked_at:scanAt, market_status:x.marketStatus, price_changed:changed, missed_scans:0, updated_at:scanAt };
  });
  if (rows.length) await dbFetch('slogi_market_listings?on_conflict=source,listing_url', { method:'POST', headers:{'Prefer':'resolution=merge-duplicates,return=minimal'}, body:JSON.stringify(rows) });
  if (historyRows.length) await dbFetch('slogi_market_price_history', { method:'POST', headers:{'Prefer':'return=minimal'}, body:JSON.stringify(historyRows) });
}
async function loadMarket(sources: Provider[], areaMin:number|null, areaMax:number|null, floor:number|null) {
  const parts = ['select=*','order=last_seen_at.desc','limit=600'];
  if (sources.length===1) parts.push(`source=eq.${sources[0]}`);
  if (areaMin!=null) parts.push(`area=gte.${areaMin}`); if (areaMax!=null) parts.push(`area=lte.${areaMax}`); if (floor!=null) parts.push(`floor=eq.${floor}`);
  const rows = await dbFetch(`slogi_market_listings?${parts.join('&')}`);
  return Array.isArray(rows)?rows.map(dbRowToListing):[];
}
async function loadCacheMap(provider:Provider,urls:string[]){
  if(!urls.length)return new Map<string,any>();
  const encoded=urls.map(u=>`"${u.replace(/"/g,'\\"')}"`).join(',');
  try{
    const rows=await dbFetch(`slogi_market_listings?source=eq.${provider}&listing_url=in.(${encodeURIComponent(encoded)})&select=*`);
    return new Map((Array.isArray(rows)?rows:[]).map((r:any)=>[String(r.listing_url),r]));
  }catch(_){return new Map<string,any>();}
}
function cacheFresh(row:any,nowMs:number){
  if(!row||!row.address||row.area==null)return false; // incomplete records are always retried
  const checked=Date.parse(row.last_checked_at||row.updated_at||row.last_seen_at||''); if(!Number.isFinite(checked))return false;
  const first=Date.parse(row.first_seen_at||''); const age=Number.isFinite(first)?nowMs-first:0;
  let ttl=6*60*60*1000;
  if(row.market_status==='new')ttl=45*60*1000;
  else if(age>7*24*60*60*1000)ttl=12*60*60*1000;
  if(row.market_status==='removed')ttl=24*60*60*1000;
  return nowMs-checked<ttl;
}
function jitterMs(){return 120+Math.floor(Math.random()*380);}
async function markConfirmedRemoved(provider: Provider, seen: Set<string>, scanAt: string) {
  const rows = await dbFetch(`slogi_market_listings?source=eq.${provider}&market_status=in.(active,new)&order=last_seen_at.desc&limit=30&select=listing_url`);
  const candidates = (Array.isArray(rows)?rows:[]).map(r=>String(r.listing_url||'')).filter(u=>u&&!seen.has(u)).slice(0,10);
  const removed:string[]=[];
  for (const url of candidates) {
    try { const p=await fetchDirect(url); const t=(p.html||'').toLowerCase(); if (/объявление\s+(?:снято|закрыто|неактивно)|объявление больше не актуально|страница не найдена/.test(t)) removed.push(url); } catch (e) { const m=e instanceof Error?e.message:String(e); if (/HTTP (404|410)/.test(m)) removed.push(url); }
  }
  for (const url of removed) await dbFetch(`slogi_market_listings?source=eq.${provider}&listing_url=eq.${encodeURIComponent(url)}`, { method:'PATCH', headers:{'Prefer':'return=minimal'}, body:JSON.stringify({market_status:'removed',last_checked_at:scanAt,updated_at:scanAt}) });
  return removed.length;
}

async function fetchTimed(url: string, init: RequestInit = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
function sleep(ms:number){ return new Promise(resolve=>setTimeout(resolve,ms)); }
function browserlessConfig(){
  const token=Deno.env.get('BROWSERLESS_TOKEN')||'';
  const base=(Deno.env.get('BROWSERLESS_URL')||'https://production-sfo.browserless.io').replace(/\/$/,'');
  if(!token) throw new Error('BROWSERLESS_TOKEN is not configured');
  return {token,base};
}
function textBlockReason(text:string){
  const t=String(text||'').toLowerCase();
  if(/captcha|recaptcha|hcaptcha|datadome|cloudflare challenge|yandex.*captcha/.test(t)) return 'captcha';
  if(/access denied|доступ ограничен|подтвердите, что вы не робот|проверка браузера|robot check|forbidden|temporarily blocked|слишком много запросов/.test(t)) return 'blocked';
  return '';
}
function pageLooksBlocked(page: Page) { return Boolean(page.blockReason || textBlockReason(`${page.html||''}\n${page.markdown||''}`)); }
function pageLooksThin(page: Page) { return ((page.html || '').length + (page.markdown || '').length) < 5000; }
function isProxyPlanError(status:number,text:string){return [402,403].includes(status)&&/proxy|residential|plan|billing|upgrade|subscription|credits|units/i.test(text);}
function isTimeoutError(e:unknown){return e instanceof DOMException&&e.name==='AbortError'||/abort|timeout/i.test(e instanceof Error?e.message:String(e));}
async function fetchDirect(url: string): Promise<Page> {
  const r = await fetchTimed(url, { headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml',
  }, redirect: 'follow' }, 8000);
  const html = await r.text();
  if (!r.ok) throw new Error(`source HTTP ${r.status}`);
  return { html, markdown: '', strategy: 'server-fetch', statusCode:r.status, contentType:r.headers.get('content-type')||'', blockReason:textBlockReason(html) };
}
async function fetchBrowserless(url: string): Promise<Page> {
  const {token,base}=browserlessConfig();
  const r = await fetchTimed(`${base}/smart-scrape?token=${encodeURIComponent(token)}&timeout=14000`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formats: ['html', 'markdown', 'links'] }),
  }, 18000);
  const raw=await r.text();
  if (!r.ok) throw new Error(`Browserless smart-scrape HTTP ${r.status}: ${raw.slice(0,240)}`);
  let out:any={}; try{out=JSON.parse(raw)}catch(_){throw new Error('Browserless smart-scrape returned invalid JSON')}
  if (!out?.ok || !out?.content) throw new Error(out?.message || 'Browserless smart-scrape returned no content');
  const html = typeof out.content === 'string' ? out.content : JSON.stringify(out.content);
  const markdown=String(out.markdown||'');
  return { html, markdown, strategy: String(out.strategy || 'smart-scrape'), statusCode:out.statusCode??null, attempted:Array.isArray(out.attempted)?out.attempted:[], contentType:String(out.contentType||''), links:Array.isArray(out.links)?out.links.map(String):[], blockReason:textBlockReason(`${html}\n${markdown}`) };
}
async function fetchBrowserContent(url: string): Promise<Page> {
  const {token,base}=browserlessConfig();
  const r = await fetchTimed(`${base}/content?token=${encodeURIComponent(token)}&timeout=16000`, {
    method:'POST', headers:{'Content-Type':'application/json','Cache-Control':'no-cache'},
    body:JSON.stringify({url,bestAttempt:true,gotoOptions:{waitUntil:'domcontentloaded',timeout:13000}})
  }, 19000);
  const html = await r.text();
  if (!r.ok) throw new Error(`Browserless content HTTP ${r.status}: ${html.slice(0,240)}`);
  return {html,markdown:'',strategy:'browser-content',statusCode:r.status,contentType:r.headers.get('content-type')||'',blockReason:textBlockReason(html)};
}
async function fetchUnblock(url:string,useResidential=true):Promise<Page>{
  const {token,base}=browserlessConfig();
  const proxy=useResidential?'&proxy=residential':'';
  const r=await fetchTimed(`${base}/unblock?token=${encodeURIComponent(token)}${proxy}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,content:true,cookies:false,screenshot:false,browserWSEndpoint:false,bestAttempt:true,gotoOptions:{waitUntil:'domcontentloaded',timeout:15000}})
  },22000);
  const raw=await r.text();
  if(!r.ok){
    if(useResidential&&isProxyPlanError(r.status,raw)){
      const fallback=await fetchUnblock(url,false); fallback.proxyPlanLimited=true; return fallback;
    }
    throw new Error(`Browserless unblock HTTP ${r.status}: ${raw.slice(0,260)}`);
  }
  let out:any={};try{out=JSON.parse(raw)}catch(_){throw new Error('Browserless unblock returned invalid JSON')}
  const html=String(out?.content||'');
  if(!html) throw new Error('Browserless unblock returned no content');
  return {html,markdown:'',strategy:useResidential?'unblock-residential':'unblock',statusCode:200,contentType:'text/html',proxyPlanLimited:false,blockReason:textBlockReason(html)};
}
async function fetchStealthBql(url:string):Promise<Page>{
  const {token,base}=browserlessConfig();
  const literal=JSON.stringify(url);
  const query=`mutation SlogiFetch { goto(url: ${literal}) { status } solve { found solved time error } html { html } }`;
  const r=await fetchTimed(`${base}/stealth/bql?token=${encodeURIComponent(token)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables:{},operationName:'SlogiFetch'})},30000);
  const raw=await r.text();
  if(!r.ok) throw new Error(`Browserless stealth BQL HTTP ${r.status}: ${raw.slice(0,260)}`);
  let out:any={};try{out=JSON.parse(raw)}catch(_){throw new Error('Browserless stealth BQL returned invalid JSON')}
  if(Array.isArray(out?.errors)&&out.errors.length) throw new Error(`Browserless stealth BQL: ${String(out.errors[0]?.message||'GraphQL error').slice(0,260)}`);
  const html=String(out?.data?.html?.html||''); const solve=out?.data?.solve||{};
  if(!html) throw new Error('Browserless stealth BQL returned no HTML');
  return {html,markdown:'',strategy:'stealth-bql',statusCode:Number(out?.data?.goto?.status)||200,contentType:'text/html',captcha:Boolean(solve?.found),captchaSolved:Boolean(solve?.solved),blockReason:textBlockReason(html)};
}
async function fetchReader(url: string): Promise<Page> {
  const reader = `https://r.jina.ai/${url}`;
  const r = await fetchTimed(reader, { headers: { 'Accept': 'text/plain', 'X-Return-Format': 'markdown' } }, 9000);
  const markdown = await r.text();
  if (!r.ok) throw new Error(`reader HTTP ${r.status}`);
  return { html: '', markdown, strategy: 'reader', statusCode:r.status, contentType:r.headers.get('content-type')||'',blockReason:textBlockReason(markdown) };
}
async function fetchCascade(url:string,provider:Provider,kind:'search'|'card'):Promise<Page>{
  const attempts:string[]=[]; let bestBlocked:Page|null=null; let proxyPlanLimited=false;
  const methods:Array<[string,()=>Promise<Page>]> = provider==='avito'
    ? [['unblock',()=>fetchUnblock(url,true)],['stealth-bql',()=>fetchStealthBql(url)],['smart-scrape',()=>fetchBrowserless(url)],['content',()=>fetchBrowserContent(url)],['reader',()=>fetchReader(url)]]
    : [['smart-scrape',()=>fetchBrowserless(url)],['content',()=>fetchBrowserContent(url)],['unblock',()=>fetchUnblock(url,true)],['stealth-bql',()=>fetchStealthBql(url)],['reader',()=>fetchReader(url)]];
  for(const [name,fn] of methods){
    try{
      const page=await fn(); attempts.push(`${name}:ok`); proxyPlanLimited=proxyPlanLimited||Boolean(page.proxyPlanLimited);
      if(pageLooksBlocked(page)||pageLooksThin(page)){ if(!bestBlocked||((page.html||'').length+(page.markdown||'').length)>((bestBlocked.html||'').length+(bestBlocked.markdown||'').length)) bestBlocked=page; attempts[attempts.length-1]+=':blocked-or-thin'; continue; }
      page.attempted=attempts; page.proxyPlanLimited=proxyPlanLimited||page.proxyPlanLimited; return page;
    }catch(e){attempts.push(`${name}:${isTimeoutError(e)?'timeout':'error'}:${(e instanceof Error?e.message:String(e)).slice(0,160)}`);}
  }
  if(bestBlocked){bestBlocked.attempted=attempts;bestBlocked.proxyPlanLimited=proxyPlanLimited||bestBlocked.proxyPlanLimited;bestBlocked.blockReason=bestBlocked.blockReason||'blocked';return bestBlocked;}
  const err:any=new Error(`${provider} ${kind}: all fetch methods failed · ${attempts.join(' · ')}`);err.attempted=attempts;err.proxyPlanLimited=proxyPlanLimited;throw err;
}
async function fetchPage(url: string, preferBrowser = false, forceRenderedOnWeak = false): Promise<Page> {
  // Kept for compatibility with removal confirmation; market scans use fetchCascade.
  const errors: string[] = [];
  const attempts = preferBrowser ? [fetchBrowserless, fetchDirect, fetchReader] : [fetchDirect, fetchBrowserless, fetchReader];
  for (const fn of attempts) { try { const page=await fn(url); if(!pageLooksBlocked(page))return page; } catch(e){errors.push(e instanceof Error?e.message:String(e));} }
  if(forceRenderedOnWeak){try{return await fetchBrowserContent(url)}catch(e){errors.push(e instanceof Error?e.message:String(e));}}
  throw new Error(errors.join(' · '));
}

function searchUrl(provider: Provider, page: number) {
  if (provider === 'cian') {
    const u = new URL('https://www.cian.ru/cat.php');
    u.searchParams.set('deal_type', 'rent');
    u.searchParams.set('engine_version', '2');
    u.searchParams.set('offer_type', 'offices');
    u.searchParams.set('region', '1');
    u.searchParams.set('p', String(page));
    return u.toString();
  }
  const base = 'https://www.avito.ru/moskva/kommercheskaya_nedvizhimost/sdam-ASgBAgICAUSwCw';
  const u = new URL(base); u.searchParams.set('p', String(page)); return u.toString();
}
function absoluteUrl(value: string, provider: Provider) {
  try { return new URL(value, provider === 'cian' ? 'https://www.cian.ru' : 'https://www.avito.ru').toString(); }
  catch (_) { return ''; }
}
function discoverLinks(page: Page, provider: Provider) {
  const raw = `${page.html}\n${page.markdown}`;
  const links = new Set<string>();
  const add = (value: string) => {
    const decoded = value.replace(/&amp;/g, '&').replace(/\\\//g, '/');
    const abs = absoluteUrl(decoded, provider);
    if (!abs) return;
    const u = new URL(abs);
    const host = u.hostname.toLowerCase();
    if (provider === 'cian') {
      if (!(host === 'cian.ru' || host.endsWith('.cian.ru'))) return;
      if (!/^\/rent\/commercial\/\d+\/?$/i.test(u.pathname)) return;
    } else {
      if (!(host === 'avito.ru' || host.endsWith('.avito.ru'))) return;
      if (!/\/kommercheskaya_nedvizhimost\//i.test(u.pathname)) return;
      if (!/_(?:\d{6,})(?:\?|$|\/)/.test(u.pathname + u.search)) return;
    }
    links.add(cleanListingUrl(abs, provider));
  };
  for (const link of page.links || []) add(link);
  const href = /(?:href\s*=\s*["']|\]\()([^"')\s<>]+)(?:["']|\))/gi;
  for (const m of raw.matchAll(href)) add(m[1]);
  const plain = provider === 'cian'
    ? /https?:\/\/(?:www\.)?cian\.ru\/rent\/commercial\/\d+\/?[^\s"'<>)]*/gi
    : /https?:\/\/(?:www\.)?avito\.ru\/[^\s"'<>)]*kommercheskaya_nedvizhimost\/[^\s"'<>)]*/gi;
  for (const match of raw.match(plain) || []) add(match);
  return [...links];
}
function passes(listing: Listing, areaMin: number | null, areaMax: number | null, floor: number | null) {
  if (areaMin != null && (listing.area == null || listing.area < areaMin)) return false;
  if (areaMax != null && (listing.area == null || listing.area > areaMax)) return false;
  if (floor != null && (listing.floor == null || listing.floor !== floor)) return false;
  return true;
}
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let cursor = 0;
  async function run() { while (true) { const i = cursor++; if (i >= items.length) return; out[i] = await worker(items[i]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run)); return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action === 'update-clusters') {
      const rows = Array.isArray(body?.clusters) ? body.clusters.slice(0, 250) : [];
      try {
        for (const row of rows) {
          if (!row?.source || !row?.listingUrl || !row?.clusterName) continue;
          await dbFetch(`slogi_market_listings?source=eq.${row.source}&listing_url=eq.${encodeURIComponent(String(row.listingUrl))}`, { method:'PATCH', headers:{'Prefer':'return=minimal'}, body:JSON.stringify({cluster_name:String(row.clusterName).slice(0,160),updated_at:new Date().toISOString()}) });
        }
        return response({ ok:true, updated:rows.length });
      } catch (e) { return response({ ok:false, error:e instanceof Error?e.message:String(e) }, 200); }
    }
    const areaMin = n(body?.areaMin == null ? '' : String(body.areaMin));
    const areaMax = n(body?.areaMax == null ? '' : String(body.areaMax));
    const floor = n(body?.floor == null ? '' : String(body.floor));
    const pages = Math.max(1, Math.min(6, Number(body?.pages) || 2));
    const limitPerSource = Math.max(10, Math.min(100, Number(body?.limitPerSource) || 25));
    const requested = Array.isArray(body?.sources) ? body.sources.filter((x: unknown): x is Provider => x === 'cian' || x === 'avito') : ['cian', 'avito'] as Provider[];
    const persist = body?.persist !== false;
    const scanAt = new Date().toISOString();
    const results: Listing[] = [];
    const sources: Record<string, any> = {};
    let persistence: 'ok'|'unavailable'|'disabled' = persist ? 'ok' : 'disabled';

    const processed = await Promise.all(requested.map(async (provider) => {
      console.log(`[${provider.toUpperCase()}] scan start pages=${pages} limit=${limitPerSource}`);
      const discovered = new Set<string>(); const searchErrors: string[] = []; const strategies = new Set<string>();
      const diagnostic:any = { linksFound:0, cardsRequested:0, networkRequested:0, cardsSucceeded:0, cacheHits:0, addressesParsed:0, areasParsed:0, floorsParsed:0, pricesParsed:0, blocked:0, captcha:0, captchaSolved:0, timeouts:0, proxyPlanLimited:false, errors:0, methodUsed:{} as Record<string,number> };
      const pageNumbers = Array.from({length: pages}, (_, i) => i + 1);
      const searchPages = await Promise.all(pageNumbers.map(async (pageNo) => {
        const url=searchUrl(provider,pageNo);
        try {
          const pageData = await fetchCascade(url,provider,'search'); strategies.add(pageData.strategy); diagnostic.proxyPlanLimited=diagnostic.proxyPlanLimited||Boolean(pageData.proxyPlanLimited);
          diagnostic.methodUsed[pageData.strategy]=(diagnostic.methodUsed[pageData.strategy]||0)+1;
          const links=discoverLinks(pageData, provider);
          if(pageData.captcha)diagnostic.captcha++;if(pageData.captchaSolved)diagnostic.captchaSolved++;
          console.log(`[${provider.toUpperCase()}] search page=${pageNo} method=${pageData.strategy} status=${pageData.statusCode ?? 'n/a'} html=${(pageData.html||'').length} md=${(pageData.markdown||'').length} links=${links.length} block=${pageData.blockReason||'no'} proxyPlanLimited=${Boolean(pageData.proxyPlanLimited)} attempts=${(pageData.attempted||[]).join(' | ')}`);
          return links;
        } catch (e) { const msg=e instanceof Error ? e.message : String(e); searchErrors.push(`search page ${pageNo}: ${msg}`); diagnostic.errors++; if(isTimeoutError(e))diagnostic.timeouts++; if((e as any)?.proxyPlanLimited)diagnostic.proxyPlanLimited=true; console.log(`[${provider.toUpperCase()}] search page=${pageNo} ERROR ${msg}`); return []; }
      }));
      for (const links of searchPages) for (const url of links) { if (discovered.size < limitPerSource) discovered.add(url); }
      const urls = [...discovered].slice(0, limitPerSource); diagnostic.linksFound=urls.length; diagnostic.cardsRequested=urls.length;
      const cache=await loadCacheMap(provider,urls); const nowMs=Date.now();
      console.log(`[${provider.toUpperCase()}] discovered=${urls.length} cacheCandidates=${cache.size}`);
      const details = await mapLimit(urls, 3, async (url) => {
        const cached=cache.get(url);
        if(cacheFresh(cached,nowMs)){
          const listing=dbRowToListing(cached);diagnostic.cacheHits++;diagnostic.cardsSucceeded++;
          if(listing.address)diagnostic.addressesParsed++;if(listing.area!=null)diagnostic.areasParsed++;if(listing.floor!=null)diagnostic.floorsParsed++;if(listing.rentMonthly!=null)diagnostic.pricesParsed++;
          console.log(`[${provider.toUpperCase()}] card CACHE hit address=yes area=${listing.area??'no'} url=${url}`);return listing;
        }
        diagnostic.networkRequested++; await sleep(jitterMs());
        try {
          const pageData = await fetchCascade(url,provider,'card'); strategies.add(pageData.strategy); diagnostic.proxyPlanLimited=diagnostic.proxyPlanLimited||Boolean(pageData.proxyPlanLimited); diagnostic.methodUsed[pageData.strategy]=(diagnostic.methodUsed[pageData.strategy]||0)+1;
          if(pageData.captcha)diagnostic.captcha++;if(pageData.captchaSolved)diagnostic.captchaSolved++;
          const blocked=pageLooksBlocked(pageData);if(blocked)diagnostic.blocked++;
          let listing=extract(pageData.html,pageData.markdown,provider,url);
          diagnostic.cardsSucceeded++;
          if(listing.address)diagnostic.addressesParsed++;if(listing.area!=null)diagnostic.areasParsed++;if(listing.floor!=null)diagnostic.floorsParsed++;if(listing.rentMonthly!=null)diagnostic.pricesParsed++;
          console.log(`[${provider.toUpperCase()}] card method=${pageData.strategy} status=${pageData.statusCode ?? 'n/a'} html=${(pageData.html||'').length} md=${(pageData.markdown||'').length} jsonScripts=${jsonCandidates(pageData.html||'').length} address=${listing.address?'yes':'no'} area=${listing.area??'no'} floor=${listing.floor??'no'} price=${listing.rentMonthly??'no'} block=${pageData.blockReason||'no'} captcha=${Boolean(pageData.captcha)} solved=${Boolean(pageData.captchaSolved)} proxyPlanLimited=${Boolean(pageData.proxyPlanLimited)} attempts=${(pageData.attempted||[]).join(' | ')} url=${url}`);
          return listing;
        } catch (e) { const msg=e instanceof Error?e.message:String(e); diagnostic.errors++;if(isTimeoutError(e))diagnostic.timeouts++;if((e as any)?.proxyPlanLimited)diagnostic.proxyPlanLimited=true;searchErrors.push(`card ${url}: ${msg}`); console.log(`[${provider.toUpperCase()}] card ERROR url=${url} ${msg}`); return { source: provider, listingUrl: url, address: '', area: null, floor: null, rentMonthly: null, latitude: null, longitude: null } as Listing; }
      });
      const accepted = details.filter(x => passes(x, areaMin, areaMax, floor));
      const addressOk=details.filter(x=>Boolean(x.address)).length, areaOk=details.filter(x=>x.area!=null).length, floorOk=details.filter(x=>x.floor!=null).length, priceOk=details.filter(x=>x.rentMonthly!=null).length;
      let removedConfirmed=0; let persistenceOk=true;
      if (persist && details.length) {
        try { await persistListings(details, provider, scanAt); if(urls.length)removedConfirmed=await markConfirmedRemoved(provider,new Set(urls),scanAt); }
        catch (e) { persistenceOk=false; searchErrors.push(`history: ${e instanceof Error?e.message:String(e)}`); }
      }
      const qualityLow=details.length>5&&(addressOk/details.length<0.7||areaOk/details.length<0.7);
      const status=urls.length===0?'unavailable':qualityLow?'partial':'ok';
      console.log(`[${provider.toUpperCase()}] SUMMARY linksFound=${diagnostic.linksFound} cards=${diagnostic.cardsRequested} network=${diagnostic.networkRequested} cacheHits=${diagnostic.cacheHits} success=${diagnostic.cardsSucceeded} addresses=${diagnostic.addressesParsed} areas=${diagnostic.areasParsed} prices=${diagnostic.pricesParsed} blocked=${diagnostic.blocked} captcha=${diagnostic.captcha}/${diagnostic.captchaSolved} timeouts=${diagnostic.timeouts} proxyPlanLimited=${diagnostic.proxyPlanLimited} methods=${JSON.stringify(diagnostic.methodUsed)} errors=${diagnostic.errors}`);
      return { provider, accepted, persistenceOk, meta:{ status, discovered: urls.length, returned: accepted.length, strategies:[...strategies], errors:searchErrors.slice(0,20), removedConfirmed, diagnostic, quality:{ addressRate:details.length?addressOk/details.length:0, areaRate:details.length?areaOk/details.length:0, floorRate:details.length?floorOk/details.length:0, priceRate:details.length?priceOk/details.length:0, warning:qualityLow } } };
    }));
    for (const item of processed) { results.push(...item.accepted); sources[item.provider]=item.meta; if (!item.persistenceOk) persistence='unavailable'; }

    let data=results;
    if (persist && persistence==='ok' && body?.includeHistory!==false) {
      try { data=await loadMarket(requested,areaMin,areaMax,floor); }
      catch (_) { persistence='unavailable'; }
    }
    return response({ data, meta:{ sources, pages, limitPerSource, fetchedAt:scanAt, persistence } });
  } catch (e) { return response({ error: e instanceof Error ? e.message : String(e) }, 500); }
});
