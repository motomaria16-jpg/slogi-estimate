(function(){
  'use strict';
  const DEFAULT_CENTER=[55.71985,37.60944];
  const COLORS=['#4B6E73','#D7B987','#E19B2D','#6F8F94','#B8925C','#8DA7AA','#C97F16','#A7BEC1'];
  let map=null,polygonCollection=null,markerCollection=null,ymapsPromise=null;
  let activeCluster='';
  const markers=new Map();
  const el=id=>document.getElementById(id);

  function features(){const source=window.SLOGI_CLUSTERS_GEOJSON;return source&&Array.isArray(source.features)?source.features.filter(f=>f?.geometry&&(f.geometry.type==='Polygon'||f.geometry.type==='MultiPolygon')):[];}
  function clusterNames(){return [...new Set(features().map(f=>String(f.properties?.name||'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));}
  function pointInRing(lon,lat,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=Number(ring[i][0]),yi=Number(ring[i][1]),xj=Number(ring[j][0]),yj=Number(ring[j][1]);const hit=((yi>lat)!==(yj>lat))&&(lon<(xj-xi)*(lat-yi)/((yj-yi)||1e-15)+xi);if(hit)inside=!inside;}return inside;}
  function pointInPolygon(lon,lat,polygon){if(!polygon.length||!pointInRing(lon,lat,polygon[0]))return false;for(let i=1;i<polygon.length;i++)if(pointInRing(lon,lat,polygon[i]))return false;return true;}
  function clusterFor(coords){const lat=Number(coords[0]),lon=Number(coords[1]);for(const f of features()){const g=f.geometry;if(g.type==='Polygon'&&pointInPolygon(lon,lat,g.coordinates))return String(f.properties?.name||'');if(g.type==='MultiPolygon')for(const p of g.coordinates)if(pointInPolygon(lon,lat,p))return String(f.properties?.name||'');}return '';}
  function ringToYandex(ring){return ring.map(p=>[Number(p[1]),Number(p[0])]);}
  function parts(f){const g=f.geometry;return g.type==='Polygon'?[g.coordinates.map(ringToYandex)]:g.coordinates.map(poly=>poly.map(ringToYandex));}
  function apiKey(){return String(window.SLOGI_CONFIG?.yandexMapsApiKey||'').trim();}
  function loadYmaps(){if(window.ymaps)return Promise.resolve(window.ymaps);if(ymapsPromise)return ymapsPromise;ymapsPromise=new Promise((resolve,reject)=>{const key=apiKey();if(!key)return reject(new Error('NO_KEY'));const s=document.createElement('script');s.src='https://api-maps.yandex.ru/2.1/?apikey='+encodeURIComponent(key)+'&lang=ru_RU';s.async=true;s.onload=()=>window.ymaps?window.ymaps.ready(()=>resolve(window.ymaps)):reject(new Error('API'));s.onerror=()=>reject(new Error('NETWORK'));document.head.appendChild(s);});return ymapsPromise;}
  function validGeo(item){const geo=item&&item.geo;const lat=Number(geo&&geo.lat),lng=Number(geo&&geo.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;if(geo.address&&String(geo.address).trim()!==String(item.address||'').trim())return null;return [lat,lng];}
  function addressVariants(address){const clean=String(address||'').trim();if(!clean)return[];const values=[clean];if(!/москв|moscow/i.test(clean))values.push('Москва, '+clean);return [...new Set(values)];}
  async function geocodeYandex(address){await loadYmaps();const result=await window.ymaps.geocode(address,{results:1,boundedBy:[[54.6,36.0],[56.8,39.5]],strictBounds:false});const first=result.geoObjects.get(0);return first?first.geometry.getCoordinates():null;}
  async function geocodeNominatim(address){const url='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ru&accept-language=ru&q='+encodeURIComponent(address);const response=await fetch(url,{headers:{'Accept':'application/json','Accept-Language':'ru'}});if(!response.ok)throw new Error('NOMINATIM_'+response.status);const data=await response.json();return data&&data[0]?[Number(data[0].lat),Number(data[0].lon)]:null;}
  async function resolveAddress(address){let lastError=null;for(const variant of addressVariants(address)){try{const coords=await geocodeYandex(variant);if(coords)return{coords,provider:'yandex'};}catch(err){lastError=err;break;}}for(const variant of addressVariants(address)){try{const coords=await geocodeNominatim(variant);if(coords)return{coords,provider:'nominatim'};}catch(err){lastError=err;}}if(lastError)console.warn('Не удалось определить координаты:',lastError);return null;}

  function applyMarkerFilter(){const query=String(el('location-search')?.value||'').trim().toLowerCase();markers.forEach(data=>{const matchSearch=!query||String(data.item.address||'').toLowerCase().includes(query);const matchCluster=!activeCluster||String(data.item.clusterName||'')===activeCluster;data.marker.options.set('visible',matchSearch&&matchCluster);});}
  function setCluster(value,centerPolygon=false){activeCluster=value||'';if(el('cluster-filter'))el('cluster-filter').value=activeCluster;renderDashboard();applyMarkerFilter();if(centerPolygon&&map&&activeCluster){let target=null;polygonCollection.each(obj=>{if(obj.properties.get('clusterName')===activeCluster)target=obj;});const bounds=target?.geometry?.getBounds?.();if(bounds)map.setBounds(bounds,{checkZoomRange:true,zoomMargin:35,duration:250});}}

  function renderDashboard(){
    const query=String(el('location-search')?.value||'').trim().toLowerCase();
    const items=allLocations.filter(item=>{const matchesSearch=!query||String(item.address||'').toLowerCase().includes(query);const matchesCluster=!activeCluster||String(item.clusterName||'')===activeCluster;return matchesSearch&&matchesCluster;});
    el('summary').textContent=`Показано: ${items.length} из ${allLocations.length}`;
    el('cluster-context').textContent=activeCluster?`Кластер: ${activeCluster}`:'Все сохранённые адреса';
    const root=el('locations');
    if(!items.length){root.innerHTML=`<div class="empty"><h2>${allLocations.length?'Объекты не найдены':'Объектов пока нет'}</h2><p>${allLocations.length?'Измените поиск или фильтр по кластеру.':'Добавьте первый объект и сохраните его паспорт.'}</p><a class="btn" href="passport.html">Добавить объект</a></div>`;return;}
    root.innerHTML=items.map(item=>{const cluster=item.clusterName?`<span class="object-cluster">${escapeHtml(item.clusterName)}</span>`:'<span class="object-cluster muted">Кластер определяется</span>';return `<article class="location-card" data-id="${escapeHtml(item.id)}"><div class="card-main"><button class="object-address-button" data-focus-object="${escapeHtml(item.id)}" type="button">${escapeHtml(item.address)}</button>${cluster}<div class="compact-meta"><span>Последнее сохранение</span><strong>${escapeHtml(formatDate(item.updatedAt))}</strong><span>Смета</span><strong class="compact-total">${fmtMoney(item.total)}</strong></div></div><div class="card-actions"><button class="action-btn open" data-action="open" type="button">Открыть паспорт</button><button class="action-btn download" data-action="download" type="button">⇩ Скачать всё</button><button class="action-btn delete" data-action="delete" type="button" aria-label="Удалить объект">×</button></div></article>`;}).join('');
  }

  function populateFilter(){el('cluster-filter').innerHTML='<option value="">Все кластеры</option>'+clusterNames().map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');}
  function drawPolygons(){polygonCollection=new window.ymaps.GeoObjectCollection();features().forEach((f,index)=>{const name=String(f.properties?.name||`Кластер ${index+1}`);parts(f).forEach(part=>{const polygon=new window.ymaps.Polygon(part,{clusterName:name,hintContent:name,balloonContentHeader:escapeHtml(name),balloonContentBody:'Нажмите, чтобы показать объекты этого кластера.'},{fillColor:COLORS[index%COLORS.length],fillOpacity:.14,strokeColor:'#37545A',strokeOpacity:.65,strokeWidth:1.4});polygon.events.add('mouseenter',()=>polygon.options.set({fillOpacity:.27,strokeWidth:2.2}));polygon.events.add('mouseleave',()=>polygon.options.set({fillOpacity:.14,strokeWidth:1.4}));polygon.events.add('click',()=>setCluster(name,true));polygonCollection.add(polygon);});});map.geoObjects.add(polygonCollection);}

  async function geocode(item){const cached=validGeo(item);if(cached)return cached;const resolved=await resolveAddress(item.address);if(!resolved)return null;const coords=resolved.coords;item.geo={lat:Number(coords[0]),lng:Number(coords[1]),provider:resolved.provider,address:String(item.address||'').trim(),updatedAt:new Date().toISOString()};return coords;}
  function addMarker(item,coords){const cluster=clusterFor(coords);if(cluster)item.clusterName=cluster;const body=`<div style="font-weight:800;color:#37545A;margin-bottom:6px">${escapeHtml(item.address)}</div><div style="color:#6B7E82">${cluster?'Кластер: <b>'+escapeHtml(cluster)+'</b>':'Кластер не определён'}</div><div style="margin-top:5px;color:#C97F16;font-weight:800">${fmtMoney(item.total)}</div><a href="passport.html?location=${encodeURIComponent(item.id)}" style="display:inline-block;margin-top:9px;color:#37545A;font-weight:800">Открыть паспорт</a>`;const marker=new window.ymaps.Placemark(coords,{hintContent:item.address,balloonContentBody:body},{preset:'islands#redCircleDotIcon',hideIconOnBalloonOpen:false,zIndex:5000});marker.events.add('click',()=>{window.location.href='passport.html?location='+encodeURIComponent(item.id);});markerCollection.add(marker);markers.set(item.id,{marker,coords,item});}

  async function syncMap(){
    markers.clear();markerCollection.removeAll();let found=0,missing=0;
    el('map-status').textContent='Определяю координаты сохранённых адресов…';
    const points=[];
    for(let i=0;i<allLocations.length;i++){const item=allLocations[i];try{const coords=await geocode(item);if(coords){addMarker(item,coords);points.push(coords);found++;}else missing++;}catch(err){console.warn('Ошибка адреса',item.address,err);missing++;}el('map-status').textContent=`Обработано адресов: ${i+1} из ${allLocations.length}`;}
    writeLocations(allLocations);renderDashboard();applyMarkerFilter();
    if(points.length){const bounds=window.ymaps.util.bounds.fromPoints(points);if(bounds)map.setBounds(bounds,{checkZoomRange:true,zoomMargin:70});}
    else{const bounds=polygonCollection.getBounds();if(bounds)map.setBounds(bounds,{checkZoomRange:true,zoomMargin:25});}
    el('map-status').textContent=`Кластеров: ${features().length} · объектов на карте: ${found}${missing?` · адресов не определено: ${missing}`:''}`;
  }

  async function initMap(){try{await loadYmaps();map=new window.ymaps.Map('locations-map',{center:DEFAULT_CENTER,zoom:9,controls:['zoomControl','fullscreenControl','typeSelector']},{minZoom:6,maxZoom:19,suppressMapOpenBlock:true});drawPolygons();markerCollection=new window.ymaps.GeoObjectCollection();map.geoObjects.add(markerCollection);await syncMap();}catch(err){console.warn('Yandex Maps API:',err);el('map-status').textContent='Не удалось загрузить Яндекс Карты. Откройте сайт через START_SITE.bat и добавьте localhost в ограничения ключа Яндекс Карт.';}}
  function focusObject(id){const data=markers.get(id);if(!data||!map)return;map.setCenter(data.coords,16,{duration:250});data.marker.balloon.open();document.querySelectorAll('.location-card').forEach(card=>card.classList.toggle('active-object',card.dataset.id===id));}

  try{render=renderDashboard;}catch(_){window.render=renderDashboard;}
  populateFilter();renderDashboard();
  el('location-search')?.addEventListener('input',()=>{renderDashboard();applyMarkerFilter();});
  el('cluster-filter')?.addEventListener('change',event=>setCluster(event.target.value,true));
  el('locations')?.addEventListener('click',event=>{const btn=event.target.closest('[data-focus-object]');if(btn){event.preventDefault();focusObject(btn.dataset.focusObject);}});
  initMap();
})();
