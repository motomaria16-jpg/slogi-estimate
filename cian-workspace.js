(function(){
  'use strict';

  const cfg=(window.SLOGI_PHASE0_CONFIG&&window.SLOGI_PHASE0_CONFIG.listingSearch)||{};
  const DAY=24*60*60*1000;
  const MAX_FRESH_DAYS=30;
  const $=id=>document.getElementById(id);
  const fields={address:$('available-address'),areaMin:$('available-area-min'),areaMax:$('available-area-max'),rentMin:$('available-rent-min'),rentMax:$('available-rent-max'),sqmMin:$('available-sqm-min'),sqmMax:$('available-sqm-max'),days:$('available-date'),sort:$('available-sort')};
  const nodes={button:$('available-search'),reset:$('available-reset'),count:$('available-count'),updated:$('available-last-update'),source:$('cian-source-state'),badge:$('cian-source-badge'),summary:$('available-summary'),loading:$('available-loading'),list:$('available-list'),empty:$('available-empty'),map:$('cian-map'),mapLoading:$('cian-map-loading'),mapMessage:$('cian-map-message'),mapCount:$('cian-map-count'),dialog:$('cian-listing-dialog'),dialogContent:$('cian-dialog-content')};
  let all=[];
  let visible=[];
  let loading=false;
  let initialized=false;
  let map=null;
  let clusterer=null;
  let markerById=new Map();
  let lastFocused=null;

  const esc=value=>String(value==null?'':value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const number=value=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;};
  const inputNumber=input=>{const raw=String(input&&input.value||'').trim();return raw===''?null:number(raw);};
  const money=value=>value==null?'Нет данных':Math.round(value).toLocaleString('ru-RU')+' ₽';
  const area=value=>value==null?'Нет данных':Number(value).toLocaleString('ru-RU',{maximumFractionDigits:1})+' м²';
  const formatDate=value=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?'Нет данных':date.toLocaleDateString('ru-RU',{day:'2-digit',month:'long',year:'numeric'});};
  const freshnessId=item=>String(item.externalId||item.listingUrl||'');

  function safeCianUrl(value){
    try{const url=new URL(String(value||''));return url.protocol==='https:'&&(/(^|\.)cian\.ru$/i.test(url.hostname))?url.href:'';}catch(_err){return'';}
  }
  function freshnessTime(item){
    if(item.freshnessKind!=='published'&&item.freshnessKind!=='updated')return null;
    const time=new Date(item.freshnessAt||'').getTime();
    return Number.isFinite(time)?time:null;
  }
  function isRecent(item,days=MAX_FRESH_DAYS,now=Date.now()){
    if(item.marketStatus==='removed'||item.source!=='cian'||!safeCianUrl(item.listingUrl))return false;
    const time=freshnessTime(item);
    if(time==null)return false;
    const age=now-time;
    return age>=0&&age<=Number(days)*DAY;
  }
  function normalize(raw){
    const areaValue=number(raw.area);
    const rent=number(raw.rentMonthly??raw.rent_monthly);
    const price=number(raw.pricePerSquareMeter)??(areaValue&&rent?Math.round(rent/areaValue):null);
    return{
      source:String(raw.source||''),listingUrl:safeCianUrl(raw.listingUrl||raw.listing_url),externalId:String(raw.externalId||raw.external_id||''),title:String(raw.title||''),address:String(raw.address||''),description:String(raw.description||''),
      latitude:number(raw.latitude),longitude:number(raw.longitude),area:areaValue,rentMonthly:rent,pricePerSquareMeter:price,floor:number(raw.floor),totalFloors:number(raw.totalFloors??raw.total_floors),ceilingHeight:number(raw.ceilingHeight??raw.ceiling_height),
      freshnessAt:String(raw.freshnessAt||raw.freshness_at||''),freshnessKind:String(raw.freshnessKind||raw.freshness_kind||''),publishedAt:String(raw.publishedAt||raw.published_at||''),sourceUpdatedAt:String(raw.sourceUpdatedAt||raw.source_updated_at||''),marketStatus:String(raw.marketStatus||raw.market_status||'active'),clusterName:String(raw.clusterName||raw.cluster_name||''),parseCompleteness:number(raw.parseCompleteness??raw.parse_completeness)||0,parseWarnings:Array.isArray(raw.parseWarnings)?raw.parseWarnings.map(String):[]
    };
  }
  function criteria(){return{query:String(fields.address.value||'').trim().toLocaleLowerCase('ru'),areaMin:inputNumber(fields.areaMin),areaMax:inputNumber(fields.areaMax),rentMin:inputNumber(fields.rentMin),rentMax:inputNumber(fields.rentMax),sqmMin:inputNumber(fields.sqmMin),sqmMax:inputNumber(fields.sqmMax),days:Number(fields.days.value)||MAX_FRESH_DAYS,sort:String(fields.sort.value||'freshness-desc')};}
  function within(value,min,max){if(min!=null&&(value==null||value<min))return false;if(max!=null&&(value==null||value>max))return false;return true;}

  function applyFilters(){
    const c=criteria();
    visible=all.filter(item=>{
      if(!isRecent(item,c.days))return false;
      const haystack=(item.address+' '+item.clusterName+' '+item.title).toLocaleLowerCase('ru');
      return(!c.query||haystack.includes(c.query))&&within(item.area,c.areaMin,c.areaMax)&&within(item.rentMonthly,c.rentMin,c.rentMax)&&within(item.pricePerSquareMeter,c.sqmMin,c.sqmMax);
    });
    visible.sort((left,right)=>c.sort==='rent-asc'?(left.rentMonthly??Infinity)-(right.rentMonthly??Infinity):c.sort==='area-asc'?(left.area??Infinity)-(right.area??Infinity):c.sort==='sqm-asc'?(left.pricePerSquareMeter??Infinity)-(right.pricePerSquareMeter??Infinity):freshnessTime(right)-freshnessTime(left));
    render();
  }

  function card(item){
    const id=esc(freshnessId(item));
    const title=esc(item.title||item.address||'Коммерческое помещение');
    const dateLabel=item.freshnessKind==='published'?'Опубликовано':'Обновлено';
    return`<button class="cian-listing-card" type="button" data-listing-id="${id}" aria-label="Открыть объявление ${title}"><div class="cian-card-main"><div class="cian-card-top"><span class="cian-badge">ЦИАН</span><span class="cian-badge fresh">${dateLabel} ${esc(formatDate(item.freshnessAt))}</span></div><h3>${title}</h3><p class="cian-address">${esc(item.address||'Адрес не опубликован')}</p><div class="cian-card-metrics"><span>${esc(area(item.area))}</span><span>${item.floor==null?'Этаж не указан':esc('Этаж '+item.floor+(item.totalFloors?' из '+item.totalFloors:''))}</span><span>${item.ceilingHeight==null?'Высота не указана':esc('Потолки '+item.ceilingHeight+' м')}</span></div></div><div class="cian-card-price"><strong>${esc(money(item.rentMonthly))}</strong><span>${item.pricePerSquareMeter==null?'Цена за м² не указана':esc(money(item.pricePerSquareMeter)+' / м²')}</span></div></button>`;
  }
  function render(){
    nodes.loading.hidden=true;
    nodes.count.textContent=String(visible.length);
    nodes.summary.textContent=visible.length===all.length?`Показано ${visible.length} актуальных предложений.`:`Показано ${visible.length} из ${all.length} актуальных предложений.`;
    nodes.empty.hidden=visible.length!==0;
    nodes.list.hidden=visible.length===0;
    nodes.list.innerHTML=visible.map(card).join('');
    nodes.list.querySelectorAll('[data-listing-id]').forEach(button=>button.addEventListener('click',()=>openListing(button.dataset.listingId,button)));
    updateMap();
  }

  function savedListings(){const state=window.SlogiPro&&window.SlogiPro.read?window.SlogiPro.read():{};return Array.isArray(state.savedListings)?state.savedListings:[];}
  function saveListing(item){
    if(!window.SlogiPro||!window.SlogiPro.read||!window.SlogiPro.write)return;
    const state=window.SlogiPro.read();
    if(!Array.isArray(state.savedListings))state.savedListings=[];
    const id=freshnessId(item);
    const stored={id,source:'cian',listingUrl:item.listingUrl,externalId:item.externalId,title:item.title,address:item.address,area:item.area,rentMonthly:item.rentMonthly,pricePerSquareMeter:item.pricePerSquareMeter,freshnessAt:item.freshnessAt,savedAt:new Date().toISOString()};
    const index=state.savedListings.findIndex(entry=>entry.id===id);
    if(index>=0)state.savedListings[index]=stored;else state.savedListings.unshift(stored);
    window.SlogiPro.write(state,'cian-listing-saved');
    const button=nodes.dialogContent.querySelector('[data-save-listing]');if(button){button.textContent='Сохранено';button.disabled=true;}
  }
  function openListing(id,trigger){
    const item=all.find(entry=>freshnessId(entry)===id);if(!item)return;
    lastFocused=trigger||document.activeElement;
    const already=savedListings().some(entry=>entry.id===id);
    const url=safeCianUrl(item.listingUrl);
    nodes.dialogContent.innerHTML=`<div class="cian-dialog-body"><div class="cian-dialog-head"><div><p class="cian-eyebrow">ЦИАН · ${esc(item.externalId||'объявление')}</p><h2 id="cian-dialog-title">${esc(item.title||'Коммерческое помещение')}</h2></div><button class="cian-dialog-close" type="button" aria-label="Закрыть">×</button></div><p class="cian-dialog-address">${esc(item.address||'Адрес не опубликован')}</p><div class="cian-dialog-grid"><div><span>Площадь</span><strong>${esc(area(item.area))}</strong></div><div><span>Аренда в месяц</span><strong>${esc(money(item.rentMonthly))}</strong></div><div><span>Цена за м²</span><strong>${esc(item.pricePerSquareMeter==null?'Нет данных':money(item.pricePerSquareMeter))}</strong></div><div><span>${item.freshnessKind==='published'?'Опубликовано':'Обновлено'}</span><strong>${esc(formatDate(item.freshnessAt))}</strong></div></div>${item.description?`<p class="cian-dialog-description">${esc(item.description)}</p>`:''}<div class="cian-dialog-actions"><button class="cian-button" type="button" data-save-listing ${already?'disabled':''}>${already?'Сохранено':'Сохранить в работу'}</button>${url?`<a class="cian-dialog-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Открыть на ЦИАН</a>`:''}</div></div>`;
    nodes.dialogContent.querySelector('.cian-dialog-close').addEventListener('click',()=>nodes.dialog.close());
    const save=nodes.dialogContent.querySelector('[data-save-listing]');if(save&&!already)save.addEventListener('click',()=>saveListing(item));
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
    const labels={ok:'Источник обновлён',cooldown:'Источник временно приостановлен',error:'Обновление завершилось с ошибкой',never_scanned:'Плановое обновление ещё не выполнялось'};
    nodes.source.textContent=labels[source.status]||'Состояние источника неизвестно';
    nodes.badge.textContent=source.status==='ok'?'Работает':source.status==='error'?'Ошибка':'Ожидание';
    nodes.badge.dataset.state=String(source.status||'unknown');
    nodes.updated.textContent=last?formatDate(last):'Нет данных';
  }

  async function loadListings(){
    if(loading)return;
    loading=true;nodes.button.disabled=true;nodes.loading.hidden=false;nodes.empty.hidden=true;nodes.summary.textContent='Читаем сохранённые предложения…';
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Number(cfg.timeoutMs)||30000);
    try{
      const endpoint=String(cfg.endpoint||'');if(!endpoint)throw new Error('listing_search_unavailable');
      const token=await window.SlogiCloud.getAccessToken();
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'X-Slogi-Client':'cian-workspace'},body:JSON.stringify({sources:['cian'],limit:100}),signal:controller.signal});
      const payload=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(payload&&payload.error||'listing_search_failed');
      all=(Array.isArray(payload&&payload.items)?payload.items:[]).map(normalize).filter(item=>isRecent(item,MAX_FRESH_DAYS));
      setSource(payload&&payload.meta);
      applyFilters();
    }catch(error){
      all=[];visible=[];render();
      nodes.summary.textContent='Сохранённые предложения временно недоступны.';
      nodes.source.textContent=error&&error.name==='AbortError'?'Чтение заняло слишком много времени.':'Не удалось прочитать сохранённую базу.';
      nodes.badge.textContent='Недоступно';nodes.badge.dataset.state='error';
      nodes.empty.hidden=false;nodes.empty.querySelector('h3').textContent='Не удалось загрузить предложения';nodes.empty.querySelector('p').textContent='Повторите чтение позже. Внешний сбор объявлений с этой страницы не запускается.';
    }finally{clearTimeout(timer);loading=false;nodes.button.disabled=false;nodes.loading.hidden=true;}
  }

  function loadYandex(){
    return new Promise((resolve,reject)=>{
      if(window.ymaps)return window.ymaps.ready(resolve);
      const key=String(window.SLOGI_CONFIG&&window.SLOGI_CONFIG.yandexMapsApiKey||'');
      const script=document.createElement('script');
      script.src='https://api-maps.yandex.ru/2.1/?lang=ru_RU'+(key?'&apikey='+encodeURIComponent(key):'');
      script.async=true;script.onload=()=>window.ymaps.ready(resolve);script.onerror=()=>reject(new Error('map_api_unavailable'));
      document.head.appendChild(script);
      setTimeout(()=>reject(new Error('map_api_timeout')),15000);
    });
  }
  async function initMap(){
    try{
      await loadYandex();
      map=new window.ymaps.Map(nodes.map,{center:[55.7558,37.6176],zoom:10,controls:['zoomControl','fullscreenControl']},{suppressMapOpenBlock:true});
      map.behaviors.disable('scrollZoom');
      clusterer=new window.ymaps.Clusterer({preset:'islands#darkGreenClusterIcons',groupByCoordinates:false,clusterDisableClickZoom:false,clusterOpenBalloonOnClick:true});
      map.geoObjects.add(clusterer);
      nodes.mapLoading.hidden=true;
      nodes.mapMessage.textContent='Маркеры объединяются в кластеры. Масштабируйте карту кнопками управления.';
      updateMap();
    }catch(_error){nodes.mapLoading.textContent='Карта временно недоступна';nodes.mapMessage.textContent='Список предложений продолжает работать.';}
  }
  function updateMap(){
    if(!map||!clusterer)return;
    clusterer.removeAll();markerById=new Map();
    const points=visible.filter(item=>Number.isFinite(item.latitude)&&Number.isFinite(item.longitude));
    const markers=points.map(item=>{
      const marker=new window.ymaps.Placemark([item.latitude,item.longitude],{hintContent:item.address||item.title||'Объявление ЦИАН',balloonContent:`<div class="cian-balloon"><strong>${esc(item.title||item.address||'Помещение')}</strong><span>${esc(item.address||'Адрес не указан')}</span><span>${esc(area(item.area))} · ${esc(money(item.rentMonthly))}</span></div>`},{preset:'islands#darkGreenDotIcon'});
      marker.events.add('click',()=>{const button=nodes.list.querySelector(`[data-listing-id="${CSS.escape(freshnessId(item))}"]`);openListing(freshnessId(item),button);});
      markerById.set(freshnessId(item),marker);return marker;
    });
    clusterer.add(markers);nodes.mapCount.textContent=`${markers.length} ${markers.length===1?'точка':markers.length>1&&markers.length<5?'точки':'точек'}`;
    if(markers.length)map.setBounds(clusterer.getBounds(),{checkZoomRange:true,zoomMargin:50}).catch(()=>{});
  }

  function resetFilters(){Object.values(fields).forEach(field=>{if(field.tagName==='SELECT')field.selectedIndex=0;else field.value='';});applyFilters();}
  function bind(){
    nodes.button.addEventListener('click',loadListings);nodes.reset.addEventListener('click',resetFilters);
    Object.values(fields).forEach(field=>field.addEventListener(field.tagName==='INPUT'?'input':'change',applyFilters));
    nodes.dialog.addEventListener('keydown',trapDialogFocus);
    nodes.dialog.addEventListener('close',()=>{if(lastFocused&&document.contains(lastFocused))lastFocused.focus();lastFocused=null;});
  }
  function init(){if(initialized)return;initialized=true;bind();initMap();loadListings();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
