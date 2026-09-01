(function(){
  'use strict';

  const cfg=(window.SLOGI_PHASE0_CONFIG&&window.SLOGI_PHASE0_CONFIG.listingSearch)||{};
  const supabaseCfg=(window.SLOGI_PHASE0_CONFIG&&window.SLOGI_PHASE0_CONFIG.supabase)||{};
  const feed=window.SlogiCianFeed;
  const mapData=window.SlogiCianMapData;
  if(!feed)throw new Error('cian_listing_feed_unavailable');
  if(!mapData)throw new Error('cian_map_data_unavailable');
  const MAX_FRESH_DAYS=30;
  const HIDDEN_LISTINGS_KEY='slogi_cian_hidden_listing_ids_v1';
  const ALLOWED_PREMISE_TYPES=Object.freeze(['office','retail','free_purpose']);
  const FIXED_CRITERIA=Object.freeze({areaMin:100,areaMax:150,floor:1,premiseTypes:ALLOWED_PREMISE_TYPES,excludeBasementOrSocle:true,days:MAX_FRESH_DAYS,sort:'freshness-desc'});
  const $=id=>document.getElementById(id);
  const nodes={button:$('available-search'),count:$('available-count'),updated:$('available-last-update'),source:$('cian-source-state'),badge:$('cian-source-badge'),summary:$('available-summary'),loading:$('available-loading'),list:$('available-list'),empty:$('available-empty'),map:$('cian-map'),mapLoading:$('cian-map-loading'),mapMessage:$('cian-map-message'),mapCount:$('cian-map-count'),mapMissing:$('cian-map-missing'),mapNoAddress:$('cian-map-no-address'),mapFailed:$('cian-map-failed'),mapPending:$('cian-map-pending'),clusterToggle:$('cian-clusters-toggle'),dialog:$('cian-listing-dialog'),dialogContent:$('cian-dialog-content')};
  let all=[];
  let hiddenListingIds=loadHiddenListingIds();
  let loading=false;
  let initialized=false;
  let map=null;
  let clusterer=null;
  let markerById=new Map();
  let polygonByCluster=new Map();
  let clustersVisible=true;
  let selectedListingId='';
  let lastFocused=null;
  let loadPartial=false;
  let serverTotal=null;
  let loadedPages=0;
  let listingSnapshotTime=NaN;
  let sourceHealth={status:'unknown',errorCode:''};
  let activeLoadController=null;
  let loadGeneration=0;
  let yandexLoadPromise=null;
  const geocodeCache=(()=>{try{return mapData.createAddressCache(window.localStorage);}catch(_error){return mapData.createAddressCache(null);}})();

  const esc=value=>String(value==null?'':value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const number=value=>{if(value==null||String(value).trim()==='')return null;const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;};
  const money=value=>value==null?'Нет данных':Math.round(value).toLocaleString('ru-RU')+' ₽';
  const area=value=>value==null?'Нет данных':Number(value).toLocaleString('ru-RU',{maximumFractionDigits:1})+' м²';
  const formatDate=value=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?'Нет данных':date.toLocaleDateString('ru-RU',{day:'2-digit',month:'long',year:'numeric'});};
  const freshnessId=item=>mapData.listingId(item);
  const clusterService=()=>window.SlogiPhase0&&window.SlogiPhase0.clusterService||null;
  const phase0Service=()=>window.SlogiPhase0&&window.SlogiPhase0.phase0Service||null;

  function safeCianUrl(value){
    try{const url=new URL(String(value||''));return url.protocol==='https:'&&(/(^|\.)cian\.ru$/i.test(url.hostname))?url.href:'';}catch(_err){return'';}
  }
  function loadHiddenListingIds(){
    try{const parsed=JSON.parse(window.localStorage.getItem(HIDDEN_LISTINGS_KEY)||'[]');return new Set(Array.isArray(parsed)?parsed.map(String).filter(Boolean).slice(-1000):[]);}catch(_error){return new Set();}
  }
  function persistHiddenListingIds(){
    try{window.localStorage.setItem(HIDDEN_LISTINGS_KEY,JSON.stringify([...hiddenListingIds].slice(-1000)));}catch(_error){/* local hiding is best effort */}
  }
  function displayedListings(){return all.filter(item=>!hiddenListingIds.has(freshnessId(item)));}
  function canonicalClusterState(value){
    return mapData.clusterState(value,clusterService());
  }
  function normalize(raw){
    const areaValue=number(raw.area);
    const rent=number(raw.rentMonthly??raw.rent_monthly);
    const price=number(raw.pricePerSquareMeter)??(areaValue&&rent?Math.round(rent/areaValue):null);
    const item={
      source:String(raw.source||''),listingUrl:safeCianUrl(raw.listingUrl||raw.listing_url),externalId:String(raw.externalId||raw.external_id||''),title:String(raw.title||''),address:String(raw.address||''),description:String(raw.description||''),
      latitude:number(raw.latitude),longitude:number(raw.longitude),area:areaValue,rentMonthly:rent,pricePerSquareMeter:price,floor:number(raw.floor),totalFloors:number(raw.totalFloors??raw.total_floors),ceilingHeight:number(raw.ceilingHeight??raw.ceiling_height),premiseType:feed.normalizePremiseType(raw.premiseType??raw.premise_type,raw),hasBasementOrSocle:feed.hasBasementOrSocle(raw),
      freshnessAt:String(raw.freshnessAt||raw.freshness_at||''),freshnessKind:String(raw.freshnessKind||raw.freshness_kind||''),publishedAt:String(raw.publishedAt||raw.published_at||''),sourceUpdatedAt:String(raw.sourceUpdatedAt||raw.source_updated_at||''),marketStatus:String(raw.marketStatus||raw.market_status||'active'),sourceClusterName:String(raw.clusterName||raw.cluster_name||''),clusterId:'',clusterName:'',clusterStatus:'not_computed',clusterBoundary:false,coordinateSource:'',geocodeStatus:'',geocodeAttempts:0,geocodeDiagnostic:'',parseCompleteness:number(raw.parseCompleteness??raw.parse_completeness)||0,parseWarnings:Array.isArray(raw.parseWarnings)?raw.parseWarnings.map(String):[]
    };
    Object.assign(item,canonicalClusterState(item));if(mapData.coordinates(item)){item.coordinateSource='stored';item.geocodeStatus='stored';}
    return item;
  }
  function applyFixedGate(items){return feed.filterAndSort(items,FIXED_CRITERIA,Number.isFinite(listingSnapshotTime)?listingSnapshotTime:Date.now());}

  function clusterLabel(item){
    if(item.clusterStatus==='inside')return item.clusterName||'Кластер рассчитан';
    if(item.clusterStatus==='address')return item.clusterName||'Кластер определён по адресу';
    if(item.clusterStatus==='outside')return'Вне кластеров';
    if(item.geocodeStatus==='pending')return'Кластер рассчитывается';
    return'Кластер не определён: нет координат';
  }

  function card(item){
    const id=esc(freshnessId(item));
    const title=esc(item.title||item.address||'Коммерческое помещение');
    const dateLabel=item.freshnessKind==='published'?'Опубликовано':'Обновлено';
    const existing=existingProject(item),projectId=existing&&existing.id||'';
    return`<article class="cian-listing-card ${selectedListingId===freshnessId(item)?'selected':''}" data-listing-card="${id}"><button class="cian-card-open" type="button" data-listing-id="${id}" aria-label="Открыть объявление ${title}"><div class="cian-card-main"><div class="cian-card-top"><span class="cian-badge">ЦИАН</span><span class="cian-badge cluster">${esc(clusterLabel(item))}</span><span class="cian-badge fresh">${dateLabel} ${esc(formatDate(item.freshnessAt))}</span></div><h3>${title}</h3><p class="cian-address">${esc(item.address||'Адрес не опубликован')}</p><div class="cian-card-metrics"><span>${esc(area(item.area))}</span><span>${item.floor==null?'Этаж не указан':esc('Этаж '+item.floor+(item.totalFloors?' из '+item.totalFloors:''))}</span><span>${item.ceilingHeight==null?'Высота не указана':esc('Потолки '+item.ceilingHeight+' м')}</span></div></div><div class="cian-card-price"><strong>${esc(money(item.rentMonthly))}</strong><span>${item.pricePerSquareMeter==null?'Цена за м² не указана':esc(money(item.pricePerSquareMeter)+' / м²')}</span></div></button><div class="cian-card-actions"><button class="cian-button cian-add-object" type="button" data-add-listing="${id}" ${existing?'disabled':''}>${existing?'Добавлено':'Добавить объект'}</button><button class="cian-button secondary cian-remove-listing" type="button" data-remove-listing="${id}" aria-label="Удалить ${title} из списка">Удалить из списка</button>${existing?`<a href="index.html?location=${encodeURIComponent(projectId)}">Открыть в «Моих помещениях»</a>`:''}</div></article>`;
  }
  function render(){
    const items=displayedListings(),hiddenCount=all.length-items.length;
    const sourceUnavailable=sourceHealth.status==='error'&&Boolean(sourceHealth.errorCode);
    nodes.loading.hidden=true;
    nodes.count.textContent=String(items.length);
    if(loadPartial)nodes.summary.textContent=`Показано ${items.length} подходящих предложений. Сервер сообщил ${serverTotal==null?'неизвестное число':serverTotal}; выдача неполная (${loadedPages} стр.).`;
    else if(hiddenCount)nodes.summary.textContent=`Показано ${items.length} подходящих предложений. Скрыто на этом устройстве: ${hiddenCount}.`;
    else if(sourceUnavailable)nodes.summary.textContent=`Сбор временно приостановлен. Подходящих предложений в ранее загруженных данных: ${items.length}.`;
    else nodes.summary.textContent=`Найдено ${items.length} подходящих предложений.`;
    nodes.empty.hidden=items.length!==0;
    if(items.length===0){
      nodes.empty.querySelector('h3').textContent=loadPartial?'Выдача загружена не полностью':sourceUnavailable?'Сбор временно приостановлен':'Предложения не найдены';
      nodes.empty.querySelector('p').textContent=loadPartial?'Не все страницы удалось прочитать. Повторите загрузку, чтобы не пропустить подходящие объявления.':hiddenCount?'Все подходящие предложения скрыты на этом устройстве.':sourceUnavailable?'Новые объявления сейчас не поступают. Ранее загруженные данные проверены по заданным условиям.':'По заданным условиям подходящих предложений пока нет.';
    }
    nodes.list.hidden=items.length===0;
    nodes.list.innerHTML=items.map(card).join('');
    updateMap(items);
  }
  function existingProject(item){const service=phase0Service();return service&&typeof service.findListingProject==='function'?service.findListingProject(item):null;}
  function selectListing(id,{center=true}={}){
    selectedListingId=String(id||'');nodes.list.querySelectorAll('[data-listing-card]').forEach(node=>node.classList.toggle('selected',node.dataset.listingCard===selectedListingId));
    markerById.forEach((marker,key)=>marker.options.set('preset',key===selectedListingId?'islands#orangeDotIcon':'islands#darkGreenDotIcon'));
    const item=all.find(entry=>freshnessId(entry)===selectedListingId);if(center&&map&&item&&Number.isFinite(item.latitude)&&Number.isFinite(item.longitude))map.panTo([item.latitude,item.longitude],{flying:false,duration:180}).catch(()=>{});
  }
  async function addListing(id,button){
    const item=all.find(entry=>freshnessId(entry)===id),service=phase0Service();if(!item||!service||typeof service.addMarketListing!=='function'){toast('Добавление объекта временно недоступно.',true);return;}
    const prior=existingProject(item);if(prior){location.href='index.html?location='+encodeURIComponent(prior.id);return;}
    button.disabled=true;button.textContent='Добавляем…';
    try{
      const result=await service.addMarketListing(item);
      if(window.SlogiCloud&&window.SlogiCloud.ready&&typeof window.SlogiCloud.sync==='function')await window.SlogiCloud.sync();
      toast(result.created?'Объект добавлен в «Мои помещения».':'Объект уже находится в «Моих помещениях».');render();
    }catch(_error){button.disabled=false;button.textContent='Добавить объект';toast('Не удалось добавить объект. Повторите попытку.',true);}
  }
  function toast(message,isError=false){
    const node=$('available-toast');node.textContent=message;node.dataset.error=isError?'true':'false';node.classList.add('show');clearTimeout(node._timer);node._timer=setTimeout(()=>node.classList.remove('show'),3200);
  }
  function hideListing(id){
    const stableId=String(id||'');if(!stableId||!all.some(item=>freshnessId(item)===stableId))return;
    hiddenListingIds.add(stableId);persistHiddenListingIds();if(selectedListingId===stableId)selectedListingId='';
    if(nodes.dialog.open)nodes.dialog.close();render();toast('Предложение удалено из списка на этом устройстве.');
  }
  function openListing(id,trigger){
    const item=all.find(entry=>freshnessId(entry)===id);if(!item)return;
    lastFocused=trigger||document.activeElement;
    const existing=existingProject(item),already=Boolean(existing);
    const url=safeCianUrl(item.listingUrl);
    nodes.dialogContent.innerHTML=`<div class="cian-dialog-body"><div class="cian-dialog-head"><div><p class="cian-eyebrow">ЦИАН · ${esc(item.externalId||'объявление')}</p><h2 id="cian-dialog-title">${esc(item.title||'Коммерческое помещение')}</h2></div><button class="cian-dialog-close" type="button" aria-label="Закрыть">×</button></div><p class="cian-dialog-address">${esc(item.address||'Адрес не опубликован')}</p><div class="cian-dialog-grid"><div><span>Кластер</span><strong>${esc(clusterLabel(item))}</strong></div><div><span>Площадь</span><strong>${esc(area(item.area))}</strong></div><div><span>Аренда в месяц</span><strong>${esc(money(item.rentMonthly))}</strong></div><div><span>Цена за м²</span><strong>${esc(item.pricePerSquareMeter==null?'Нет данных':money(item.pricePerSquareMeter))}</strong></div><div><span>${item.freshnessKind==='published'?'Опубликовано':'Обновлено'}</span><strong>${esc(formatDate(item.freshnessAt))}</strong></div></div>${item.description?`<p class="cian-dialog-description">${esc(item.description)}</p>`:''}<div class="cian-dialog-actions"><button class="cian-button" type="button" data-add-dialog ${already?'disabled':''}>${already?'Добавлено':'Добавить объект'}</button><button class="cian-button secondary cian-remove-listing" type="button" data-remove-dialog>Удалить из списка</button>${already?`<a class="cian-dialog-link" href="index.html?location=${encodeURIComponent(existing.id)}">Открыть в «Моих помещениях»</a>`:''}${url?`<a class="cian-dialog-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Открыть на ЦИАН</a>`:''}</div></div>`;
    nodes.dialogContent.querySelector('.cian-dialog-close').addEventListener('click',()=>nodes.dialog.close());
    const add=nodes.dialogContent.querySelector('[data-add-dialog]');if(add&&!already)add.addEventListener('click',async()=>{await addListing(id,add);if(nodes.dialog.open)nodes.dialog.close();});
    nodes.dialogContent.querySelector('[data-remove-dialog]').addEventListener('click',()=>hideListing(id));
    nodes.dialog.showModal();
    nodes.dialogContent.querySelector('.cian-dialog-close').focus();
  }

  function trapDialogFocus(event){
    if(event.key==='Escape'&&nodes.dialog.open){event.preventDefault();nodes.dialog.close();return;}
    if(event.key!=='Tab'||!nodes.dialog.open)return;
    const focusable=Array.from(nodes.dialog.querySelectorAll('button:not([disabled]),a[href]'));
    if(!focusable.length)return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }

  function setSource(meta){
    const source=meta&&meta.sources&&meta.sources.cian||{};
    const last=source.lastSucceededAt||source.lastHydrationAt||source.lastDiscoveryAt;
    const creditsExhausted=String(source.errorCode||'')==='browserless_credits_exhausted';
    const status=creditsExhausted?'cooldown':source.errorCode?'error':String(source.status||'unknown');
    sourceHealth={status,errorCode:String(source.errorCode||'')};
    const labels={ok:'Источник обновлён',cooldown:creditsExhausted?'Лимит сервиса сбора исчерпан':'Источник временно приостановлен',error:'Обновление завершилось с ошибкой',never_scanned:'Плановое обновление ещё не выполнялось'};
    nodes.source.textContent=labels[status]||'Состояние источника неизвестно';
    nodes.badge.textContent=status==='ok'?'Работает':status==='error'?'Ошибка':creditsExhausted?'Пауза':'Ожидание';
    nodes.badge.dataset.state=status;
    nodes.updated.textContent=last?formatDate(last):'Нет данных';
  }

  async function fetchListingPage(endpoint,token,request,signal){
    const controller=new AbortController();let timedOut=false;
    const timeout=setTimeout(()=>{timedOut=true;controller.abort();},Math.max(1000,Number(cfg.timeoutMs)||30000));
    const abort=()=>controller.abort();signal&&signal.addEventListener('abort',abort,{once:true});
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'X-Slogi-Client':'cian-workspace'},body:JSON.stringify(request),signal:controller.signal});
      const payload=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(payload&&payload.error||'listing_search_failed');
      return{items:(Array.isArray(payload&&payload.items)?payload.items:[]).map(normalize),meta:payload&&payload.meta};
    }catch(error){if(timedOut){const timeoutError=new Error('listing_page_timeout');timeoutError.code='listing_page_timeout';throw timeoutError;}throw error;}
    finally{clearTimeout(timeout);signal&&signal.removeEventListener('abort',abort);}
  }

  async function loadListings(){
    const generation=++loadGeneration;
    if(activeLoadController)activeLoadController.abort();
    const controller=new AbortController();activeLoadController=controller;
    loading=true;nodes.button.disabled=true;nodes.loading.hidden=false;nodes.empty.hidden=true;nodes.summary.textContent='Загружаем предложения…';
    try{
      const endpoint=String(cfg.endpoint||'');if(!endpoint)throw new Error('listing_search_unavailable');
      const token=await window.SlogiCloud.getAccessToken();
      const pageSize=Math.max(1,Math.min(100,Math.trunc(Number(cfg.limit)||100)));
      const loaded=await feed.loadAllPages(async({page,limit,snapshotAt,cursor})=>{
        const request={sources:['cian'],page,limit,areaMin:FIXED_CRITERIA.areaMin,areaMax:FIXED_CRITERIA.areaMax,floor:FIXED_CRITERIA.floor,premiseTypes:[...FIXED_CRITERIA.premiseTypes]};if(snapshotAt)request.snapshotAt=snapshotAt;if(cursor)request.cursor=cursor;
        return fetchListingPage(endpoint,token,request,controller.signal);
      },{limit:pageSize,signal:controller.signal});
      if(generation!==loadGeneration||controller.signal.aborted)return;
      listingSnapshotTime=new Date(loaded.snapshotAt||'').getTime();if(!Number.isFinite(listingSnapshotTime))throw new Error('listing_snapshot_invalid');
      all=applyFixedGate(loaded.items);loadPartial=loaded.partial;serverTotal=loaded.serverTotal;loadedPages=loaded.pages;
      setSource(loaded.meta);
      if(loadPartial){nodes.badge.textContent='Частично';nodes.badge.dataset.state='partial';}
      render();
      const geocodingCfg=window.SLOGI_PHASE0_CONFIG&&window.SLOGI_PHASE0_CONFIG.geocoding||{};
      let serverGeocode=null;try{serverGeocode=mapData.createServerGeocoder({endpoint:geocodingCfg.endpoint,projectUrl:supabaseCfg.url,token,timeoutMs:Number(geocodingCfg.timeoutMs)||12000,maxAttempts:3});}catch(_error){serverGeocode=null;}
      const browserGeocode=createBrowserGeocoder();
      const geocode=createFallbackGeocoder(serverGeocode,browserGeocode);
      await mapData.geocodeMissingListings(all,{geocode,clusterService:clusterService(),cache:geocodeCache,signal:controller.signal,concurrency:2,onProgress:progress=>{
        if(generation!==loadGeneration||controller.signal.aborted)return;
        if(progress.completed===progress.total||progress.completed%5===0)render();
        else updateMapStats(mapData.projection(displayedListings()));
      }});
      if(generation!==loadGeneration||controller.signal.aborted)return;
      render();
    }catch(error){
      if(error&&error.name==='AbortError')return;
      if(generation!==loadGeneration)return;
      all=[];loadPartial=false;serverTotal=null;loadedPages=0;listingSnapshotTime=NaN;sourceHealth={status:'error',errorCode:String(error&&error.message||'listing_search_failed')};render();
      nodes.summary.textContent='Предложения временно недоступны.';
      nodes.source.textContent=error&&error.name==='AbortError'?'Чтение заняло слишком много времени.':'Не удалось загрузить предложения.';
      nodes.badge.textContent='Недоступно';nodes.badge.dataset.state='error';
      nodes.empty.hidden=false;nodes.empty.querySelector('h3').textContent='Не удалось загрузить предложения';nodes.empty.querySelector('p').textContent='Повторите чтение позже. Внешний сбор объявлений с этой страницы не запускается.';
    }finally{if(generation===loadGeneration){activeLoadController=null;loading=false;nodes.button.disabled=false;nodes.loading.hidden=true;}}
  }

  function loadYandex(){
    if(window.ymaps)return new Promise(resolve=>window.ymaps.ready(resolve));
    if(yandexLoadPromise)return yandexLoadPromise;
    yandexLoadPromise=new Promise((resolve,reject)=>{
      const key=String(window.SLOGI_CONFIG&&window.SLOGI_CONFIG.yandexMapsApiKey||'');
      const script=document.createElement('script');
      script.dataset.slogiYandexMaps='true';
      script.src='https://api-maps.yandex.ru/2.1/?lang=ru_RU'+(key?'&apikey='+encodeURIComponent(key):'');
      let settled=false;const finish=callback=>{if(settled)return;settled=true;clearTimeout(timer);script.onload=null;script.onerror=null;callback();};
      script.async=true;script.onload=()=>finish(()=>window.ymaps.ready(resolve));script.onerror=()=>finish(()=>reject(new Error('map_api_unavailable')));
      document.head.appendChild(script);
      const timer=setTimeout(()=>finish(()=>reject(new Error('map_api_timeout'))),15000);
    });
    yandexLoadPromise.catch(()=>{yandexLoadPromise=null;});
    return yandexLoadPromise;
  }
  function abortError(){const error=new Error('aborted');error.name='AbortError';return error;}
  function createBrowserGeocoder(){
    return async function geocode(address,{signal}={}){
      if(signal&&signal.aborted)throw abortError();
      try{
        await loadYandex();
        if(signal&&signal.aborted)throw abortError();
        if(!window.ymaps||typeof window.ymaps.geocode!=='function')return{status:'failed',attempts:1,diagnostic:'map_geocoder_unavailable'};
        const response=await window.ymaps.geocode(String(address||''),{results:1,kind:'house'});
        if(signal&&signal.aborted)throw abortError();
        const object=response&&response.geoObjects&&response.geoObjects.get(0);
        const coords=object&&object.geometry&&object.geometry.getCoordinates();
        if(!Array.isArray(coords)||!Number.isFinite(Number(coords[0]))||!Number.isFinite(Number(coords[1])))return{status:'not_found',attempts:1,diagnostic:'map_geocoder_no_results'};
        const metadata=object.properties&&object.properties.get('metaDataProperty.GeocoderMetaData');
        return{status:'geocoded',attempts:1,latitude:Number(coords[0]),longitude:Number(coords[1]),precision:String(metadata&&metadata.precision||''),resolvedAddress:String(object.properties&&object.properties.get('text')||address),cacheHit:false,diagnostic:'yandex_maps_fallback'};
      }catch(error){
        if(error&&error.name==='AbortError')throw error;
        return{status:'failed',attempts:1,diagnostic:'map_geocoder_failed'};
      }
    };
  }
  function createFallbackGeocoder(primary,fallback){
    return async function geocode(address,options={}){
      const first=typeof primary==='function'?await primary(address,options):{status:'failed',attempts:0,diagnostic:'server_geocoder_unavailable'};
      if(first&&first.status==='geocoded')return first;
      const second=typeof fallback==='function'?await fallback(address,options):null;
      return second&&second.status==='geocoded'?second:first;
    };
  }
  function featureCoords(feature){const geometry=feature&&feature.geometry||{},convert=ring=>ring.map(point=>[point[1],point[0]]);if(geometry.type==='Polygon')return geometry.coordinates.map(convert);if(geometry.type==='MultiPolygon')return geometry.coordinates.map(poly=>poly.map(convert));return null;}
  function polygonStyle(_id,{hover=false}={}){return{fillColor:'#4F8580',strokeColor:'#285B58',strokeWidth:hover?2.4:1.5,fillOpacity:!clustersVisible?0:(hover?0.25:0.14),visible:clustersVisible};}
  function stylePolygons(){polygonByCluster.forEach((polygons,id)=>polygons.forEach(polygon=>polygon.options.set(polygonStyle(id))));}
  function addClusterPolygons(){
    polygonByCluster=new Map();nodes.map.dataset.clusterPolygons='0';const service=clusterService();if(!service)return;
    service.list().forEach(cluster=>{const coords=featureCoords(cluster.feature);if(!coords)return;const list=[];const add=geometry=>{const polygon=new window.ymaps.Polygon(geometry,{hintContent:cluster.name,clusterId:cluster.id},polygonStyle(cluster.id));polygon.events.add('mouseenter',()=>polygon.options.set(polygonStyle(cluster.id,{hover:true})));polygon.events.add('mouseleave',()=>polygon.options.set(polygonStyle(cluster.id)));map.geoObjects.add(polygon);list.push(polygon)};if(cluster.feature.geometry.type==='Polygon')add(coords);else coords.forEach(add);if(list.length)polygonByCluster.set(cluster.id,list);});
    nodes.map.dataset.clusterPolygons=String([...polygonByCluster.values()].reduce((sum,items)=>sum+items.length,0));
  }
  async function initMap(){
    try{
      await loadYandex();
      map=new window.ymaps.Map(nodes.map,{center:[55.7558,37.6176],zoom:10,controls:['zoomControl','fullscreenControl']},{suppressMapOpenBlock:true});
      map.behaviors.disable('scrollZoom');
      if(window.matchMedia('(max-width: 800px)').matches)map.behaviors.disable('drag');
      clusterer=new window.ymaps.Clusterer({preset:'islands#darkGreenClusterIcons',groupByCoordinates:false,clusterDisableClickZoom:false,clusterOpenBalloonOnClick:true});
      map.geoObjects.add(clusterer);
      addClusterPolygons();
      nodes.mapLoading.hidden=true;
      nodes.mapMessage.textContent='Канонические зоны СЛОГИ показаны поверх карты. Маркеры объявлений объединяются автоматически.';
      updateMap();
    }catch(_error){nodes.mapLoading.textContent='Карта временно недоступна';nodes.mapMessage.textContent='Список предложений продолжает работать.';}
  }
  function updateMapStats(state=mapData.projection(displayedListings())){
    const total=state.listings.length;
    nodes.mapCount.textContent=`${state.markerCount} из ${total} на карте`;
    nodes.mapMissing.textContent=`Без координат: ${state.withoutCoordinatesCount}`;
    nodes.mapNoAddress.textContent=`Без адреса: ${state.missingAddressCount}`;
    nodes.mapFailed.textContent=`Не прошли геокодирование: ${state.geocodeFailedCount}`;
    nodes.mapPending.textContent=`Ожидают геокодирования: ${state.geocodePendingCount}`;
    if(state.withoutCoordinatesCount)nodes.mapMessage.textContent=`На карте ${state.markerCount} объектов. Ещё ${state.withoutCoordinatesCount} без координат остаются в списке.`;
    else nodes.mapMessage.textContent='Все подходящие объекты с координатами показаны; близкие маркеры объединяются визуально.';
  }
  function updateMap(items=displayedListings()){
    const state=mapData.projection(items);updateMapStats(state);
    if(!map||!clusterer)return;
    markerById.forEach(marker=>marker&&marker.events&&typeof marker.events.removeAll==='function'&&marker.events.removeAll());
    clusterer.removeAll();markerById=new Map();
    const points=state.markers;
    const markers=points.map(item=>{
      const marker=new window.ymaps.Placemark([item.latitude,item.longitude],{hintContent:item.address||item.title||'Объявление ЦИАН',balloonContent:`<div class="cian-balloon"><strong>${esc(item.title||item.address||'Помещение')}</strong><span>${esc(item.address||'Адрес не указан')}</span><span>${esc(clusterLabel(item))}</span><span>${esc(area(item.area))} · ${esc(money(item.rentMonthly))}</span></div>`},{preset:selectedListingId===freshnessId(item)?'islands#orangeDotIcon':'islands#darkGreenDotIcon'});
      marker.events.add('click',()=>{const button=nodes.list.querySelector(`[data-listing-id="${CSS.escape(freshnessId(item))}"]`);selectListing(freshnessId(item),{center:false});button?.scrollIntoView({behavior:'smooth',block:'center'});});
      markerById.set(freshnessId(item),marker);return marker;
    });
    clusterer.add(markers);
    const bounds=markers.length&&clusterer.getBounds();if(bounds)map.setBounds(bounds,{checkZoomRange:true,zoomMargin:50}).catch(()=>{});stylePolygons();
  }

  function bind(){
    nodes.button.addEventListener('click',loadListings);
    nodes.list.addEventListener('click',event=>{
      const remove=event.target.closest('[data-remove-listing]');if(remove){hideListing(remove.dataset.removeListing);return;}
      const add=event.target.closest('[data-add-listing]');if(add){addListing(add.dataset.addListing,add);return;}
      const button=event.target.closest('[data-listing-id]');if(button){selectListing(button.dataset.listingId);openListing(button.dataset.listingId,button);}
    });
    nodes.list.addEventListener('mouseover',event=>{const cardNode=event.target.closest('[data-listing-card]');if(cardNode&&!cardNode.contains(event.relatedTarget))selectListing(cardNode.dataset.listingCard,{center:false});});
    nodes.list.addEventListener('focusin',event=>{const cardNode=event.target.closest('[data-listing-card]');if(cardNode)selectListing(cardNode.dataset.listingCard,{center:false});});
    nodes.clusterToggle.addEventListener('click',()=>{clustersVisible=!clustersVisible;nodes.clusterToggle.setAttribute('aria-pressed',String(clustersVisible));nodes.clusterToggle.textContent=clustersVisible?'Скрыть кластеры':'Показать кластеры';stylePolygons();});
    nodes.dialog.addEventListener('keydown',trapDialogFocus);
    nodes.dialog.addEventListener('close',()=>{if(lastFocused&&document.contains(lastFocused))lastFocused.focus();lastFocused=null;});
    window.addEventListener('storage',event=>{if(event.key===HIDDEN_LISTINGS_KEY){hiddenListingIds=loadHiddenListingIds();render();}});
    window.addEventListener('pagehide',()=>{activeLoadController&&activeLoadController.abort();markerById.forEach(marker=>marker&&marker.events&&typeof marker.events.removeAll==='function'&&marker.events.removeAll());},{once:true});
  }
  function init(){if(initialized)return;initialized=true;bind();initMap();loadListings();window.addEventListener('slogi:locations-updated',render);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
