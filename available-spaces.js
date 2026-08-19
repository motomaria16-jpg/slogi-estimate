(function(){
'use strict';
const cfg=(window.SLOGI_PHASE0_CONFIG&&window.SLOGI_PHASE0_CONFIG.listingSearch)||{};
const api=window.SlogiPhase0||{};
const clusterService=api.clusterService, geocoder=api.geocodingService;
const $=id=>document.getElementById(id);
const els={
  areaMin:$('available-area-min'),areaMax:$('available-area-max'),cluster:$('available-cluster'),floor:$('available-floor'),status:$('available-status'),source:$('available-source'),
  search:$('available-search'),reset:$('available-reset'),sort:$('available-sort'),count:$('available-count'),summary:$('available-summary'),list:$('available-list'),table:$('available-table-wrap'),empty:$('available-empty'),loading:$('available-loading'),loadingText:$('available-loading-text'),lastUpdate:$('available-last-update'),toast:$('available-toast'),diagnostics:$('available-diagnostics'),
  kpiAll:$('kpi-all'),kpiNew:$('kpi-new'),kpiActive:$('kpi-active'),kpiPrice:$('kpi-price'),kpiRemoved:$('kpi-removed')
};
let all=[],filtered=[],busy=false,marketFilter='all',toastTimer=null;
const esc=v=>String(v==null?'':v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const num=v=>{if(v==null||String(v).trim()==='')return null;const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:null};
const money=v=>v==null?'—':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Number(v))+' ₽';
const dateTime=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})};
function decl(n,one,few,many){const a=Math.abs(n)%100,b=a%10;return a>10&&a<20?many:b===1?one:b>=2&&b<=4?few:many}
function toast(message){clearTimeout(toastTimer);els.toast.textContent=message;els.toast.classList.add('show');toastTimer=setTimeout(()=>els.toast.classList.remove('show'),4500)}
function populateClusters(){if(!clusterService)return;clusterService.list().forEach(c=>{const o=document.createElement('option');o.value=c.name;o.textContent=c.name;els.cluster.appendChild(o)})}
function sourcePill(source){return document.querySelector(`.available-source-pill[data-source="${source}"]`)}
function setSource(source,state,text,detail=''){const pill=sourcePill(source);if(!pill)return;pill.classList.remove('neutral','ok','warn','error');pill.classList.add(state);const spans=pill.querySelectorAll('span');if(spans[1])spans[1].textContent=text;const small=pill.querySelector('small');if(small)small.textContent=detail}
function setBusy(value){busy=value;els.search.disabled=value;els.search.innerHTML=value?'Ищем объявления…':'<span aria-hidden="true">⌕</span> Найти объявления';els.loading.hidden=!value;if(value)els.empty.hidden=true}
function cacheKey(address){return 'slogi_available_geo_v2:'+String(address||'').trim().toLowerCase()}
function readGeoCache(address){try{return JSON.parse(localStorage.getItem(cacheKey(address))||'null')}catch(_){return null}}
function saveGeoCache(address,value){try{localStorage.setItem(cacheKey(address),JSON.stringify(value))}catch(_){}}
async function resolveCluster(item){
  if(item.clusterName)return item;
  let geo=(item.latitude!=null&&item.longitude!=null)?{lat:Number(item.latitude),lng:Number(item.longitude)}:null;
  if(geo&&clusterService){const c=clusterService.findByCoordinates(geo.lat,geo.lng)||clusterService.findNearestByCoordinates(geo.lat,geo.lng,6000);if(c){item.clusterName=c.name;return item}}
  if(!item.address||!geocoder||!clusterService)return item;
  const cached=readGeoCache(item.address);if(cached&&cached.geo){item.latitude=cached.geo.lat;item.longitude=cached.geo.lng;item.clusterName=cached.clusterName||'';return item}
  try{const timeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error('geocode timeout')),9000));const found=await Promise.race([geocoder.geocode(item.address),timeout]);if(found&&found.geo){item.latitude=found.geo.lat;item.longitude=found.geo.lng;const c=found.cluster||clusterService.findByCoordinates(found.geo.lat,found.geo.lng)||clusterService.findNearestByCoordinates(found.geo.lat,found.geo.lng,6000);item.clusterName=c?c.name:'';saveGeoCache(item.address,{geo:found.geo,clusterName:item.clusterName})}}catch(_){ }
  return item;
}
async function enrichClusters(items){
  const targets=items.filter(x=>x&&String(x.address||'').trim()&&!x.clusterName);
  if(!targets.length)return {attempted:0,completed:0,timedOut:false};
  let cursor=0,done=0,finished=false;
  const workers=Array.from({length:Math.min(3,targets.length)},async()=>{while(true){const i=cursor++;if(i>=targets.length)return;await resolveCluster(targets[i]);done++;els.loadingText.textContent=`Определяем кластеры: ${done} из ${targets.length}…`}});
  const allWorkers=Promise.all(workers).then(()=>{finished=true});
  await Promise.race([allWorkers,new Promise(resolve=>setTimeout(resolve,30000))]);
  return {attempted:targets.length,completed:done,timedOut:!finished};
}
function normalizeItem(x){
  const current=Number(x.rentMonthly??x.rent_monthly),previous=Number(x.previousRentMonthly??x.previous_rent_monthly);
  const priceChanged=Number.isFinite(current)&&Number.isFinite(previous)&&current!==previous;
  return Object.assign({clusterName:'',marketStatus:'active',firstSeenAt:null,lastSeenAt:null,previousRentMonthly:null,priceChanged:false},x,{source:x.source,listingUrl:x.listingUrl||x.listing_url,address:x.address||'',area:x.area??null,floor:x.floor??null,rentMonthly:Number.isFinite(current)?current:null,clusterName:x.clusterName||x.cluster_name||'',firstSeenAt:x.firstSeenAt||x.first_seen_at,lastSeenAt:x.lastSeenAt||x.last_seen_at,marketStatus:x.marketStatus||x.market_status||'active',previousRentMonthly:Number.isFinite(previous)?previous:null,priceChanged:Boolean(x.priceChanged??x.price_changed??priceChanged)});
}
function criteria(){return{areaMin:num(els.areaMin.value),areaMax:num(els.areaMax.value),floor:num(els.floor.value),cluster:String(els.cluster.value||''),status:String(els.status.value||''),source:String(els.source.value||'')}}
function applyFilters(){
  const c=criteria();filtered=all.filter(x=>{if(c.areaMin!=null&&(x.area==null||Number(x.area)<c.areaMin))return false;if(c.areaMax!=null&&(x.area==null||Number(x.area)>c.areaMax))return false;if(c.floor!=null&&(x.floor==null||Number(x.floor)!==c.floor))return false;if(c.cluster&&x.clusterName!==c.cluster)return false;if(c.status&&x.marketStatus!==c.status)return false;if(c.source&&x.source!==c.source)return false;if(marketFilter==='new'&&x.marketStatus!=='new')return false;if(marketFilter==='active'&&x.marketStatus!=='active')return false;if(marketFilter==='removed'&&x.marketStatus!=='removed')return false;if(marketFilter==='price_changed'&&!x.priceChanged)return false;return true});
  const s=els.sort.value;filtered.sort((a,b)=>s==='area-asc'?(a.area??Infinity)-(b.area??Infinity):s==='area-desc'?(b.area??-Infinity)-(a.area??-Infinity):s==='price-asc'?(a.rentMonthly??Infinity)-(b.rentMonthly??Infinity):s==='address'?String(a.address).localeCompare(String(b.address),'ru'):s==='new-desc'?new Date(b.firstSeenAt||0)-new Date(a.firstSeenAt||0):new Date(b.lastSeenAt||0)-new Date(a.lastSeenAt||0));render();
}
function updateKpis(){const n=all.length,nn=all.filter(x=>x.marketStatus==='new').length,na=all.filter(x=>x.marketStatus==='active').length,nr=all.filter(x=>x.marketStatus==='removed').length,np=all.filter(x=>x.priceChanged).length;els.kpiAll.textContent=n;els.kpiNew.textContent=nn;els.kpiActive.textContent=na;els.kpiRemoved.textContent=nr;els.kpiPrice.textContent=np}
function statusLabel(s){return s==='new'?'Новое':s==='removed'?'Снято':'Активно'}
function externalIcon(){return '<svg viewBox="0 0 24 24" fill="none"><path d="M14 5h5v5M19 5l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" stroke="currentColor" stroke-width="1.8"/></svg>'}
function render(){
  updateKpis();const n=filtered.length;els.count.textContent=`${n} ${decl(n,'объявление','объявления','объявлений')}`;els.empty.hidden=n>0;els.table.hidden=n===0;if(!n){els.empty.innerHTML='<div class="available-empty-icon">∅</div><strong>По заданным условиям ничего нет</strong><span>Измените фильтры или обновите рынок.</span>';return}
  els.summary.textContent=n===all.length?`В базе ${n} ${decl(n,'объявление','объявления','объявлений')}.`:`Показано ${n} из ${all.length} объявлений.`;
  els.list.innerHTML=filtered.map(x=>{const per=x.area&&x.rentMonthly?Math.round(x.rentMonthly/x.area):null;let delta='—',deltaClass='';if(x.priceChanged&&x.previousRentMonthly!=null&&x.rentMonthly!=null){const d=x.rentMonthly-x.previousRentMonthly;delta=(d>0?'+':'')+new Intl.NumberFormat('ru-RU').format(d)+' ₽';deltaClass=d<0?'down':'up'}return `<article class="available-row"><div><span class="available-status ${esc(x.marketStatus)}">${statusLabel(x.marketStatus)}</span><span class="available-source-badge">${x.source==='cian'?'ЦИАН':'Авито'}</span></div><div><div class="available-address ${x.address?'':'missing'}">${esc(x.address||'Адрес не распознан')}</div><div class="available-muted">впервые: ${dateTime(x.firstSeenAt)}</div></div><div class="available-cluster">${esc(x.clusterName||'Кластер не определён')}</div><div class="available-number">${x.area==null?'—':esc(x.area)+' м²'}</div><div>${x.floor==null?'—':esc(x.floor)}</div><div class="available-number">${money(x.rentMonthly)}</div><div class="available-number">${per==null?'—':money(per)}</div><div class="available-price-change ${deltaClass}">${delta}</div><div class="available-muted">${dateTime(x.lastSeenAt)}</div><div><a class="available-open" href="${esc(x.listingUrl)}" target="_blank" rel="noopener" title="Открыть объявление">${externalIcon()}</a></div></article>`}).join('');
}
function renderDiagnostic(meta,source){
  const box=document.querySelector(`[data-diagnostic-source="${source}"]`);if(!box)return null;
  const s=meta&&meta.sources&&meta.sources[source];box.classList.remove('ok','warn','error');
  if(!s){box.classList.add('warn');box.querySelector('span').textContent='Источник не запрашивался или не вернул ответ.';return null}
  const d=s.diagnostic||{};const links=Number(d.linksFound??s.discovered)||0,cards=Number(d.cardsRequested??links)||0,network=Number(d.networkRequested)||0,cache=Number(d.cacheHits)||0,responses=Number(d.cardsSucceeded)||0,addresses=Number(d.addressesParsed)||0,areas=Number(d.areasParsed)||0,blocked=Number(d.blocked)||0,captcha=Number(d.captcha)||0,solved=Number(d.captchaSolved)||0,timeouts=Number(d.timeouts)||0,errors=Number(d.errors)||0;
  const methods=Object.entries(d.methodUsed||{}).filter(([,v])=>Number(v)>0).map(([k,v])=>`${k}: ${v}`).join(', ');
  let chain=`${links} ссылок → ${cards} карточек`+(cache?` (${cache} из кэша)`:``)+` → ${responses} получено → ${addresses} адресов → ${areas} площадей`;
  if(network)chain+=` · сетевых запросов: ${network}`;if(blocked)chain+=` · блокировок: ${blocked}`;if(captcha)chain+=` · CAPTCHA: ${captcha}${solved?` (${solved} решено)`:''}`;if(timeouts)chain+=` · таймаутов: ${timeouts}`;if(d.proxyPlanLimited)chain+=` · residential proxy недоступен по тарифу, использован fallback`;if(methods)chain+=` · методы: ${methods}`;if(errors)chain+=` · ошибок: ${errors}`;
  const low=cards>0&&(addresses/cards<.7||areas/cards<.7);box.classList.add(low||blocked||d.proxyPlanLimited?'warn':'ok');box.querySelector('span').textContent=chain;els.diagnostics.hidden=false;return {low,chain,addresses,areas,cards};
}
function sourceMeta(meta,source){
  const s=meta&&meta.sources&&meta.sources[source];if(!s){setSource(source,'warn','нет ответа');return null}
  const q=s.quality||{},ap=Number(q.addressRate),sp=Number(q.areaRate);const detail=Number.isFinite(ap)?`адрес ${Math.round(ap*100)}% · площадь ${Math.round((Number.isFinite(sp)?sp:0)*100)}%`:'';const low=Number.isFinite(ap)&&Number.isFinite(sp)&&(ap<.7||sp<.7);
  if(s.status==='ok')setSource(source,low?'warn':'ok',`${Number(s.returned)||0} объявлений`,detail);else if(s.status==='partial')setSource(source,'warn',`${Number(s.returned)||0} объявлений · частично`,detail);else setSource(source,'warn','чтение ограничено',detail);
  const d=s.diagnostic||{};if(d.proxyPlanLimited)return `${source==='cian'?'ЦИАН':'Авито'}: residential proxy Browserless недоступен по текущему тарифу; использован резервный режим.`;return low?`${source==='cian'?'ЦИАН':'Авито'}: данные карточек распознаны частично (${detail})`:null;
}
async function runSearch(){
  if(busy)return;const c=criteria();if(c.areaMin!=null&&c.areaMax!=null&&c.areaMin>c.areaMax){toast('Минимальная площадь больше максимальной.');return}
  setBusy(true);els.diagnostics.hidden=true;['cian','avito'].forEach(s=>setSource(s,'neutral','проверяем…'));els.loadingText.textContent='Получаем предложения из ЦИАН и Авито через Supabase…';const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Number(cfg.timeoutMs)||90000);
  try{
    const endpoint=String(cfg.endpoint||'').trim();if(!endpoint)throw new Error('Не настроен endpoint search-listings.');const sources=c.source?[c.source]:['cian','avito'];
    const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Slogi-Client':'available-spaces'},body:JSON.stringify({areaMin:c.areaMin,areaMax:c.areaMax,floor:c.floor,pages:Number(cfg.pages)||2,limitPerSource:Number(cfg.limitPerSource)||25,sources,includeHistory:true,persist:true}),signal:controller.signal});
    const payload=await r.json().catch(()=>null);if(!r.ok)throw new Error(payload&&payload.error||`Supabase HTTP ${r.status}`);
    all=Array.isArray(payload&&payload.data)?payload.data.map(normalizeItem):[];
    const warnings=[];for(const source of ['cian','avito']){if(!sources.includes(source))continue;const w=sourceMeta(payload&&payload.meta,source);renderDiagnostic(payload&&payload.meta,source);if(w)warnings.push(w)}if(warnings.length)toast(warnings.join(' · '));
    const withAddress=all.filter(x=>String(x.address||'').trim());
    if(withAddress.length){els.loadingText.textContent=`Получено ${all.length}. Адресов для кластеризации: ${withAddress.length}.`;const geo=await enrichClusters(all);if(geo.timedOut)toast(`Определение кластеров остановлено по таймауту: обработано ${geo.completed} из ${geo.attempted}.`)}
    else if(all.length){els.loadingText.textContent=`Получено ${all.length}, но адреса не распознаны. Проверка кластеров пропущена.`}
    if(payload?.meta?.persistence==='ok'){const clusters=all.filter(x=>x.clusterName).map(x=>({source:x.source,listingUrl:x.listingUrl,clusterName:x.clusterName}));if(clusters.length)fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Slogi-Client':'available-spaces'},body:JSON.stringify({action:'update-clusters',clusters})}).catch(()=>{})}
    applyFilters();const stamp=new Date(payload?.meta?.fetchedAt||Date.now());els.lastUpdate.textContent=`Последняя проверка: ${stamp.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`;
    if(all.length&&!withAddress.length){els.summary.textContent=`Найдено ${all.length} ссылок, но адреса карточек не распознаны. Кластеризация пропущена; смотрите диагностику источников.`;toast('Поиск завершён: ссылки найдены, но данные карточек распознаны не полностью.')}
    if(payload?.meta?.persistence==='unavailable')toast('Поиск выполнен, но сохранение истории временно недоступно.');els.loadingText.textContent='Проверка завершена.';
  }catch(e){all=[];filtered=[];render();['cian','avito'].forEach(s=>setSource(s,'error','ошибка'));els.empty.innerHTML=`<div class="available-empty-icon">!</div><strong>Не удалось обновить рынок</strong><span>${esc(e?.name==='AbortError'?'Поиск занял больше 90 секунд и был остановлен. Откройте Logs функции search-listings.':e?.message||String(e))}</span>`;toast('Ошибка обновления рынка.')}
  finally{clearTimeout(timer);setBusy(false)}
}
function reset(){els.areaMin.value='';els.areaMax.value='';els.cluster.value='';els.floor.value='';els.status.value='';els.source.value='';marketFilter='all';document.querySelectorAll('[data-market-filter]').forEach(b=>b.classList.toggle('active',b.dataset.marketFilter==='all'));applyFilters()}
populateClusters();els.search.addEventListener('click',runSearch);els.reset.addEventListener('click',reset);els.sort.addEventListener('change',applyFilters);[els.areaMin,els.areaMax,els.floor].forEach(x=>x.addEventListener('keydown',e=>{if(e.key==='Enter')runSearch()}));[els.cluster,els.status,els.source].forEach(x=>x.addEventListener('change',applyFilters));document.querySelectorAll('[data-market-filter]').forEach(b=>b.addEventListener('click',()=>{marketFilter=b.dataset.marketFilter;document.querySelectorAll('[data-market-filter]').forEach(x=>x.classList.toggle('active',x===b));applyFilters()}));
})();
