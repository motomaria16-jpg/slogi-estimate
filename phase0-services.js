(function(){
'use strict';

const P=window.SlogiPro;
const W=window.SlogiWorkflow;
if(!P)throw new Error('SlogiPro is required for location search');

const STATUS={
  NO_ANSWER:'Не отвечает',
  WAITING:'Связались, ждём информацию',
  ANALYSING:'Вся информация получена, анализируем',
  REJECTED:'Не подошло',
  SUITABLE:'Подошло'
};
const STATUSES=Object.values(STATUS);
const MEASUREMENT_STATUSES=['Не назначен','Не требуется','Запланирован','Выполнен'];
const CRITERIA_KEYS=['area','rooms','ceiling','rent','cluster'];
const CRITERIA_LABELS={
  area:'Площадь',rooms:'Количество кабинетов',ceiling:'Высота потолков',rent:'Стоимость за 1 м²',cluster:'Кластер'
};
const CONFIG=window.SLOGI_PHASE0_CONFIG||{listingImport:{},competitiveAnalysis:{provider:'none'}};
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const now=()=>new Date().toISOString();
const esc=v=>String(v==null?'':v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const norm=v=>String(v||'').trim().toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ');
const clusterKey=v=>norm(v).replace(/^\s*(?:№|#)?\s*\d+[.)-]?\s*/,'').replace(/\b(?:кластер|район|локация)\b/g,'').replace(/[№#]/g,'').replace(/[«»"'`()\[\]{}.,;:_–—-]+/g,' ').replace(/\s+/g,' ').trim();
const sameCluster=(a,b)=>{const x=clusterKey(a),y=clusterKey(b);if(!x||!y)return false;if(x===y)return true;if(x.length>=6&&y.length>=6&&(x.includes(y)||y.includes(x)))return true;const xt=x.split(' ').filter(t=>t.length>2),yt=y.split(' ').filter(t=>t.length>2),shared=xt.filter(t=>yt.includes(t));return shared.length>=2&&shared.length>=Math.min(xt.length,yt.length)-1};
const nullableNumber=v=>{
  if(v===null||v===undefined||String(v).trim()==='')return null;
  const n=Number(String(v).replace(',','.').replace(/\s/g,''));
  return Number.isFinite(n)?n:null;
};
const round=(v,d=2)=>v==null||!Number.isFinite(Number(v))?null:Number(Number(v).toFixed(d));
const deepEqual=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

class Phase0Error extends Error{constructor(message,code='PHASE0_ERROR',details={}){super(message);this.name='Phase0Error';this.code=code;this.details=details}}
class RevisionConflictError extends Phase0Error{constructor(project){super('Объект был изменён в другой вкладке. Обновите карточку и повторите изменения.','REVISION_CONFLICT',{project})}}
class IntegrationUnavailableError extends Phase0Error{constructor(message,provider){super(message,'INTEGRATION_UNAVAILABLE',{provider})}}

function normalizeGeo(value){
  if(Array.isArray(value)&&value.length>=2){const lat=nullableNumber(value[0]),lng=nullableNumber(value[1]);return lat==null||lng==null?null:{lat,lng}}
  if(value&&typeof value==='object'){
    const lat=nullableNumber(value.lat??value.latitude??(Array.isArray(value.coordinates)?value.coordinates[0]:null));
    const lng=nullableNumber(value.lng??value.lon??value.longitude??(Array.isArray(value.coordinates)?value.coordinates[1]:null));
    return lat==null||lng==null?null:{lat,lng};
  }
  return null;
}
function rentPerSqm(area,rent){const a=nullableNumber(area),r=nullableNumber(rent);return a&&a>0&&r!=null?round(r/a,2):null}
function deviationPercent(value,average){const v=nullableNumber(value),a=nullableNumber(average);return v!=null&&a&&a>0?round((v-a)/a*100,1):null}
function normalizeUrl(value){
  const raw=String(value||'').trim();if(!raw)return'';
  try{const u=new URL(raw);u.hash='';['utm_source','utm_medium','utm_campaign','utm_term','utm_content','yclid','gclid'].forEach(k=>u.searchParams.delete(k));return u.toString().replace(/\/$/,'').toLowerCase()}catch(_){return raw.toLowerCase().replace(/\/$/,'')}
}
function detectListingSource(url){try{const host=new URL(String(url||'').trim()).hostname.toLowerCase();if(host==='cian.ru'||host.endsWith('.cian.ru'))return'cian'}catch(_){}return''}
function normalizeRentPeriod(value){const period=String(value||'').toLowerCase();if(['month','monthly','месяц','в месяц'].includes(period))return'month';if(['day','daily','день','в день'].includes(period))return'day';if(['year','yearly','annual','год','в год'].includes(period))return'year';return period||'month'}
function distanceMeters(a,b){
  if(!a||!b)return Infinity;const rad=x=>x*Math.PI/180,R=6371000;
  const dLat=rad(b.lat-a.lat),dLng=rad(b.lng-a.lng),s=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}
function projectGeo(project){return normalizeGeo(project&&project.geo)}
function defaultCriteria(existing){const src=existing&&typeof existing==='object'?existing:{};return CRITERIA_KEYS.reduce((out,key)=>{out[key]=src[key]===true?true:src[key]===false?false:null;return out},{})}
function defaultPhase0(){
  const stamp=now();
  return{
    schemaVersion:1,revision:0,source:'manual',listingUrl:'',canonicalUrl:'',externalId:'',listingTitle:'',listingPublishedAt:'',listingUpdatedAt:'',listingAddedAt:'',parserWarnings:[],floor:null,totalFloors:null,
    rent:{amount:null,period:'month',currency:'RUB'},windowsCount:null,roomsCount:null,
    status:STATUS.NO_ANSWER,rejection:null,selectionCriteria:defaultCriteria(),comments:'',
    layout:{received:false,fileName:'',mime:'',size:null,updatedAt:'',updatedBy:null},
    interest:{confirmed:false,confirmedAt:'',updatedAt:'',updatedBy:null},
    measurement:{status:'Не назначен',date:'',comment:''},clusterSnapshot:null,transition:null,
    createdAt:stamp,updatedAt:stamp
  };
}
function sourceLabel(source){return source==='cian'?'ЦИАН':'Ручной ввод'}

class ProjectRepository{
  listAll(){return P.readLocations().filter(x=>x&&x.id&&!x.deletedAt)}
  listPhase0(){return this.listAll().filter(x=>x.phase0&&typeof x.phase0==='object')}
  get(id){return this.listAll().find(x=>String(x.id)===String(id))||null}
  findByListing(source,externalId,listingUrl){
    const sourceKey=norm(source),idKey=String(externalId||'').trim(),urlKey=normalizeUrl(listingUrl);
    return this.listAll().find(project=>{const phase=project.phase0||{},projectSource=norm(phase.source||project.source),projectId=String(phase.externalId||project.externalId||'').trim(),projectUrl=normalizeUrl(phase.canonicalUrl||phase.listingUrl||project.listingUrl);return Boolean((sourceKey&&idKey&&projectSource===sourceKey&&projectId===idKey)||(urlKey&&projectUrl===urlKey));})||null;
  }
  write(items,reason){P.writeLocations(items,reason);if(window.SlogiCloud&&typeof window.SlogiCloud.schedulePush==='function')window.SlogiCloud.schedulePush()}
  create(project){
    const all=P.readLocations(),id=project.id||P.uid('project');
    if(all.some(x=>String(x&&x.id)===String(id)))throw new Phase0Error('Объект с таким ID уже существует.','DUPLICATE_ID');
    const phase0=Object.assign(defaultPhase0(),clone(project.phase0||{}),{revision:1,createdAt:project.phase0&&project.phase0.createdAt||now(),updatedAt:now()});
    const created=Object.assign({},clone(project),{id,phase0,createdAt:project.createdAt||now(),updatedAt:now()});
    all.unshift(created);this.write(all,'phase0-project-create');return clone(created);
  }
  update(id,shared,phase0,expectedRevision){
    const all=P.readLocations(),index=all.findIndex(x=>x&&String(x.id)===String(id));
    if(index<0)throw new Phase0Error('Объект не найден. Возможно, он был удалён.','PROJECT_NOT_FOUND');
    const current=all[index],currentRevision=Number(current.phase0&&current.phase0.revision)||0;
    if(expectedRevision!=null&&Number(expectedRevision)!==currentRevision)throw new RevisionConflictError(clone(current));
    const nextPhase=Object.assign(defaultPhase0(),clone(current.phase0||{}),clone(phase0||{}),{revision:currentRevision+1,updatedAt:now()});
    const next=Object.assign({},current,clone(shared||{}),{phase0:nextPhase,updatedAt:now()});
    all[index]=next;this.write(all,'phase0-project-update');return clone(next);
  }
  mutate(id,mutator,expectedRevision,reason='phase0-project-update'){
    const all=P.readLocations(),index=all.findIndex(x=>x&&String(x.id)===String(id));
    if(index<0)throw new Phase0Error('Объект не найден.','PROJECT_NOT_FOUND');
    const current=clone(all[index]),currentRevision=Number(current.phase0&&current.phase0.revision)||0;
    if(expectedRevision!=null&&Number(expectedRevision)!==currentRevision)throw new RevisionConflictError(clone(current));
    const next=mutator(current)||current;
    next.phase0=Object.assign(defaultPhase0(),next.phase0||{},{revision:currentRevision+1,updatedAt:now()});next.updatedAt=now();
    all[index]=next;this.write(all,reason);return clone(next);
  }
  softDelete(id){
    const all=P.readLocations(),index=all.findIndex(x=>x&&String(x.id)===String(id));
    if(index<0)throw new Phase0Error('Объект не найден.','PROJECT_NOT_FOUND');
    const current=clone(all[index]);
    if(P&&typeof P.softDeleteProject==='function')P.softDeleteProject(current);
    all[index]=Object.assign({},all[index],{deletedAt:now(),updatedAt:now()});
    this.write(all,'phase0-project-soft-delete');
    return clone(all[index]);
  }
  findDuplicates(candidate,excludeId=''){
    const targetUrl=normalizeUrl(candidate.phase0&&candidate.phase0.listingUrl),targetExternalId=String(candidate.phase0&&candidate.phase0.externalId||''),targetSource=norm(candidate.phase0&&candidate.phase0.source),targetAddress=norm(candidate.address),targetGeo=projectGeo(candidate);
    return this.listAll().filter(x=>String(x.id)!==String(excludeId)).map(project=>{
      const reasons=[],phase=project.phase0||{};
      if(targetExternalId&&targetSource===norm(phase.source)&&targetExternalId===String(phase.externalId||''))reasons.push('совпадает источник и ID объявления');
      if(targetUrl&&normalizeUrl(project.phase0&&project.phase0.listingUrl)===targetUrl)reasons.push('совпадает ссылка на объявление');
      if(!targetExternalId&&!targetUrl&&targetAddress&&norm(project.address)===targetAddress)reasons.push('совпадает нормализованный адрес');
      if(targetGeo&&distanceMeters(targetGeo,projectGeo(project))<=50)reasons.push('координаты находятся ближе 50 м');
      return reasons.length?{project:clone(project),reasons}:null;
    }).filter(Boolean);
  }
  applyCompetitiveMetrics(rows,sourceMeta={}){
    const metrics=Array.isArray(rows)?rows:[],all=P.readLocations(),changes=[];let touched=false;
    const findMetric=p=>{const idKey=clusterKey(p.clusterId),nameKey=clusterKey(p.clusterName);return metrics.find(row=>Boolean((idKey&&(sameCluster(row.clusterId,idKey)||sameCluster(row.clusterName,idKey)))||(nameKey&&(sameCluster(row.clusterName,nameKey)||sameCluster(row.clusterId,nameKey)))))||null};
    all.forEach((project,index)=>{
      if(!project||!project.phase0)return;
      const metric=findMetric(project);
      const snapshot=metric?{clusterId:metric.clusterId||project.clusterId||'',clusterName:metric.clusterName||project.clusterName||'',rating:nullableNumber(metric.rating),averageRentPerSqm:nullableNumber(metric.averageRentPerSqm),sourceVersion:sourceMeta.version||'',syncedAt:sourceMeta.syncedAt||now()}:null;
      const before=project.phase0.clusterSnapshot||null;
      if(!deepEqual(before,snapshot)){
        const beforeRating=before&&nullableNumber(before.rating),afterRating=snapshot&&nullableNumber(snapshot.rating);
        const next=clone(project);next.phase0=Object.assign(defaultPhase0(),next.phase0,{clusterSnapshot:snapshot,revision:(Number(next.phase0.revision)||0)+1,updatedAt:now()});next.updatedAt=now();all[index]=next;touched=true;
        if(beforeRating!==afterRating)changes.push({projectId:next.id,beforeRating,afterRating,clusterName:next.clusterName||''});
      }
    });
    if(touched)this.write(all,'phase0-competitive-refresh');return changes;
  }
}

class AuditService{
  record(projectId,type,text,meta){P.activity(projectId,type,text,meta||{})}
  recordSave(before,after){
    if(!before){this.record(after.id,'phase0-create','Создано потенциальное помещение',{address:after.address});return}
    const b=before.phase0||{},a=after.phase0||{};
    if(b.status!==a.status)this.record(after.id,'phase0-status',`Статус объекта изменён: ${b.status||'не указан'} → ${a.status}`,{from:b.status||'',to:a.status});
    if(a.status===STATUS.REJECTED&&a.rejection&&(!b.rejection||b.rejection.reason!==a.rejection.reason))this.record(after.id,'phase0-rejection','Зафиксирована причина отказа',{reason:a.rejection.reason,date:a.rejection.date});
    if(Boolean(b.interest&&b.interest.confirmed)!==Boolean(a.interest&&a.interest.confirmed))this.record(after.id,'phase0-interest',a.interest.confirmed?'Интерес к помещению подтверждён':'Подтверждение интереса снято',{confirmed:a.interest.confirmed});
    if(!deepEqual(b.measurement,a.measurement))this.record(after.id,'phase0-measurement',`Замер: ${a.measurement&&a.measurement.status||'не назначен'}`,{measurement:clone(a.measurement)});
    const watched=['address','area','ceilingHeight','clusterId','clusterName'];
    const sharedChanged=watched.filter(key=>!deepEqual(before[key],after[key]));
    const phaseChanged=['listingUrl','source','rent','windowsCount','roomsCount','selectionCriteria','comments'].filter(key=>!deepEqual(b[key],a[key]));
    if(sharedChanged.length||phaseChanged.length)this.record(after.id,'phase0-update','Обновлены данные потенциального помещения',{shared:sharedChanged,phase0:phaseChanged});
  }
  recordLayout(project,fileName){this.record(project.id,'phase0-layout','Загружена планировка помещения',{fileName})}
  recordRating(change){this.record(change.projectId,'phase0-rating','Рейтинг обновлён из конкурентного анализа',{before:change.beforeRating,after:change.afterRating,clusterName:change.clusterName})}
  recordTransition(project){this.record(project.id,'phase0-transition','Объект передан к подготовке сметы без создания копии',{projectId:project.id,route:'source-specification.html'})}
}

class FileService{
  constructor(){if(!W)throw new Phase0Error('Хранилище файлов проекта не подключено.','FILE_SERVICE_UNAVAILABLE')}
  async saveLayout(projectId,file){if(!file)return null;await W.saveAttachment(projectId,'phase0-layout',file,file.name);return{name:file.name,mime:file.type||'application/octet-stream',size:file.size||null}}
  async getLayout(projectId){return W.getAttachment(projectId,'phase0-layout')}
  async downloadLayout(projectId,fallbackName='Планировка помещения'){
    const item=await this.getLayout(projectId);if(!item||!item.blob)throw new Phase0Error('Файл планировки не найден в общем хранилище.','FILE_NOT_FOUND');W.download(item.blob,item.name||fallbackName);return item;
  }
}

class ClusterService{
  features(){return(window.SLOGI_CLUSTERS_GEOJSON&&Array.isArray(window.SLOGI_CLUSTERS_GEOJSON.features))?window.SLOGI_CLUSTERS_GEOJSON.features:[]}
  geometry(){return window.SlogiClusterGeometry||null}
  collection(){return{type:'FeatureCollection',features:this.features()}}
  idOf(feature){const geometry=this.geometry();return geometry?geometry.idOf(feature):String(feature&&feature.properties&&(feature.properties.id||feature.properties.clusterId||feature.properties.name)||'')}
  nameOf(feature){const geometry=this.geometry();return geometry?geometry.nameOf(feature):String(feature&&feature.properties&&feature.properties.name||'')}
  list(){return this.features().map(feature=>({id:this.idOf(feature),name:this.nameOf(feature),feature})).filter(x=>x.id&&x.name).sort((a,b)=>a.name.localeCompare(b.name,'ru'))}
  pointInRing(point,ring){const geometry=this.geometry();if(geometry)return geometry.ringPosition(point,ring)!=='outside';let inside=false;const x=point[0],y=point[1];for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];const intersects=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/((yj-yi)||Number.EPSILON)+xi);if(intersects)inside=!inside;}return inside}
  pointInPolygon(point,polygon){const geometry=this.geometry();if(geometry)return geometry.polygonPosition(point,polygon)!=='outside';if(!polygon||!polygon.length||!this.pointInRing(point,polygon[0]))return false;for(let i=1;i<polygon.length;i++)if(this.pointInRing(point,polygon[i]))return false;return true}
  contains(feature,geo){const g=normalizeGeo(geo);if(!g||!feature||!feature.geometry)return false;const point=[g.lng,g.lat],geometry=feature.geometry;
    const service=this.geometry();if(service)return['inside','boundary'].includes(service.featurePosition(feature,g.lat,g.lng));
    if(geometry.type==='Polygon')return this.pointInPolygon(point,geometry.coordinates);
    if(geometry.type==='MultiPolygon')return geometry.coordinates.some(poly=>this.pointInPolygon(point,poly));
    return false;
  }
  locate(lat,lng){const geo=normalizeGeo({lat,lng});if(!geo)return{status:'invalid',clusterId:'',clusterName:'',boundary:false,feature:null};const geometry=this.geometry();if(geometry)return geometry.locate(this.collection(),geo.lat,geo.lng);const feature=this.features().find(item=>this.contains(item,geo));return feature?{status:'inside',clusterId:this.idOf(feature),clusterName:this.nameOf(feature),boundary:false,feature}:{status:'outside',clusterId:'',clusterName:'',boundary:false,feature:null}}
  findByCoordinates(lat,lng){const located=this.locate(lat,lng);return located.status==='inside'?{id:located.clusterId,name:located.clusterName,feature:located.feature,boundary:located.boundary===true}:null}
  pointSegmentMeters(point,a,b){const lat0=point[1]*Math.PI/180,scaleX=111320*Math.cos(lat0),scaleY=110540;const px=point[0]*scaleX,py=point[1]*scaleY,ax=a[0]*scaleX,ay=a[1]*scaleY,bx=b[0]*scaleX,by=b[1]*scaleY,dx=bx-ax,dy=by-ay;const denom=dx*dx+dy*dy;const t=denom?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/denom)):0;return Math.hypot(px-(ax+t*dx),py-(ay+t*dy))}
  distanceToFeatureMeters(feature,geo){const g=normalizeGeo(geo);if(!g||!feature||!feature.geometry)return Infinity;if(this.contains(feature,g))return 0;const point=[g.lng,g.lat],geometry=feature.geometry,polys=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];let best=Infinity;polys.forEach(poly=>poly.forEach(ring=>{for(let i=1;i<ring.length;i++)best=Math.min(best,this.pointSegmentMeters(point,ring[i-1],ring[i]));if(ring.length>2)best=Math.min(best,this.pointSegmentMeters(point,ring[ring.length-1],ring[0]))}));return best}
  findNearestByCoordinates(lat,lng,maxMeters=2500){const geo=normalizeGeo({lat,lng});if(!geo)return null;let best=null,bestDistance=Infinity;this.features().forEach(feature=>{const distance=this.distanceToFeatureMeters(feature,geo);if(distance<bestDistance){bestDistance=distance;best=feature}});return best&&bestDistance<=maxMeters?{id:this.idOf(best),name:this.nameOf(best),feature:best,distanceMeters:Math.round(bestDistance)}:null}
  find(idOrName){const key=norm(idOrName);return this.list().find(x=>norm(x.id)===key||norm(x.name)===key)||null}
}


function cleanReaderText(value){return String(value||'').replace(/\u00a0/g,' ').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n')}
function stripMarkdown(value){return String(value||'').replace(/!\[[^\]]*\]\([^)]*\)/g,' ').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_`>#]/g,' ').replace(/\s+/g,' ').trim()}
function firstMatch(text,patterns){for(const pattern of patterns){const match=text.match(pattern);if(match&&match[1])return String(match[1]).trim()}return''}
function numberFromText(value){if(value==null)return null;const raw=String(value).replace(/\u00a0/g,' ').replace(/[^0-9,.-]/g,'').replace(',','.');const n=Number(raw);return Number.isFinite(n)?n:null}
function moneyFromText(value){if(value==null)return null;const digits=String(value).replace(/\u00a0/g,' ').replace(/[^0-9]/g,'');if(!digits)return null;const n=Number(digits);return Number.isFinite(n)?n:null}
function normalizeAddressText(value){return stripMarkdown(String(value||'').replace(/^адрес\s*[:—-]?\s*/i,'')).replace(/\s+На карте.*$/i,'').replace(/\s+(?:Площадь|Цена|Аренда)\b.*$/i,'').replace(/\s*,\s*/g,', ').replace(/\s+/g,' ').replace(/[|•]+$/,'').trim()}
function joinPostalAddress(address){if(!address)return'';if(typeof address==='string')return normalizeAddressText(address);if(typeof address!=='object')return'';return normalizeAddressText([address.addressCountry,address.addressRegion,address.addressLocality,address.streetAddress].filter(Boolean).join(', '))}
function walkJson(value,visit,seen=new Set()){if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);visit(value);if(Array.isArray(value))value.forEach(x=>walkJson(x,visit,seen));else Object.values(value).forEach(x=>walkJson(x,visit,seen))}
function structuredFromHtml(html){
  if(typeof DOMParser==='undefined')return{};let doc;try{doc=new DOMParser().parseFromString(String(html||''),'text/html')}catch(_){return{}}
  const out={address:'',area:null,rent:null,ceiling:null,windows:null,geo:null,text:''};
  const collect=obj=>{if(!obj||typeof obj!=='object')return;
    if(!out.address&&obj.address)out.address=joinPostalAddress(obj.address);
    const size=obj.floorSize||obj.area||obj.size;if(out.area==null&&size){out.area=numberFromText(typeof size==='object'?(size.value||size.name):size)}
    const offers=obj.offers||obj.offer;if(out.rent==null&&offers){const list=Array.isArray(offers)?offers:[offers];for(const offer of list){const price=offer&&typeof offer==='object'?(offer.price||offer.lowPrice):null;if(price!=null){out.rent=moneyFromText(price);break}}}
    const geo=obj.geo||obj.coordinates;if(!out.geo&&geo&&typeof geo==='object'){const lat=numberFromText(geo.latitude??geo.lat),lng=numberFromText(geo.longitude??geo.lng??geo.lon);if(lat!=null&&lng!=null)out.geo={lat,lng}}
    const ceiling=obj.ceilingHeight||obj.ceiling;if(out.ceiling==null&&ceiling!=null)out.ceiling=numberFromText(ceiling);
    const windows=obj.numberOfWindows||obj.windowsCount;if(out.windows==null&&windows!=null)out.windows=numberFromText(windows);
  };
  [...doc.querySelectorAll('script[type="application/ld+json"]')].forEach(node=>{try{const parsed=JSON.parse(node.textContent||'null');walkJson(parsed,collect)}catch(_){}});
  [...doc.querySelectorAll('script')].forEach(node=>{const text=node.textContent||'';if(text.length<20||text.length>3000000)return;const patterns=[/"address"\s*:\s*"([^"]{5,220})"/i,/"addressLocality"\s*:\s*"([^"]+)"/i];if(!out.address){const v=firstMatch(text,patterns);if(v)out.address=normalizeAddressText(v.replace(/\\u[0-9a-f]{4}/gi,m=>String.fromCharCode(parseInt(m.slice(2),16))))}if(!out.geo){const lat=firstMatch(text,[/"(?:lat|latitude)"\s*:\s*"?([0-9]{2}\.[0-9]+)"?/i]),lng=firstMatch(text,[/"(?:lng|lon|longitude)"\s*:\s*"?([0-9]{2}\.[0-9]+)"?/i]);if(lat&&lng)out.geo={lat:Number(lat),lng:Number(lng)}}});
  const meta=(name)=>doc.querySelector(`meta[property="${name}"]`)?.content||doc.querySelector(`meta[name="${name}"]`)?.content||'';
  const title=[meta('og:title'),doc.title].filter(Boolean).join('\n'),description=[meta('og:description'),meta('description')].filter(Boolean).join('\n');
  out.text=cleanReaderText([title,description,doc.body&&doc.body.innerText||doc.body&&doc.body.textContent||''].join('\n'));
  return out;
}
function canonicalListingFetchUrl(url){try{const u=new URL(String(url||'').trim());u.hash='';if(/(^|\.)cian\.ru$/i.test(u.hostname))u.search='';return u.toString()}catch(_){return String(url||'').trim()}}

class BaseListingProvider{
  constructor(provider){this.provider=provider;this.endpoint=String(CONFIG.listingImport&&CONFIG.listingImport.endpoint||'')}
  async import(url){
    if(!this.endpoint)throw new IntegrationUnavailableError('Серверный импорт ЦИАН не настроен.',this.provider);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Number(CONFIG.listingImport.timeoutMs)||15000);
    try{
      const token=window.SlogiCloud&&typeof window.SlogiCloud.getAccessToken==='function'?await window.SlogiCloud.getAccessToken():'';
      if(!token)throw new Phase0Error('Техническая сессия ещё не готова. Повторите позже.','ANONYMOUS_SESSION_REQUIRED');
      const response=await fetch(this.endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Slogi-Client':'phase0','Authorization':'Bearer '+token},body:JSON.stringify({provider:this.provider,url}),signal:controller.signal});
      if(!response.ok)throw new Phase0Error(`Сервис импорта вернул HTTP ${response.status}.`,'LISTING_HTTP_ERROR',{status:response.status});
      const payload=await response.json(),data=payload&&payload.data||payload;
      if(!data||typeof data!=='object')throw new Phase0Error('Сервис импорта не вернул данные объявления.','LISTING_EMPTY');
      return this.normalize(data,url);
    }catch(error){
      if(error&&error.name==='AbortError')throw new Phase0Error('Сервис импорта не ответил вовремя. Заполните данные вручную.','LISTING_TIMEOUT');
      throw error;
    }finally{clearTimeout(timer)}
  }
  normalize(data,url){
    const geo=normalizeGeo(data.geo||{lat:data.latitude,lng:data.longitude});
    const rent=data.rent&&typeof data.rent==='object'?data.rent:{amount:data.rentMonthly??data.rentAmount,currency:data.currency,period:data.period};
    return{
      source:this.provider,listingUrl:url,address:String(data.address||'').trim(),geo,
      area:nullableNumber(data.area),windowsCount:nullableNumber(data.windowsCount),ceilingHeight:nullableNumber(data.ceilingHeight),
      rent:{amount:nullableNumber(rent.amount),currency:String(rent.currency||'RUB'),period:normalizeRentPeriod(rent.period)}
    };
  }
}
class CianListingProvider extends BaseListingProvider{constructor(){super('cian')}}
class ListingImportService{
  constructor(){this.providers={cian:new CianListingProvider()}}
  detect(url){return detectListingSource(url)}
  async import(url){
    const source=this.detect(url);if(!source)throw new Phase0Error('Поддерживаются только ссылки на объявления ЦИАН. Можно продолжить без ссылки и заполнить объект вручную.','LISTING_SOURCE_UNSUPPORTED');
    const data=await this.providers[source].import(url);const fields=[data.address,data.geo,data.area,data.rent&&data.rent.amount,data.windowsCount,data.ceilingHeight],received=fields.filter(v=>v!==null&&v!==undefined&&v!=='').length;
    return{source,data,state:received>=4?'success':'partial',received};
  }
}

function parseCsv(text){
  const source=String(text||'').replace(/^\uFEFF/,'');const first=(source.split(/\r?\n/,1)[0]||'');
  const counts={',':(first.match(/,/g)||[]).length,';':(first.match(/;/g)||[]).length,'\t':(first.match(/\t/g)||[]).length};
  const delimiter=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0]||',';const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(ch==='"'&&quoted&&next==='"'){cell+='"';i++;continue}
    if(ch==='"'){quoted=!quoted;continue}
    if(ch===delimiter&&!quoted){row.push(cell);cell='';continue}
    if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&next==='\n')i++;row.push(cell);if(row.some(v=>String(v).trim()!==''))rows.push(row);row=[];cell='';continue}
    cell+=ch;
  }
  row.push(cell);if(row.some(v=>String(v).trim()!==''))rows.push(row);if(!rows.length)return[];
  const headers=rows.shift().map(x=>String(x).trim());return rows.map(values=>headers.reduce((out,key,index)=>{out[key]=values[index]==null?'':String(values[index]).trim();return out},{}));
}
function competitiveNumber(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const cleaned=String(value).replace(/\u00a0/g,' ').replace(/\s/g,'').replace(',','.').replace(/[^0-9.\-]/g,'');
  if(!cleaned||cleaned==='-'||cleaned==='.')return null;
  const n=Number(cleaned);return Number.isFinite(n)?n:null;
}
function headerKey(value){return norm(value).replace(/м\s*[²2]/g,'м2').replace(/кв\.?\s*м/g,'м2').replace(/[«»"'`()\[\]{}]/g,'').replace(/[/:;,_–—-]+/g,' ').replace(/\s+/g,' ').trim()}
function uniqueHeaders(headers){const seen={};return headers.map((value,index)=>{let base=String(value||'').trim()||`Колонка ${index+1}`;const key=headerKey(base)||`column-${index}`;seen[key]=(seen[key]||0)+1;return seen[key]===1?base:`${base} (${seen[key]})`})}
function findHeader(headers,explicit,predicate){
  if(explicit){const direct=headers.find(h=>h===explicit)||headers.find(h=>headerKey(h)===headerKey(explicit));if(direct)return direct}
  return headers.find(h=>predicate(headerKey(h),h))||'';
}
function findLastHeader(headers,explicit,predicate){
  if(explicit){const direct=[...headers].reverse().find(h=>h===explicit)||[...headers].reverse().find(h=>headerKey(h)===headerKey(explicit));if(direct)return direct}
  return [...headers].reverse().find(h=>predicate(headerKey(h),h))||'';
}
function knownClusterNames(){return((window.SLOGI_CLUSTERS_GEOJSON&&window.SLOGI_CLUSTERS_GEOJSON.features)||[]).map(feature=>feature&&feature.properties&&feature.properties.name).filter(Boolean)}
function inferClusterHeader(headers,rows){
  const known=knownClusterNames();if(!known.length||!headers.length||!rows.length)return'';
  let best='',bestScore=0;
  headers.forEach(header=>{let hits=0,seen=0;rows.slice(0,80).forEach(row=>{const value=String(row&&row[header]||'').trim();if(!value)return;seen++;if(known.some(name=>sameCluster(name,value)))hits++});const score=seen?hits/Math.min(seen,30):0;if(hits>=2&&score>bestScore){bestScore=score;best=header}});
  return best;
}
function detectCompetitiveColumns(row,mapping={},sampleRows=[]){
  const headers=Object.keys(row||{});
  let clusterName=findHeader(headers,mapping.clusterName,key=>key==='кластер'||key==='название кластера'||key==='наименование кластера'||key==='cluster'||key==='локация'||key==='название локации'||(key.includes('кластер')&&!key.includes('рейтинг')&&!key.includes('id')));
  if(!clusterName)clusterName=inferClusterHeader(headers,sampleRows);
  const clusterId=findHeader(headers,mapping.clusterId,key=>key==='id кластера'||key==='cluster id'||key==='clusterid'||(key.includes('id')&&key.includes('кластер')))||clusterName;
  // На листе «Свод» бизнес-рейтинг находится в крайней правой колонке
  // «РЕЙТИНГ(Население важнее)». Берём именно последний столбец с рейтингом,
  // а не промежуточные коэффициенты вроде «КС Кластер».
  let rating=findLastHeader(headers,mapping.rating,key=>key.includes('рейтинг')&&key.includes('население'));
  if(!rating)rating=findLastHeader(headers,mapping.rating,key=>key==='рейтинг'||key==='рейтинг кластера'||key==='итоговый рейтинг'||key==='rating'||key.includes('рейтинг'));
  if(!rating)rating=findLastHeader(headers,'',key=>key.includes('балл')||key.includes('оценк'));
  // Для сравнения аренды используется колонка «м2 семейный аренда» из «Свод».
  let averageRentPerSqm=findHeader(headers,mapping.averageRentPerSqm,key=>key==='м2 семейный аренда'||key.includes('м2 семейный аренда'));
  if(!averageRentPerSqm)averageRentPerSqm=findHeader(headers,'',key=>{
    const sqm=key.includes('м2')||key.includes('квадрат')||key.includes('кв м');
    const money=key.includes('аренд')||key.includes('стоим')||key.includes('ставк')||key.includes('цена')||key.includes('руб')||key.includes('₽')||key.includes('за м2')||key.includes('1 м2');
    const avg=key.includes('сред')||key.includes('ср ')||key.includes('медиан')||key.includes('средневзв')||key.includes('за м2')||key.includes('1 м2');
    return sqm&&money&&avg;
  });
  if(!averageRentPerSqm){
    averageRentPerSqm=findHeader(headers,'',key=>{
      const sqm=key.includes('м2')||key.includes('квадрат')||key.includes('кв м');
      const money=key.includes('аренд')||key.includes('стоим')||key.includes('ставк')||key.includes('цена')||key.includes('руб')||key.includes('₽')||key.includes('за м2')||key.includes('1 м2');
      return sqm&&money&&!key.includes('отклон')&&!key.includes('разниц');
    });
  }
  return{headers,clusterId,clusterName,rating,averageRentPerSqm};
}
function mapCompetitiveRow(row,mapping){
  const detected=detectCompetitiveColumns(row,mapping||{});
  const read=column=>column&&row?row[column]:null;
  const clusterName=String(read(detected.clusterName)||read(detected.clusterId)||'').trim();
  const clusterId=String(read(detected.clusterId)||clusterName).trim();
  if(!clusterId&&!clusterName)return null;
  const core=new Set([detected.clusterId,detected.clusterName,detected.rating,detected.averageRentPerSqm].filter(Boolean));
  const configured=Array.isArray(mapping&&mapping.additionalFields)?mapping.additionalFields:[];
  let additional;
  if(configured.length){
    additional=configured.map(item=>({key:item.key||item.column,label:item.label||item.column,value:row[item.column]})).filter(x=>x.key&&String(x.value||'').trim()!=='');
  }else{
    additional=detected.headers.filter(h=>!core.has(h)&&String(row[h]||'').trim()!=='').map(h=>({key:h,label:h,value:row[h]}));
  }
  return{
    clusterId,clusterName:clusterName||clusterId,
    rating:competitiveNumber(read(detected.rating)),
    averageRentPerSqm:competitiveNumber(read(detected.averageRentPerSqm)),
    additional,raw:clone(row),sourceColumns:detected
  };
}
function parseCsvMatrix(text){
  const source=String(text||'').replace(/^\uFEFF/,'');const sample=source.split(/\r?\n/).slice(0,12).join('\n');
  const counts={',':(sample.match(/,/g)||[]).length,';':(sample.match(/;/g)||[]).length,'\t':(sample.match(/\t/g)||[]).length};
  const delimiter=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0]||',';const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<source.length;i++){const ch=source[i],next=source[i+1];if(ch==='"'&&quoted&&next==='"'){cell+='"';i++;continue}if(ch==='"'){quoted=!quoted;continue}if(ch===delimiter&&!quoted){row.push(cell);cell='';continue}if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&next==='\n')i++;row.push(cell);if(row.some(v=>String(v).trim()!==''))rows.push(row);row=[];cell='';continue}cell+=ch}
  row.push(cell);if(row.some(v=>String(v).trim()!==''))rows.push(row);return rows;
}
function competitiveHeaderScore(values){
  const keys=(values||[]).map(headerKey);let score=0;
  keys.forEach(key=>{if(!key)return;if(key==='кластер'||key.includes('название кластера')||key.includes('наименование кластера'))score+=30;else if(key.includes('кластер'))score+=18;else if(key==='локация'||key.includes('название локации'))score+=10;if(key.includes('рейтинг'))score+=12;if(key.includes('балл')||key.includes('оценк'))score+=7;const sqm=key.includes('м2')||key.includes('квадрат')||key.includes('кв м');const money=key.includes('аренд')||key.includes('стоим')||key.includes('ставк')||key.includes('цена')||key.includes('руб');if(sqm&&money)score+=12});
  return score;
}
function forwardFillHeaderRow(row,width){let last='';return Array.from({length:width},(_,i)=>{const value=String(row&&row[i]||'').trim();if(value)last=value;return value||last})}
function findLeafHeaderIndex(clean){
  let best=-1,bestScore=-1;
  clean.slice(0,35).forEach((row,index)=>{
    const keys=(row||[]).map(headerKey),cluster=keys.some(k=>k==='кластер'),number=keys.some(k=>k==='#'||k==='№'||k==='n'),
      leafHits=keys.filter(k=>['сильный','средний','слабый','профильные ду','все ду','кс кластер','кс адресп15','м2 коммерция','м2 семейный аренда','отклонение','1f source','прочие ду','поровну','население важнее','платежеспособность важнее'].some(x=>k===x||k.includes(x))).length,
      rating=keys.some(k=>k.includes('рейтинг')&&k.includes('население'));
    const score=(cluster?50:0)+(number?15:0)+leafHits*4+(rating?30:0)+Math.min(keys.filter(Boolean).length,20)*.15;
    if(score>bestScore){bestScore=score;best=index}
  });
  return bestScore>=50?best:-1;
}
function buildOriginalLeafHeaders(clean,headerIndex,width){
  const leaf=clean[headerIndex]||[];
  return Array.from({length:width},(_,col)=>{
    const direct=String(leaf[col]||'').trim();
    if(direct)return direct;
    // Если конкретная колонка не подписана в рабочей строке заголовков,
    // берём подпись только из той же колонки выше. Не растягиваем merged-cell
    // заголовки на соседние столбцы: именно это раньше порождало «Кластер (3)».
    for(let r=headerIndex-1;r>=Math.max(0,headerIndex-4);r--){
      const value=String(clean[r]&&clean[r][col]||'').trim(),key=headerKey(value);
      if(value&&key&&key!=='свод'&&!/^\d+(?:[.,]\d+)?$/.test(key))return value;
    }
    return`Колонка ${col+1}`;
  });
}
function numericStatsForHeader(header,rows){
  const values=[];for(const row of rows.slice(0,80)){const n=competitiveNumber(row&&row[header]);if(n!=null)values.push(n)}
  if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)],decimals=values.filter(v=>Math.abs(v-Math.round(v))>.001).length/values.length;
  return{count:values.length,median,min:sorted[0],max:sorted[sorted.length-1],decimals,coverage:values.length/Math.max(1,Math.min(rows.length,80))};
}
function inferNumericMetricHeaders(headers,rows,clusterHeader){
  const clusterIndex=Math.max(0,headers.indexOf(clusterHeader)),stats=headers.map((h,i)=>({h,i,stats:numericStatsForHeader(h,rows)})).filter(x=>x.stats&&x.stats.coverage>=.55&&x.h!==clusterHeader);
  let rent=stats.filter(x=>x.i>clusterIndex&&x.stats.median>=400&&x.stats.median<=12000&&x.stats.max<100000).sort((a,b)=>(a.i-clusterIndex)-(b.i-clusterIndex))[0];
  let rating=stats.filter(x=>x.i>clusterIndex&&x.stats.min>=0&&x.stats.max<=10&&x.stats.decimals>=.25).sort((a,b)=>b.stats.decimals-a.stats.decimals||a.i-b.i)[0];
  return{averageRentPerSqm:rent&&rent.h||'',rating:rating&&rating.h||''};
}
function matrixToCompetitiveSource(matrix,mapping={}){
  const clean=(matrix||[]).map(row=>(row||[]).map(v=>String(v==null?'':v).trim())).filter(row=>row.some(Boolean));
  if(!clean.length)return{headers:[],rows:[],headerIndex:-1};
  const leafHeaderIndex=findLeafHeaderIndex(clean);
  let headerIndex=leafHeaderIndex>=0?leafHeaderIndex:0,bestScore=leafHeaderIndex>=0?100:-1;
  if(leafHeaderIndex<0)clean.slice(0,35).forEach((row,index)=>{const semantic=competitiveHeaderScore(row),density=Math.min(row.filter(Boolean).length,12)*.15,score=semantic+density;if(score>bestScore){bestScore=score;headerIndex=index}});
  if(bestScore<8){
    const known=knownClusterNames();let best={index:0,hits:0,col:-1};
    clean.slice(0,20).forEach((candidate,index)=>{const width=Math.max(candidate.length,...clean.slice(index+1,index+31).map(r=>r.length));for(let col=0;col<width;col++){let hits=0;clean.slice(index+1,index+31).forEach(r=>{const value=String(r[col]||'').trim();if(value&&known.some(name=>sameCluster(name,value)))hits++});if(hits>best.hits)best={index,hits,col}}});
    if(best.hits>=2)headerIndex=best.index;
  }
  const width=Math.max(...clean.slice(Math.max(0,headerIndex-5),headerIndex+31).map(r=>r.length));
  const original=buildOriginalLeafHeaders(clean,headerIndex,width),headers=uniqueHeaders(original),rows=clean.slice(headerIndex+1).map(values=>headers.reduce((out,key,index)=>{out[key]=values[index]==null?'':String(values[index]).trim();return out},{})).filter(row=>Object.values(row).some(v=>String(v).trim()!==''));
  const probe=rows[0]||headers.reduce((o,h)=>(o[h]='',o),{}),detected=detectCompetitiveColumns(probe,mapping,rows),numeric=inferNumericMetricHeaders(headers,rows,detected.clusterName||detected.clusterId);
  if(!detected.rating&&numeric.rating)detected.rating=numeric.rating;if(!detected.averageRentPerSqm&&numeric.averageRentPerSqm)detected.averageRentPerSqm=numeric.averageRentPerSqm;
  return{headers,rows,headerIndex,detected};
}
function sourceQuality(source){if(!source||!source.rows||!source.rows.length)return-1e9;const d=source.detected||{},headers=source.headers||[],meaningful=headers.filter(h=>!/^Колонка\s+\d+/i.test(h)).length,hasCluster=headers.some(h=>headerKey(h)==='кластер'),hasRent=headers.some(h=>headerKey(h)==='м2 семейный аренда'),hasBusinessRating=headers.some(h=>{const k=headerKey(h);return k.includes('рейтинг')&&k.includes('население')});return source.rows.length+meaningful*3+(d.clusterName?80:0)+(d.rating?35:0)+(d.averageRentPerSqm?35:0)+(hasCluster?250:0)+(hasRent?250:0)+(hasBusinessRating?350:0)+competitiveHeaderScore(headers)}
function gvizObjects(payload,config={}){
  if(!payload||payload.status==='error'||!payload.table)throw new Phase0Error('Google Sheets не вернул данные листа «Свод». Проверьте доступ к таблице.','COMPETITIVE_SHEET_ERROR');
  const table=payload.table,labelRow=(table.cols||[]).map((col,index)=>col&&col.label||'');
  const data=(table.rows||[]).map(item=>(table.cols||[]).map((_,index)=>{const cell=item&&item.c?item.c[index]:null;return cell==null?'':String(cell.f!==undefined&&cell.f!==null?cell.f:cell.v!==undefined&&cell.v!==null?cell.v:'').trim()}));
  const matrix=competitiveHeaderScore(labelRow)>=8?[labelRow,...data]:data;return matrixToCompetitiveSource(matrix,config.mapping||{});
}
function googleSheetJsonp(config,headersCount=0){
  return new Promise((resolve,reject)=>{
    const id=String(config.spreadsheetId||'').trim(),sheet=String(config.sheetName||'Свод').trim(),gid=String(config.gid||'').trim();
    if(!id){reject(new IntegrationUnavailableError('Не указан Google Spreadsheet ID.','competitive-analysis'));return}
    const callback=`__slogiGviz_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script=document.createElement('script');let settled=false;
    const cleanup=()=>{try{delete window[callback]}catch(_){window[callback]=undefined}script.remove()};
    const timer=setTimeout(()=>{if(settled)return;settled=true;cleanup();reject(new Phase0Error('Google Sheets не ответил вовремя. Проверьте доступ к таблице.','COMPETITIVE_TIMEOUT'))},20000);
    window[callback]=payload=>{if(settled)return;settled=true;clearTimeout(timer);try{const parsed=gvizObjects(payload,config);cleanup();resolve(parsed)}catch(error){cleanup();reject(error)}};
    script.onerror=()=>{if(settled)return;settled=true;clearTimeout(timer);cleanup();reject(new Phase0Error('Не удалось загрузить Google Sheets. Убедитесь, что файл доступен по ссылке.','COMPETITIVE_NETWORK_ERROR'))};
    const params=new URLSearchParams({tqx:`responseHandler:${callback}`,headers:String(headersCount),_:String(Date.now())});if(gid)params.set('gid',gid);else params.set('sheet',sheet);
    script.src=`https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq?${params.toString()}`;document.head.appendChild(script);
  });
}
class GoogleSheetCompetitiveProvider{
  constructor(config){this.config=config}
  async load(){
    const id=String(this.config.spreadsheetId||'').trim(),sheet=String(this.config.sheetName||'Свод').trim(),gid=String(this.config.gid||'').trim();
    if(!id)throw new IntegrationUnavailableError('Google Sheets для конкурентного анализа не настроен.','competitive-analysis');
    let source;const target=gid?`gid=${encodeURIComponent(gid)}`:`sheet=${encodeURIComponent(sheet)}`;
    const csvUrl=`https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq?tqx=out:csv&headers=0&${target}&_=${Date.now()}`;
    const candidates=[];
    try{const response=await fetch(csvUrl,{cache:'no-store',credentials:'omit'});if(!response.ok)throw new Error(`HTTP ${response.status}`);candidates.push(matrixToCompetitiveSource(parseCsvMatrix(await response.text()),this.config.mapping||{}))}catch(_){}
    const probes=await Promise.allSettled([0,1,2,3,4,5,6].map(count=>googleSheetJsonp(this.config,count)));
    probes.forEach(result=>{if(result.status==='fulfilled')candidates.push(result.value)});source=candidates.sort((a,b)=>sourceQuality(b)-sourceQuality(a))[0];if(!source)throw new Phase0Error('Не удалось загрузить лист «Свод».','COMPETITIVE_NETWORK_ERROR');
    if(!source.rows.length)throw new Phase0Error('Лист «Свод» пуст или недоступен.','COMPETITIVE_EMPTY');
    const detected=source.detected||detectCompetitiveColumns(source.rows[0],this.config.mapping||{},source.rows);
    if(!detected.clusterName&&!detected.clusterId)throw new Phase0Error('Не удалось определить колонку с названиями кластеров на листе «Свод». Проверьте, что в таблице есть названия кластеров из карты.','COMPETITIVE_CLUSTER_COLUMN');
    const resolved=Object.assign({},this.config.mapping||{},{clusterName:detected.clusterName||'',clusterId:detected.clusterId||detected.clusterName||'',rating:detected.rating||'',averageRentPerSqm:detected.averageRentPerSqm||''});
    const rows=source.rows.map(row=>mapCompetitiveRow(row,resolved)).filter(Boolean).filter(row=>knownClusterNames().some(name=>sameCluster(name,row.clusterName))||String(row.clusterName||'').trim());
    return{rows,columns:source.headers||[],version:`${gid||sheet}:${now()}`,sheetName:sheet,sourceUrl:this.config.sourceUrl||'',mapping:resolved};
  }
}

function xlsxCellValue(ws,r,c){
  const utils=window.SlogiXlsx&&window.SlogiXlsx.utils;if(!utils)return null;
  const cell=ws&&ws[utils.encodeCell({r,c})];return cell?cell.v:null;
}
function xlsxColumnLetter(c){const utils=window.SlogiXlsx&&window.SlogiXlsx.utils;return utils?utils.numberToCol(c):String(c+1)}
function competitiveHeaderText(value){return String(value==null?'':value).replace(/\s+/g,' ').trim()}
function findSheetHeaderRows(ws,range){
  const end=Math.min(range.e.r,Math.max(range.s.r+40,40));
  for(let r=range.s.r;r<=end;r++){
    let hasNumber=false,hasCluster=false;
    for(let c=range.s.c;c<=range.e.c;c++){
      const key=headerKey(xlsxCellValue(ws,r,c));if(key==='#'||key==='№')hasNumber=true;if(key==='кластер')hasCluster=true;
    }
    if(hasCluster&&(hasNumber||r<20))return{top:r,bottom:Math.min(r+1,range.e.r)};
  }
  throw new Phase0Error('На листе «Свод» не найдена строка заголовков с колонкой «Кластер».','COMPETITIVE_HEADER_NOT_FOUND');
}
function parseManualCompetitiveWorkbook(wb,file,config){
  if(!window.SlogiXlsx||!window.SlogiXlsx.utils)throw new Phase0Error('Модуль чтения XLSX не загружен.','COMPETITIVE_XLSX_MODULE');
  const sheetName=String(config.sheetName||'Свод');
  const ws=wb&&wb.Sheets&&wb.Sheets[sheetName];
  if(!ws||!ws['!ref'])throw new Phase0Error(`В файле не найден лист «${sheetName}».`,'COMPETITIVE_SHEET_MISSING');
  const utils=window.SlogiXlsx.utils,range=utils.decodeRange(ws['!ref']),headerRows=findSheetHeaderRows(ws,range),columns=[];
  for(let c=range.s.c;c<=range.e.c;c++){
    const top=competitiveHeaderText(xlsxCellValue(ws,headerRows.top,c)),bottom=competitiveHeaderText(xlsxCellValue(ws,headerRows.bottom,c));
    columns.push({index:c,letter:xlsxColumnLetter(c),top,bottom,label:bottom||top||xlsxColumnLetter(c)});
  }
  const exact=(target)=>columns.find(col=>headerKey(col.bottom)===headerKey(target)||headerKey(col.top)===headerKey(target));
  const clusterCol=exact(config.mapping&&config.mapping.clusterName||'Кластер')||columns.find(col=>headerKey(col.top)==='кластер'||headerKey(col.bottom)==='кластер')||columns.find(col=>col.letter==='B');
  const rentCol=exact(config.mapping&&config.mapping.averageRentPerSqm||'м2 семейный аренда')||columns.find(col=>headerKey(col.bottom).includes('м2 семейный аренда'))||columns.find(col=>col.letter==='AE');
  const ratingCandidates=columns.filter(col=>headerKey(col.top).includes('рейтинг')||headerKey(col.bottom).includes('рейтинг'));
  const ratingCol=exact(config.mapping&&config.mapping.rating||'Рейтинг(население важнее)')||ratingCandidates[ratingCandidates.length-1]||columns[columns.length-1];
  if(!clusterCol)throw new Phase0Error('На листе «Свод» не найдена колонка «Кластер».','COMPETITIVE_CLUSTER_COLUMN');
  const rows=[];
  for(let r=headerRows.bottom+1;r<=range.e.r;r++){
    const values=columns.map(col=>xlsxCellValue(ws,r,col.index));
    if(!values.some(value=>value!==null&&value!==undefined&&String(value).trim()!==''))continue;
    const clusterName=competitiveHeaderText(values[clusterCol.index-range.s.c]);
    if(!clusterName)continue;
    const raw={};columns.forEach((col,i)=>{raw[col.letter]=values[i]});
    const additional=columns.filter(col=>![clusterCol.letter,rentCol&&rentCol.letter,ratingCol&&ratingCol.letter].includes(col.letter)).map(col=>({key:col.letter,label:col.label,value:raw[col.letter]})).filter(item=>item.value!==null&&item.value!==undefined&&String(item.value).trim()!=='');
    rows.push({
      clusterId:clusterName,clusterName,
      rating:competitiveNumber(ratingCol?raw[ratingCol.letter]:null),
      averageRentPerSqm:competitiveNumber(rentCol?raw[rentCol.letter]:null),
      additional,raw,sourceValues:values
    });
  }
  const merges=Array.isArray(ws['!merges'])?ws['!merges'].map(m=>({s:{r:m.s.r,c:m.s.c},e:{r:m.e.r,c:m.e.c}})):[];
  return{
    rows,
    columns:columns.map(col=>col.letter),
    columnSchema:{startCol:range.s.c,endCol:range.e.c,headerTopRow:headerRows.top,headerBottomRow:headerRows.bottom,columns,merges},
    version:`${file&&file.name||'competitive.xlsx'}:${file&&file.size||0}:${file&&file.lastModified||Date.now()}`,
    sheetName,
    fileName:file&&file.name||'Конкурентный анализ.xlsx',
    mapping:{clusterColumn:clusterCol.letter,rentColumn:rentCol&&rentCol.letter||'',ratingColumn:ratingCol&&ratingCol.letter||''}
  };
}
class ManualXlsxCompetitiveProvider{
  constructor(config){this.config=config}
  async load(file){
    if(!file)throw new IntegrationUnavailableError('Загрузите XLSX-файл конкурентного анализа.','competitive-analysis');
    if(!/\.xlsx$/i.test(String(file.name||'')))throw new Phase0Error('Для конкурентного анализа нужен файл .xlsx.','COMPETITIVE_FILE_TYPE');
    if(!window.SlogiXlsx||typeof window.SlogiXlsx.readWorkbook!=='function')throw new Phase0Error('Не удалось загрузить модуль чтения Excel.','COMPETITIVE_XLSX_MODULE');
    const wb=await window.SlogiXlsx.readWorkbook(file);return parseManualCompetitiveWorkbook(wb,file,this.config);
  }
}
class PublishedCsvCompetitiveProvider{
  constructor(config){this.config=config}
  async load(){if(!this.config.url)throw new IntegrationUnavailableError('Источник конкурентного анализа не настроен.','competitive-analysis');const response=await fetch(this.config.url,{cache:'no-store'});if(!response.ok)throw new Phase0Error(`Источник конкурентного анализа вернул ошибку ${response.status}.`,'COMPETITIVE_HTTP_ERROR',{status:response.status});const raw=parseCsv(await response.text()),rows=raw.map(row=>mapCompetitiveRow(row,this.config.mapping||{})).filter(Boolean);return{rows,columns:raw.length?Object.keys(raw[0]):[],version:response.headers.get('etag')||response.headers.get('last-modified')||now(),sourceUrl:this.config.url}}
}
class BackendCompetitiveProvider{
  constructor(config){this.config=config}
  async load(){if(!this.config.endpoint)throw new IntegrationUnavailableError('Источник конкурентного анализа не настроен.','competitive-analysis');const response=await fetch(this.config.endpoint,{cache:'no-store'});if(!response.ok)throw new Phase0Error(`Источник конкурентного анализа вернул ошибку ${response.status}.`,'COMPETITIVE_HTTP_ERROR',{status:response.status});const payload=await response.json(),source=Array.isArray(payload)?payload:Array.isArray(payload.rows)?payload.rows:[];const rows=source.map(row=>row.clusterName||row.clusterId?{clusterId:String(row.clusterId||row.clusterName),clusterName:String(row.clusterName||row.clusterId),rating:competitiveNumber(row.rating),averageRentPerSqm:competitiveNumber(row.averageRentPerSqm),additional:Array.isArray(row.additional)?row.additional:[],raw:row.raw||clone(row)}:mapCompetitiveRow(row,this.config.mapping||{})).filter(Boolean);return{rows,columns:Array.isArray(payload.columns)?payload.columns:source.length?Object.keys(source[0]):[],version:payload.version||response.headers.get('etag')||now(),sourceUrl:this.config.endpoint}}
}
class CompetitiveAnalysisRepository{
  constructor(){this.config=CONFIG.competitiveAnalysis||{provider:'manualXlsx'};this.state=this.readCache();this.provider=this.createProvider()}
  createProvider(){if(this.config.provider==='manualXlsx')return new ManualXlsxCompetitiveProvider(this.config);if(this.config.provider==='googleSheet')return new GoogleSheetCompetitiveProvider(this.config);if(this.config.provider==='publishedCsv')return new PublishedCsvCompetitiveProvider(this.config);if(this.config.provider==='backend')return new BackendCompetitiveProvider(this.config);return null}
  isConnected(){return Boolean(this.provider)}
  readCache(){
    const saved=P.read().settings.phase0CompetitiveAnalysis||{},schema=Number(this.config.cacheSchemaVersion||1);
    if(Number(saved.cacheSchemaVersion||0)!==schema)return{status:'disconnected',rows:[],columns:[],columnSchema:null,lastSuccess:'',version:'',error:'',source:'',sheetName:this.config&&this.config.sheetName||'Свод',sourceUrl:'',fileName:''};
    const rows=Array.isArray(saved.rows)?saved.rows:[],lastSuccess=saved.lastSuccess||'';
    return{status:lastSuccess?'cached':'disconnected',rows,columns:Array.isArray(saved.columns)?saved.columns:[],columnSchema:saved.columnSchema||null,lastSuccess,version:saved.version||'',error:'',source:saved.source||'',sheetName:saved.sheetName||this.config&&this.config.sheetName||'Свод',sourceUrl:'',fileName:saved.fileName||''};
  }
  saveCache(result){
    const state=P.read();state.settings.phase0CompetitiveAnalysis={cacheSchemaVersion:Number(this.config.cacheSchemaVersion||1),rows:clone(result.rows||[]),columns:clone(result.columns||[]),columnSchema:clone(result.columnSchema||null),lastSuccess:result.syncedAt,version:result.version||'',source:this.config.provider,sheetName:result.sheetName||this.config.sheetName||'Свод',fileName:result.fileName||''};P.write(state,'phase0-competitive-cache');
  }
  snapshot(){const stale=Boolean(this.state.lastSuccess&&Date.now()-new Date(this.state.lastSuccess).getTime()>Number(this.config.staleAfterMs||2592000000));return Object.assign({},clone(this.state),{connected:this.isConnected(),stale})}
  rows(){return clone(this.state.rows||[])}
  metricFor(clusterId,clusterName){const rows=this.state.rows||[],idKey=clusterKey(clusterId),nameKey=clusterKey(clusterName);return rows.find(row=>Boolean((idKey&&(sameCluster(row.clusterId,idKey)||sameCluster(row.clusterName,idKey)))||(nameKey&&(sameCluster(row.clusterName,nameKey)||sameCluster(row.clusterId,nameKey)))))||null}
  async importFile(file){
    if(!this.provider||typeof this.provider.load!=='function'){this.state=Object.assign({},this.state,{status:'error',error:'Модуль загрузки конкурентного анализа недоступен.'});return this.snapshot()}
    this.state=Object.assign({},this.state,{status:'loading',error:''});
    try{
      const result=await this.provider.load(file),syncedAt=now();
      this.state={status:'success',rows:result.rows||[],columns:result.columns||[],columnSchema:result.columnSchema||null,lastSuccess:syncedAt,version:result.version||syncedAt,error:'',source:this.config.provider,sheetName:result.sheetName||this.config.sheetName||'Свод',sourceUrl:'',fileName:result.fileName||file&&file.name||''};
      this.saveCache({rows:this.state.rows,columns:this.state.columns,columnSchema:this.state.columnSchema,syncedAt,version:this.state.version,sheetName:this.state.sheetName,fileName:this.state.fileName});return this.snapshot();
    }catch(error){this.state=Object.assign({},this.state,{status:'error',error:error.message||'Не удалось прочитать файл конкурентного анализа.'});return this.snapshot()}
  }
  async refresh(){return this.snapshot()}
}

function metricForProject(project,competitiveRepository){return competitiveRepository.metricFor(project.clusterId,project.clusterName)||(project.phase0&&project.phase0.clusterSnapshot)||null}
function viewModel(project,competitiveRepository){
  const phase=Object.assign(defaultPhase0(),clone(project.phase0||{})),metric=metricForProject(project,competitiveRepository),perSqm=normalizeRentPeriod(phase.rent&&phase.rent.period)==='month'?rentPerSqm(project.area,phase.rent&&phase.rent.amount):null,average=metric&&nullableNumber(metric.averageRentPerSqm),deviation=deviationPercent(perSqm,average);
  return Object.assign({},clone(project),{phase0:phase,computed:{rentPerSqm:perSqm,averageRentPerSqm:average,deviationPercent:deviation,rating:metric&&nullableNumber(metric.rating),metric}});
}
function transitionRequirements(project,competitiveRepository){
  const vm=viewModel(project,competitiveRepository),phase=vm.phase0,missing=[];
  if(phase.status!==STATUS.SUITABLE)missing.push('установить статус «Подошло»');
  if(nullableNumber(vm.area)==null)missing.push('указать площадь');
  if(nullableNumber(phase.roomsCount)==null)missing.push('указать количество кабинетов');
  if(nullableNumber(vm.ceilingHeight)==null)missing.push('указать высоту потолков');
  if(vm.computed.rentPerSqm==null)missing.push('указать площадь и аренду для расчёта стоимости за 1 м²');
  if(!vm.clusterId&&!vm.clusterName)missing.push('определить кластер');
  CRITERIA_KEYS.forEach(key=>{if(phase.selectionCriteria[key]!==true)missing.push(`подтвердить критерий «${CRITERIA_LABELS[key]}»`)});
  if(!phase.layout||!phase.layout.received)missing.push('загрузить планировку');
  if(!phase.interest||!phase.interest.confirmed)missing.push('зафиксировать интерес');
  if(!phase.measurement||phase.measurement.status!=='Выполнен')missing.push('выполнить замер');
  else if(!phase.measurement.date)missing.push('указать дату выполненного замера');
  return{ready:missing.length===0,missing,view:vm};
}

class Phase0Service{
  constructor({projectRepository,competitiveRepository,fileService,auditService}){this.projects=projectRepository;this.competitive=competitiveRepository;this.files=fileService;this.audit=auditService}
  actor(){return P.actor()}
  buildCandidate(draft,existing){
    const base=existing&&existing.phase0?clone(existing.phase0):defaultPhase0(),stamp=now(),actor=this.actor(),status=STATUSES.includes(draft.status)?draft.status:STATUS.NO_ANSWER,listingUrl=String(draft.listingUrl||'').trim(),source=listingUrl?(detectListingSource(listingUrl)||'manual'):'manual';
    const existingGlobalStatus=String(existing&&(existing.status||existing.projectStatus)||''),globalStatus=STATUSES.includes(existingGlobalStatus)?(Number(existing&&existing.lifecyclePhase)>=1?'В работе':'Новый'):(existingGlobalStatus||'Новый');
    let rejection=base.rejection||null;
    if(status===STATUS.REJECTED){const reason=String(draft.rejectionReason||'').trim();if(!rejection||rejection.reason!==reason)rejection={reason,date:stamp,user:actor}}
    const confirmed=Boolean(draft.interestConfirmed),wasConfirmed=Boolean(base.interest&&base.interest.confirmed);
    const interest=confirmed===wasConfirmed?Object.assign({confirmed:false,confirmedAt:'',updatedAt:'',updatedBy:null},base.interest||{}):{confirmed,confirmedAt:confirmed?stamp:'',updatedAt:stamp,updatedBy:actor};
    const clusterId=String(draft.clusterId||''),geo=normalizeGeo({lat:draft.latitude,lng:draft.longitude});
    const clusterApi=window.SlogiPhase0&&window.SlogiPhase0.clusterService;let cluster=clusterApi?clusterApi.find(clusterId||draft.clusterName):null;
    if(!cluster&&geo&&clusterApi)cluster=clusterApi.findByCoordinates(geo.lat,geo.lng);
    if(!cluster&&geo&&clusterApi&&source!=='cian'&&clusterApi.findNearestByCoordinates)cluster=clusterApi.findNearestByCoordinates(geo.lat,geo.lng,6000);
    const phase0=Object.assign(defaultPhase0(),base,{
      source,listingUrl,canonicalUrl:normalizeUrl(draft.canonicalUrl||listingUrl),externalId:String(draft.externalId||base.externalId||''),listingTitle:String(draft.listingTitle||base.listingTitle||''),listingPublishedAt:String(draft.publishedAt||base.listingPublishedAt||''),listingUpdatedAt:String(draft.sourceUpdatedAt||base.listingUpdatedAt||''),listingAddedAt:String(base.listingAddedAt||draft.addedAt||stamp),parserWarnings:Array.isArray(draft.parserWarnings)?draft.parserWarnings.map(String).slice(0,20):Array.isArray(base.parserWarnings)?base.parserWarnings:[],floor:nullableNumber(draft.floor??base.floor),totalFloors:nullableNumber(draft.totalFloors??base.totalFloors),
      rent:{amount:nullableNumber(draft.rentMonthly),period:normalizeRentPeriod(draft.rentPeriod),currency:String(draft.rentCurrency||'RUB')},
      windowsCount:nullableNumber(draft.windowsCount),roomsCount:nullableNumber(draft.roomsCount),status,rejection,
      selectionCriteria:defaultCriteria(draft.selectionCriteria),interest,
      measurement:{status:MEASUREMENT_STATUSES.includes(draft.measurementStatus)?draft.measurementStatus:'Не назначен',date:String(draft.measurementDate||''),comment:String(draft.measurementComment||'').trim()},
      comments:String(draft.comments||'').trim(),updatedAt:stamp
    });
    const shared={
      address:String(draft.address||'').trim(),geo,clusterId:cluster?cluster.id:clusterId,clusterName:cluster?cluster.name:String(draft.clusterName||''),
      area:nullableNumber(draft.area),floor:nullableNumber(draft.floor??(existing&&existing.floor)),ceilingHeight:nullableNumber(draft.ceilingHeight),status:globalStatus,projectStatus:globalStatus,lifecyclePhase:existing&&existing.lifecyclePhase!=null?existing.lifecyclePhase:0
    };
    return Object.assign({},existing||{},shared,{phase0});
  }
  validate(candidate){
    const errors={};if(!candidate.address)errors.address='Укажите адрес объекта.';
    const phase=candidate.phase0;
    if(phase.status===STATUS.REJECTED&&!(phase.rejection&&phase.rejection.reason))errors.rejectionReason='Для статуса «Не подошло» укажите причину отказа.';
    if(['Запланирован','Выполнен'].includes(phase.measurement.status)&&!phase.measurement.date)errors.measurementDate='Укажите дату замера.';
    if(phase.listingUrl&&phase.source!=='cian')errors.listingUrl='Ссылка должна вести на объявление ЦИАН либо оставьте поле пустым.';
    return errors;
  }
  prepare(draft,existing){const candidate=this.buildCandidate(draft,existing);return{candidate,errors:this.validate(candidate),duplicates:this.projects.findDuplicates(candidate,existing&&existing.id||'')}}
  async save(draft,{projectId='',expectedRevision=null,layoutFile=null}={}){
    const before=projectId?this.projects.get(projectId):null,{candidate,errors,duplicates}=this.prepare(draft,before);
    if(Object.keys(errors).length)throw new Phase0Error('Проверьте поля формы.','VALIDATION_ERROR',{errors});
    if(duplicates.length)throw new Phase0Error('Похожий объект уже существует.','POTENTIAL_DUPLICATE',{duplicates});
    const shared={address:candidate.address,geo:candidate.geo,clusterId:candidate.clusterId,clusterName:candidate.clusterName,area:candidate.area,floor:candidate.floor,ceilingHeight:candidate.ceilingHeight,status:candidate.status,projectStatus:candidate.projectStatus,lifecyclePhase:candidate.lifecyclePhase};
    let saved=before?this.projects.update(before.id,shared,candidate.phase0,expectedRevision):this.projects.create(candidate);
    this.audit.recordSave(before,saved);
    if(layoutFile){
      try{
        const info=await this.files.saveLayout(saved.id,layoutFile),actor=this.actor();
        saved=this.projects.mutate(saved.id,project=>{project.phase0.layout={received:true,fileName:info.name,mime:info.mime,size:info.size,updatedAt:now(),updatedBy:actor};return project},saved.phase0.revision,'phase0-layout-save');
        this.audit.recordLayout(saved,info.name);
      }catch(error){throw new Phase0Error('Объект сохранён, но планировку загрузить не удалось. Повторите загрузку в карточке.','PARTIAL_FILE_SAVE',{project:saved,cause:error.message})}
    }
    const comp=this.competitive.snapshot();if(comp.rows&&comp.rows.length){this.applyCompetitiveRows(comp);saved=this.projects.get(saved.id)||saved}
    return saved;
  }
  findListingProject(listing){return this.projects.findByListing('cian',listing&&listing.externalId,listing&&listing.listingUrl)}
  async addMarketListing(listing){
    const existing=this.findListingProject(listing);if(existing)return{project:existing,created:false};
    const url=normalizeUrl(listing&&listing.listingUrl);if(!url||detectListingSource(url)!=='cian')throw new Phase0Error('Поддерживаются только сохранённые объявления ЦИАН.','LISTING_SOURCE_NOT_ALLOWED');
    let geo=normalizeGeo({lat:listing.latitude,lng:listing.longitude}),cluster=geo?clusterService.findByCoordinates(geo.lat,geo.lng):null;
    if(!cluster&&listing.clusterName)cluster=clusterService.find(listing.clusterName);
    if(!geo&&listing.address){
      const cacheKey='slogi_cian_geocode_cache_v1',id=String(listing.externalId||url),cache=(()=>{try{const value=JSON.parse(localStorage.getItem(cacheKey)||'{}');return value&&typeof value==='object'?value:{}}catch(_){return{}}})();
      const cached=cache[id];if(cached&&cached.geo)geo=normalizeGeo(cached.geo);
      if(!geo){try{const result=await geocodingService.geocode(listing.address);if(result&&result.geo){geo=normalizeGeo(result.geo);cache[id]={geo,updatedAt:now()};const entries=Object.entries(cache).slice(-50);localStorage.setItem(cacheKey,JSON.stringify(Object.fromEntries(entries)));}}catch(_){geo=null;}}
      if(geo)cluster=clusterService.findByCoordinates(geo.lat,geo.lng);
    }
    const result=await this.save({listingUrl:url,canonicalUrl:url,externalId:String(listing.externalId||''),listingTitle:String(listing.title||''),address:String(listing.address||''),latitude:geo&&geo.lat,longitude:geo&&geo.lng,clusterId:cluster&&cluster.id||'',clusterName:cluster&&cluster.name||'',area:listing.area,rentMonthly:listing.rentMonthly,rentPeriod:'month',rentCurrency:'RUB',floor:listing.floor,totalFloors:listing.totalFloors,ceilingHeight:listing.ceilingHeight,publishedAt:listing.publishedAt,sourceUpdatedAt:listing.sourceUpdatedAt,addedAt:now(),parserWarnings:listing.parseWarnings,status:STATUS.NO_ANSWER,selectionCriteria:defaultCriteria(),interestConfirmed:false,measurementStatus:'Не назначен'});
    return{project:result,created:true};
  }
  updateStatus(projectId,status,rejectionReason=''){
    if(!STATUSES.includes(status))throw new Phase0Error('Неизвестный статус объекта.','INVALID_STATUS');
    const current=this.projects.get(projectId);if(!current)throw new Phase0Error('Объект не найден.','PROJECT_NOT_FOUND');
    if(status===STATUS.REJECTED&&!String(rejectionReason||'').trim()&&!(current.phase0&&current.phase0.rejection&&current.phase0.rejection.reason))throw new Phase0Error('Для статуса «Не подошло» укажите причину отказа.','REJECTION_REASON_REQUIRED');
    const actor=this.actor(),stamp=now(),saved=this.projects.mutate(projectId,project=>{project.phase0=Object.assign(defaultPhase0(),project.phase0||{});project.phase0.status=status;if(status===STATUS.REJECTED){project.phase0.rejection={reason:String(rejectionReason||project.phase0.rejection&&project.phase0.rejection.reason||'').trim(),date:stamp,user:actor}}return project},current.phase0&&current.phase0.revision,'phase0-inline-status');
    this.audit.recordSave(current,saved);return saved;
  }
  applyCompetitiveRows(state){const changes=this.projects.applyCompetitiveMetrics(state.rows,{version:state.version,syncedAt:state.lastSuccess});changes.forEach(change=>this.audit.recordRating(change));return changes}
  readiness(project){return transitionRequirements(project,this.competitive)}
  markTransition(projectId){
    const current=this.projects.get(projectId);if(!current)throw new Phase0Error('Объект не найден.','PROJECT_NOT_FOUND');const gate=this.readiness(current);if(!gate.ready)throw new Phase0Error('Условия перехода к смете не выполнены.','PHASE1_BLOCKED',{missing:gate.missing});
    if(current.phase0&&current.phase0.transition&&Number(current.phase0.transition.toPhase)===1)return current;
    const actor=this.actor(),saved=this.projects.mutate(projectId,project=>{project.lifecyclePhase=1;if(!project.status||project.status==='Новый'||STATUSES.includes(project.status)){project.status='В работе';project.projectStatus='В работе'}project.phase0.transition={toPhase:1,at:now(),by:actor};return project},current.phase0.revision,'phase0-transition');this.audit.recordTransition(saved);return saved;
  }
}


class GeocodingService{
  constructor(){this.lastError=null}
  config(){return(window.SLOGI_PHASE0_CONFIG&&window.SLOGI_PHASE0_CONFIG.geocoding)||{}}
  edgeEndpoint(){
    const cfg=this.config(),projectCfg=window.SLOGI_PHASE0_CONFIG&&window.SLOGI_PHASE0_CONFIG.supabase||{};let endpoint,project;
    try{endpoint=new URL(String(cfg.endpoint||''));project=new URL(String(projectCfg.url||''));}catch(_error){throw new Phase0Error('Серверный геокодер не настроен.','GEOCODER_PROXY_MISSING')}
    if(project.protocol!=='https:'||project.username||project.password||project.search||project.hash||!/^\/?$/.test(project.pathname)||endpoint.protocol!=='https:'||endpoint.origin!==project.origin||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/functions/v1/geocode-address')throw new Phase0Error('Серверный геокодер не прошёл проверку проекта.','GEOCODER_PROXY_UNTRUSTED');
    return endpoint.toString()
  }
  queryVariants(value){
    const raw=String(value||'').trim();if(!raw)return[];const variants=[];const push=v=>{v=String(v||'').replace(/\s+/g,' ').replace(/\s*,\s*/g,', ').trim();if(v&&!variants.includes(v))variants.push(v)};
    push(raw);
    const noNoise=raw.replace(/,\s*(?:ЦАО|САО|СВАО|ВАО|ЮВАО|ЮАО|ЮЗАО|ЗАО|СЗАО|ЗелАО|ТАО|НАО)\s*,?/gi,', ').replace(/,\s*р-н\s+[^,]+,?/gi,', ').replace(/,\s*м\.\s*[^,]+,?/gi,', ');push(noNoise);
    [raw,noNoise].forEach(base=>{
      push(base.replace(/(\d[0-9\/]*)\s*с\s*(\d+)\b/gi,'$1 строение $2'));
      push(base.replace(/(\d[0-9\/]*)\s*с\s*(\d+)\b/gi,'$1 корпус $2'));
      push(base.replace(/(\d[0-9\/]*)\s*к\s*(\d+)\b/gi,'$1 корпус $2'));
      push(base.replace(/(\d[0-9\/]*)\s*корп(?:ус)?\.?\s*(\d+)\b/gi,'$1 корпус $2'));
    });
    const hasRegion=/(москва|московск|санкт-петербург|ленинградск)/i.test(raw);if(!hasRegion)[...variants].forEach(v=>{push(`Москва, ${v}`);push(`Московская область, ${v}`)});
    return variants;
  }
  parsePayload(payload,query){
    const collection=payload&&payload.response&&payload.response.GeoObjectCollection;
    const members=collection&&Array.isArray(collection.featureMember)?collection.featureMember:[];
    return members.map(item=>{
      const obj=item&&item.GeoObject||{},meta=obj.metaDataProperty&&obj.metaDataProperty.GeocoderMetaData||{},pos=obj.Point&&obj.Point.pos||'';
      const parts=String(pos).trim().split(/\s+/).map(Number);if(parts.length<2||!Number.isFinite(parts[0])||!Number.isFinite(parts[1]))return null;
      const lng=parts[0],lat=parts[1];
      const formatted=meta.Address&&meta.Address.formatted||meta.text||[obj.description,obj.name].filter(Boolean).join(', ')||query;
      const precision=meta.precision||'';
      return{address:String(formatted||query),geo:{lat,lng},precision,raw:obj};
    }).filter(Boolean);
  }
  async fetchJson(url,options={}){
    const timeout=Number(this.config().timeoutMs)||12000,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const response=await fetch(url,Object.assign({cache:'no-store',signal:controller.signal,headers:{'Accept':'application/json'}},options));
      let payload=null;try{payload=await response.json()}catch(_){payload=null}
      if(!response.ok){const message=payload&&payload.message||`HTTP ${response.status}`;const error=new Phase0Error(`API Геокодера: ${message}`,'GEOCODER_HTTP_ERROR',{status:response.status,payload});throw error}
      return payload;
    }finally{clearTimeout(timer)}
  }
  async server(query){
    const cfg=this.config(),endpoint=this.edgeEndpoint();
    const payload=await this.fetchJson(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({address:query,ll:cfg.searchCenter||'',spn:cfg.searchSpan||''})});
    if(payload&&Array.isArray(payload.results))return payload.results.map(item=>({address:String(item.address||query),geo:{lat:Number(item.lat),lng:Number(item.lng)},precision:item.precision||'',raw:item.raw||null})).filter(item=>Number.isFinite(item.geo.lat)&&Number.isFinite(item.geo.lng));
    if(payload&&payload.data&&payload.data.geo)return[{address:String(payload.data.address||query),geo:payload.data.geo,precision:payload.data.precision||'',raw:payload.data.raw||null}];return[];
  }
  choose(candidates){let fallback=null;for(const candidate of candidates||[]){if(!candidate||!candidate.geo)continue;if(!fallback)fallback=candidate;const match=clusterService.findByCoordinates(candidate.geo.lat,candidate.geo.lng)||clusterService.findNearestByCoordinates(candidate.geo.lat,candidate.geo.lng,6000);if(match)return Object.assign(candidate,{cluster:match})}return fallback}
  async geocode(address){
    const value=String(address||'').trim();if(value.length<5)return null;this.lastError=null;const errors=[];
    for(const query of this.queryVariants(value)){
      let candidates=[];
      try{candidates=await this.server(query)}catch(error){errors.push(error)}
      const selected=this.choose(candidates);if(selected)return selected;
    }
    const last=errors[errors.length-1];this.lastError=last||new Phase0Error('Адрес не найден API Геокодера.','GEOCODER_NOT_FOUND');
    if(last)throw last;return null;
  }
}
class MapService{
  constructor({containerId,loadingId,messageId,onSelect,onHover,onCluster}){this.containerId=containerId;this.loadingId=loadingId;this.messageId=messageId;this.onSelect=onSelect||(()=>{});this.onHover=onHover||(()=>{});this.onCluster=onCluster||(()=>{});this.map=null;this.markers=new Map();this.polygons=[];this.clustersVisible=false;this.ready=false;this.selectedId='';this.pendingFocusId=''}
  loadYandex(){return new Promise((resolve,reject)=>{if(window.ymaps)return ymaps.ready(resolve);const key=window.SLOGI_CONFIG&&window.SLOGI_CONFIG.yandexMapsApiKey,s=document.createElement('script');s.src='https://api-maps.yandex.ru/2.1/?lang=ru_RU'+(key?'&apikey='+encodeURIComponent(key):'');s.async=true;s.onload=()=>ymaps.ready(resolve);s.onerror=()=>reject(new Error('Не удалось загрузить API Яндекс Карт.'));document.head.appendChild(s);setTimeout(()=>reject(new Error('Превышено время загрузки Яндекс Карт.')),15000)})}
  featureCoords(feature){const geometry=feature.geometry||{},convert=ring=>ring.map(point=>[point[1],point[0]]);if(geometry.type==='Polygon')return geometry.coordinates.map(convert);if(geometry.type==='MultiPolygon')return geometry.coordinates.map(poly=>poly.map(convert));return null}
  async init(features=[]){
    const loading=document.getElementById(this.loadingId),message=document.getElementById(this.messageId);
    try{await this.loadYandex();this.map=new ymaps.Map(this.containerId,{center:[55.7558,37.6176],zoom:10,controls:['zoomControl','fullscreenControl']},{suppressMapOpenBlock:true});
      features.forEach(feature=>{const name=feature.properties&&feature.properties.name,coords=this.featureCoords(feature);if(!name||!coords)return;const add=geometry=>{const polygon=new ymaps.Polygon(geometry,{hintContent:name,clusterName:name},{fillColor:'#4B6E73',strokeColor:'#37545A',strokeWidth:1.5,fillOpacity:.14});polygon.events.add('click',()=>this.onCluster(name));this.map.geoObjects.add(polygon);this.polygons.push(polygon)};if(feature.geometry.type==='Polygon')add(coords);else coords.forEach(add)});
      this.ready=true;if(loading)loading.hidden=true;if(message)message.textContent='Выберите точку или карточку, чтобы связать объект со списком.';
    }catch(error){if(loading)loading.innerHTML=`<strong>Карта временно недоступна</strong><span>${esc(error.message)} Список помещений продолжает работать.</span>`;if(message)message.textContent='Проверьте ключ API и разрешённый домен.';throw error}
  }
  clearMarkers(){this.markers.forEach(marker=>this.map&&this.map.geoObjects.remove(marker));this.markers.clear()}
  setProjects(projects){if(!this.ready)return;this.clearMarkers();const labelLayout=ymaps.templateLayoutFactory.createClass('<div class="phase0-map-marker $[properties.markerClass]"><span class="phase0-map-marker-pin"></span><span class="phase0-map-marker-label">$[properties.iconCaption]</span></div>');projects.forEach(project=>{const geo=projectGeo(project);if(!geo)return;const c=project.computed||{},phase=project.phase0||{},rating=c.rating==null?'Рейтинг не определён':`Рейтинг: ${c.rating}`,caption=String(project.address||'Объект').replace(/^Москва,\s*/i,'').slice(0,64);
      const body=`<div class="phase0-balloon"><strong>${esc(project.address||'Объект')}</strong><span>${esc(project.clusterName||'Кластер не определён')}</span><span>${esc(rating)} · ${esc(project.area==null?'Площадь: нет данных':`Площадь: ${project.area} м²`)}</span><span>${esc(phase.rent&&phase.rent.amount==null?'Аренда: нет данных':`Аренда: ${Math.round(phase.rent.amount).toLocaleString('ru-RU')} ₽/мес.`)}</span><a href="index.html?location=${encodeURIComponent(project.id)}">Открыть объект</a></div>`;
      const marker=new ymaps.Placemark([geo.lat,geo.lng],{hintContent:project.address||'Объект',balloonContent:body,iconCaption:esc(caption),markerClass:''},{iconLayout:labelLayout,iconShape:{type:'Rectangle',coordinates:[[-12,-14],[260,28]]},zIndex:650});marker.events.add('mouseenter',()=>this.onHover(project.id));marker.events.add('mouseleave',()=>this.onHover(''));marker.events.add('click',()=>this.onSelect(project.id));this.map.geoObjects.add(marker);this.markers.set(String(project.id),marker)});this.setSelected(this.selectedId);if(this.pendingFocusId){const pending=this.pendingFocusId;this.pendingFocusId='';setTimeout(()=>this.focus(pending),0)}}
  setSelected(id){this.selectedId=String(id||'');this.markers.forEach((marker,key)=>{marker.properties.set('markerClass',key===this.selectedId?'selected':'');marker.options.set('zIndex',key===this.selectedId?900:650)})}
  focus(id){const marker=this.markers.get(String(id));if(!marker||!this.map){this.pendingFocusId=String(id||'');this.setSelected(id);return}this.pendingFocusId='';this.setSelected(id);const coords=marker.geometry.getCoordinates();this.map.panTo(coords,{flying:false,duration:220}).then(()=>marker.balloon.open()).catch(()=>marker.balloon.open())}
  setClustersVisible(visible){this.clustersVisible=Boolean(visible);this.polygons.forEach(polygon=>polygon&&polygon.options&&polygon.options.set('visible',this.clustersVisible));return this.clustersVisible}
  invalidate(){if(this.map&&this.map.container)this.map.container.fitToViewport()}
}

const projectRepository=new ProjectRepository();
const competitiveRepository=new CompetitiveAnalysisRepository();
const clusterService=new ClusterService();
const auditService=new AuditService();
const fileService=new FileService();
const listingImportService=new ListingImportService();
const geocodingService=new GeocodingService();
const phase0Service=new Phase0Service({projectRepository,competitiveRepository,fileService,auditService});

window.SlogiPhase0={
  STATUS,STATUSES,MEASUREMENT_STATUSES,CRITERIA_KEYS,CRITERIA_LABELS,
  ProjectRepository,Phase0Service,ListingImportService,CianListingProvider,ClusterService,CompetitiveAnalysisRepository,MapService,GeocodingService,FileService,AuditService,
  projectRepository,competitiveRepository,clusterService,auditService,fileService,listingImportService,geocodingService,phase0Service,
  defaultPhase0,normalizeGeo,nullableNumber,rentPerSqm,deviationPercent,metricForProject,viewModel,transitionRequirements,sourceLabel,detectListingSource,normalizeRentPeriod,canonicalListingFetchUrl,esc,norm,round,clone
};
})();
