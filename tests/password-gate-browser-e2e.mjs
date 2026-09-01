import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const scriptRoot=dirname(dirname(fileURLToPath(import.meta.url)));
const root=resolve(String(process.env.SLOGI_BROWSER_ROOT||scriptRoot));
const chromePath=String(process.env.SLOGI_LOCAL_CHROME||'');
const nodeModules=String(process.env.SLOGI_NODE_MODULES||'');
const visualStage=String(process.env.SLOGI_VISUAL_STAGE||'').trim();
const visualOutput=String(process.env.SLOGI_VISUAL_OUTPUT||'').trim();
assert.ok(chromePath&&nodeModules,'browser_runtime_missing');
const {chromium}=await import(pathToFileURL(join(nodeModules,'playwright','index.mjs')).href);

const apiUrl='https://fixture.supabase.local';
const publishableKey='fixture-publishable-key-with-safe-length';
const canonicalWorkspace='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const syntheticPassword=randomUUID()+randomUUID();
const grantKey='slogi_device_grant_v1';
const configSource=`window.SLOGI_PHASE0_CONFIG=${JSON.stringify({
  supabase:{url:apiUrl,publishableKey},
  listingSearch:{endpoint:apiUrl+'/functions/v1/search-listings',limit:50,timeoutMs:30000},
  geocoding:{endpoint:apiUrl+'/functions/v1/geocode-address',timeoutMs:12000},
  sharedWorkspace:{
    passwordGateEndpoint:apiUrl+'/functions/v1/password-gate',
    sessionStorageKey:'slogi_anonymous_session_v1',
    grantStorageKey:grantKey,
    connectionStorageKey:'slogi_shared_workspace_connection_v1',
    stateCacheKey:'slogi_shared_workspace_cache_v1',
  },
})};`;
const snapshot=new Date().toISOString();
const freshnessCutoff=new Date(new Date(snapshot).getTime()-30*86400000).toISOString();
const freshness=new Date(Date.now()-86400000).toISOString();
const cianListing=id=>({
  source:'cian',externalId:String(id),listingUrl:`https://www.cian.ru/rent/commercial/${id}`,
  title:`Офисное помещение ${id}`,address:id>51?'':`Москва, Митино, тестовый адрес, ${id}`,
  latitude:id>51?null:55.84+(id%5)*0.0001,longitude:id>51?null:37.36+(id%7)*0.0001,
  area:100+((id-1)%51),rentMonthly:300000+id*1000,pricePerSquareMeter:3000,premiseType:'office',hasBasementOrSocle:false,
  floor:1,totalFloors:5,ceilingHeight:3.2,firstSeenAt:new Date(new Date(snapshot).getTime()-id*1000).toISOString(),freshnessAt:freshness,freshnessKind:'published',
  publishedAt:freshness,marketStatus:'active',clusterName:id>51?'':'Митино',parseCompleteness:1,parseWarnings:[],
});
const listingPages={1:Array.from({length:50},(_,index)=>cianListing(index+1)),2:[cianListing(51),cianListing(52),cianListing(53)]};

function installMapFixture(){
  window.__slogiFixturePolygonCount=0;
  window.__slogiFixtureMarkerCount=0;
  class Events{constructor(){this.handlers=new Map();}add(name,handler){if(!this.handlers.has(name))this.handlers.set(name,[]);this.handlers.get(name).push(handler);}emit(name){(this.handlers.get(name)||[]).forEach(handler=>handler());}removeAll(){this.handlers.clear();}}
  class Options{constructor(initial={}){this.value={...initial};}set(name,value){if(name&&typeof name==='object')Object.assign(this.value,name);else this.value[name]=value;}}
  class Properties{constructor(initial={}){this.value={...initial};}set(name,value){this.value[name]=value;}}
  class GeoObjects{constructor(){this.items=[];}add(item){this.items.push(item);return this;}remove(item){this.items=this.items.filter(value=>value!==item);return this;}}
  class FakeMap{constructor(container){this.container={fitToViewport(){}};this.geoObjects=new GeoObjects();this.behaviors={disable(){}};this.node=typeof container==='string'?document.getElementById(container):container;if(this.node)this.node.dataset.fixtureMap='ready';}setBounds(){return Promise.resolve();}panTo(coords){if(this.node)this.node.dataset.lastPan=coords.join(',');return Promise.resolve();}}
  class Placemark{constructor(coords,properties={},options={}){this.geometry={getCoordinates:()=>coords};this.properties=new Properties(properties);this.options=new Options(options);this.events=new Events();this.balloon={open(){}};}}
  class Polygon{constructor(coords,properties={},options={}){this.coords=coords;this.properties=new Properties(properties);this.options=new Options(options);this.events=new Events();window.__slogiFixturePolygonCount+=1;}}
  class Clusterer{constructor(){this.items=[];}add(items){this.items.push(...items);window.__slogiFixtureMarkerCount=this.items.length;const node=document.getElementById('cian-map');if(node)items.slice(0,3).forEach((item,index)=>{const button=document.createElement('button');button.type='button';button.className='fixture-map-marker';button.setAttribute('aria-label',`Тестовый маркер ${index+1}`);button.textContent=`● ${index+1}`;button.addEventListener('click',()=>item.events.emit('click'));node.appendChild(button);});}removeAll(){this.items=[];window.__slogiFixtureMarkerCount=0;document.querySelectorAll('.fixture-map-marker').forEach(node=>node.remove());}getBounds(){if(!this.items.length)return null;const coords=this.items.map(item=>item.geometry.getCoordinates());return[[Math.min(...coords.map(point=>point[0])),Math.min(...coords.map(point=>point[1]))],[Math.max(...coords.map(point=>point[0])),Math.max(...coords.map(point=>point[1]))]];}}
  window.ymaps={ready:callback=>callback(),Map:FakeMap,Placemark,Polygon,Clusterer,templateLayoutFactory:{createClass:()=>function(){}}};
}

const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
function fixtureServer(){
  return new Promise((resolve,reject)=>{
    const server=createServer(async(request,response)=>{
      const pathname=decodeURIComponent(new URL(request.url||'/', 'http://127.0.0.1').pathname);
      const relative=pathname==='/'?'team.html':pathname.slice(1);
      const target=normalize(join(root,relative));
      if(!target.startsWith(normalize(root))){response.writeHead(404).end();return;}
      try{
        const bytes=await readFile(target);
        response.writeHead(200,{'Content-Type':mime[extname(target)]||'application/octet-stream','Cache-Control':'no-store'});
        response.end(bytes);
      }catch{response.writeHead(404).end();}
    });
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>resolve(server));
  });
}

let remoteState={locations:[],workspace:{trash:{projects:[]},activity:[],notifications:[]}};
let revision=0;
const grants=new Map();
const users=new Map();

function json(route,value,status=200,headers={}){
  return route.fulfill({status,headers:{'content-type':'application/json',...headers},body:JSON.stringify(value)});
}
async function mockSupabase(route,identity){
  const request=route.request(),url=new URL(request.url()),path=url.pathname,headers=request.headers();
  if(path==='/auth/v1/signup')return json(route,{access_token:'access-'+identity.id,refresh_token:'refresh-'+identity.id,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:identity.id,is_anonymous:true}});
  if(path==='/auth/v1/user')return json(route,{id:identity.id,is_anonymous:true});
  if(path==='/auth/v1/token')return json(route,{access_token:'access-'+identity.id,refresh_token:'refresh-'+identity.id,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:identity.id,is_anonymous:true}});
  const supplied=String(headers['x-slogi-device-grant']||'');
  const record=grants.get(supplied);
  const valid=record&&record.userId===identity.id&&record.active&&new Date(record.expiresAt).getTime()>Date.now();
  if(path==='/functions/v1/password-gate'){
    identity.transportChecks+=1;
    assert.equal(url.protocol,'https:','browser password gate must use direct HTTPS');
    assert.equal(url.host,new URL(apiUrl).host,'browser password gate must use the configured Supabase host');
    const body=request.postDataJSON();
    if(body.action==='challenge')return json(route,{status:'challenge',challenge:'c'.repeat(43),expiresAt:new Date(Date.now()+300000).toISOString()});
    if(body.action==='status')return valid
      ?json(route,{status:'granted',expiresAt:record.expiresAt,version:record.version})
      :json(route,{status:'access_denied'},401);
    if(body.action==='unlock'){
      identity.unlockRequests+=1;
      const attempts=Number(users.get(identity.id)||0)+1;users.set(identity.id,attempts);
      if(body.password!==syntheticPassword){
        if(attempts>=3)return json(route,{status:'cooldown',retryAfter:2},429,{'retry-after':'2'});
        return json(route,{status:'access_denied'},401);
      }
      users.set(identity.id,0);
      const grant='fixture-grant-'+randomUUID();
      const expiresAt=new Date(Date.now()+86400000).toISOString();
      grants.set(grant,{userId:identity.id,active:true,expiresAt,version:1});
      return json(route,{status:'granted',grant,expiresAt,version:1});
    }
    if(body.action==='revoke'&&valid){record.active=false;return json(route,{status:'revoked'});}
    return json(route,{status:'access_denied'},401);
  }
  identity.requests.push({path,valid:Boolean(valid)});
  if(!valid)return json(route,{message:'access_denied'},401);
  if(path==='/rest/v1/slogi_shared_workspace_members')return json(route,[{workspace_id:canonicalWorkspace}]);
  if(path==='/rest/v1/slogi_shared_workspace_state')return json(route,[{state:remoteState,revision,updated_at:new Date().toISOString()}]);
  if(path==='/rest/v1/rpc/slogi_update_shared_workspace_state'){
    const body=request.postDataJSON();
    if(body.p_expected_revision!==revision)return json(route,{code:'PT409',message:'workspace_revision_conflict'},409);
    remoteState=body.p_state;revision+=1;
    return json(route,[{workspace_id:canonicalWorkspace,state:remoteState,revision,updated_at:new Date().toISOString()}]);
  }
  if(path==='/functions/v1/search-listings'){
    const body=request.postDataJSON(),page=Number(body.page)||1,items=listingPages[page]||[];
    assert.equal(body.areaMin,100);assert.equal(body.areaMax,150);assert.equal(body.floor,1);assert.deepEqual(body.premiseTypes,['office','retail','free_purpose']);
    if(page===2)assert.deepEqual(body.cursor,{firstSeenAt:listingPages[1].at(-1).firstSeenAt,source:'cian',listingUrl:listingPages[1].at(-1).listingUrl});
    identity.searchPages.push(page);
    const hasMore=page===1,last=items.at(-1);return json(route,{items,meta:{sources:{cian:{status:'ok',lastSucceededAt:snapshot}},page,limit:Number(body.limit)||50,total:53,returned:items.length,hasMore,nextPage:hasMore?2:null,nextCursor:hasMore?{firstSeenAt:last.firstSeenAt,source:last.source,listingUrl:last.listingUrl}:null,snapshotAt:snapshot,freshnessCutoff}});
  }
  if(path==='/functions/v1/geocode-address')return json(route,{results:[],diagnostic:{status:'not_found',cacheHit:false,attempts:1}});
  if(path==='/functions/v1/import-listing')return json(route,{ok:true});
  if(path.startsWith('/storage/v1/'))return json(route,{ok:true});
  return json(route,{message:'not_found'},404);
}

async function openDevice(browser,origin,viewport,seedGrant){
  const identity={id:randomUUID(),requests:[],unlockRequests:0,searchPages:[],transportChecks:0};
  const context=await browser.newContext({viewport,locale:'ru-RU'});
  await context.addInitScript(installMapFixture);
  if(seedGrant)await context.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:grantKey,value:seedGrant});
  await context.route('**/phase0-config.js*',route=>route.fulfill({status:200,contentType:'application/javascript',body:configSource}));
  await context.route(apiUrl+'/**',route=>mockSupabase(route,identity));
  await context.route('https://fonts.googleapis.com/**',route=>route.abort('blockedbyclient'));
  await context.route('https://fonts.gstatic.com/**',route=>route.abort('blockedbyclient'));
  const page=await context.newPage(),issues=[];
  page.on('pageerror',error=>issues.push('pageerror:'+error.message));
  page.on('console',entry=>{
    if(entry.type()==='error'&&!/Failed to load resource: the server responded with a status of (401|429)/.test(entry.text()))issues.push('console:'+entry.text());
  });
  await page.goto(origin+'/team.html',{waitUntil:'domcontentloaded'});
  return{context,page,identity,issues};
}

async function unlock(device,password=syntheticPassword){
  const dialog=device.page.getByRole('dialog',{name:'Доступ к SLOGI'});
  await dialog.waitFor();
  const input=device.page.locator('#slogi-gate-password');
  await input.fill(password);
  const before=device.identity.unlockRequests;
  await dialog.getByRole('button',{name:'Открыть SLOGI'}).click();
  await device.page.waitForFunction(()=>window.SlogiCloud?.ready===true);
  assert.equal(device.identity.unlockRequests-before,1,'one click must issue exactly one unlock request');
  assert.equal(await input.inputValue(),'');
}

async function assertAvailableSpace(device,label){
  await device.page.goto(device.page.url().replace(/\/[^/]*$/,'/available-spaces.html'),{waitUntil:'domcontentloaded'});
  await device.page.waitForFunction(()=>window.SlogiCloud?.ready===true);
  await device.page.evaluate(async()=>{localStorage.removeItem('slogi_cian_hidden_listing_ids_v1');const state=window.SlogiPro.read();state.settings.cianHiddenListingIds=[];window.SlogiPro.write(state,'fixture-listing-reset');await window.SlogiCloud.sync();});
  await device.page.reload({waitUntil:'domcontentloaded'});
  try{await device.page.waitForFunction(()=>document.querySelectorAll('[data-listing-card]').length===53&&document.querySelector('#cian-map-count')?.textContent?.includes('51 из 53'));}
  catch(error){const diagnostic=await device.page.evaluate(()=>({cards:document.querySelectorAll('[data-listing-card]').length,map:document.querySelector('#cian-map-count')?.textContent,summary:document.querySelector('#available-summary')?.textContent,source:document.querySelector('#cian-source-state')?.textContent,htmlAccess:document.documentElement.dataset.slogiAccess}));throw new Error(`${label}: search did not settle ${JSON.stringify({diagnostic,issues:device.issues,pages:device.identity.searchPages})}`,{cause:error});}
  const metrics=await device.page.evaluate(()=>{
    const cards=[...document.querySelectorAll('[data-listing-card]')];
    const h1=Number.parseFloat(getComputedStyle(document.querySelector('.cian-hero h1')).fontSize);
    const ruleHeading=Number.parseFloat(getComputedStyle(document.querySelector('.cian-parse-rules-copy strong')).fontSize);
    return{
      cards:cards.length,unique:new Set(cards.map(card=>card.dataset.listingCard)).size,
      mapCount:document.querySelector('#cian-map-count')?.textContent,
      missing:document.querySelector('#cian-map-missing')?.textContent,
      noAddress:document.querySelector('#cian-map-no-address')?.textContent,
      markers:window.__slogiFixtureMarkerCount,polygons:window.__slogiFixturePolygonCount,
      headerHeight:document.querySelector('.site-header').getBoundingClientRect().height,
      h1,ruleHeading,invites:[...document.querySelectorAll('button,a,dialog')].some(node=>/приглас|личный кабинет|регистрац|войти/i.test(node.textContent||'')),
      overflow:Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth,document.body.scrollWidth-document.body.clientWidth),
    };
  });
  assert.equal(metrics.cards,53,label+': all listings');assert.equal(metrics.unique,53,label+': unique listings');
  assert.equal(metrics.mapCount,'51 из 53 на карте',label+': honest map count');assert.equal(metrics.missing,'Без координат: 2',label+': honest missing count');assert.equal(metrics.noAddress,'Без адреса: 2',label+': honest missing-address count');
  assert.equal(metrics.markers,51,label+': all coordinate-capable markers');assert.equal(metrics.polygons,58,label+': canonical polygons');
  assert.ok(metrics.headerHeight<=80,label+': compact header');assert.ok(metrics.ruleHeading<metrics.h1,label+': parsing-rule hierarchy');
  assert.equal(metrics.invites,false,label+': legacy access UI');assert.equal(metrics.overflow,0,label+': horizontal overflow');
  assert.deepEqual(device.identity.searchPages.slice(-2),[1,2],label+': complete pagination');
  await device.page.locator('.fixture-map-marker').first().click();
  assert.equal(await device.page.locator('[data-listing-card].selected').count(),1,label+': marker/card sync');
  await device.page.locator('#available-add-space').click();
  const manualCard=device.page.getByRole('dialog',{name:'Карточка помещения'});await manualCard.waitFor();
  assert.equal(await manualCard.getByRole('button',{name:'Взять в работу'}).isDisabled(),true,label+': incomplete manual card is blocked');
  const modalMetrics=await manualCard.evaluate(node=>{const rect=node.getBoundingClientRect(),buttons=[...node.querySelectorAll('button')].filter(button=>getComputedStyle(button).display!=='none');return{left:rect.left,right:rect.right,width:rect.width,viewport:document.documentElement.clientWidth,overflow:Math.max(0,node.scrollWidth-node.clientWidth),font:Number.parseFloat(getComputedStyle(node).fontSize),shortButtons:buttons.filter(button=>button.getBoundingClientRect().height<43.5).map(button=>button.textContent.trim())};});
  assert.ok(modalMetrics.left>=-1&&modalMetrics.right<=modalMetrics.viewport+1,label+': modal fits viewport');assert.equal(modalMetrics.overflow,0,label+': modal horizontal overflow');assert.ok(modalMetrics.font>=16,label+': modal readable font');assert.deepEqual(modalMetrics.shortButtons,[],label+': modal touch targets');
  await manualCard.getByRole('button',{name:'Закрыть карточку'}).click();
  await device.page.locator('.cian-card-open').first().click();
  const parsedCard=device.page.getByRole('dialog',{name:'Карточка помещения'});await parsedCard.waitFor();
  assert.match(await parsedCard.locator('[name="address"]').inputValue(),/Москва/);assert.equal(await parsedCard.getByRole('button',{name:'Взять в работу'}).isDisabled(),true,label+': incomplete parsed card is blocked');
  await parsedCard.getByRole('button',{name:'Закрыть карточку'}).click();
  const removedId=await device.page.locator('[data-listing-card]').first().getAttribute('data-listing-card');
  device.page.once('dialog',dialog=>dialog.accept());
  await device.page.locator('.cian-remove-listing').first().click();
  await device.page.waitForFunction(()=>document.querySelectorAll('[data-listing-card]').length===52&&window.__slogiFixtureMarkerCount===50);
  assert.equal(await device.page.evaluate(id=>JSON.parse(localStorage.getItem('slogi_cian_hidden_listing_ids_v1')||'[]').includes(id),removedId),true,label+': stable hidden listing id');
  assert.equal(await device.page.evaluate(id=>(window.SlogiPro.read().settings.cianHiddenListingIds||[]).includes(id),removedId),true,label+': shared hidden listing id');
  await device.page.reload({waitUntil:'domcontentloaded'});
  await device.page.waitForFunction(()=>document.querySelectorAll('[data-listing-card]').length===52&&window.__slogiFixtureMarkerCount===50);
  await device.page.evaluate(async id=>{localStorage.removeItem('slogi_cian_hidden_listing_ids_v1');const state=window.SlogiPro.read();state.settings.cianHiddenListingIds=(state.settings.cianHiddenListingIds||[]).filter(value=>value!==id);window.SlogiPro.write(state,'fixture-listing-restore');await window.SlogiCloud.sync();},removedId);
  await device.page.reload({waitUntil:'domcontentloaded'});
  await device.page.waitForFunction(()=>document.querySelectorAll('[data-listing-card]').length===53&&window.__slogiFixtureMarkerCount===51);
}

async function seedLayoutProjects(device){
  await device.page.evaluate(async()=>{
    const S=window.SlogiPhase0,stamp=new Date().toISOString(),criteria=Object.fromEntries(S.CRITERIA_KEYS.map(key=>[key,true]));
    const phase=(overrides={})=>Object.assign(S.defaultPhase0(),{
      source:'manual',listingAddedAt:stamp,rent:{amount:420000,period:'month',currency:'RUB'},roomsCount:8,windowsCount:10,
      status:S.STATUS.SUITABLE,selectionCriteria:criteria,layout:{received:true,fileName:'plan.pdf',mime:'application/pdf',size:1024,updatedAt:stamp,updatedBy:'fixture'},
      interest:{confirmed:true,confirmedAt:stamp,updatedAt:stamp,updatedBy:'fixture'},measurement:{status:'Выполнен',date:stamp.slice(0,10),comment:''}
    },overrides);
    const projects=[
      {id:'layout-ready',address:'Москва, Петровский бульвар, 12',area:186,ceilingHeight:3.4,clusterId:'mitino',clusterName:'Митино',geo:{lat:55.842,lng:37.362},stage:4,lifecyclePhase:2,createdAt:stamp,updatedAt:stamp,phase0:phase()},
      {id:'layout-partial',address:'Москва, Большая Дмитровка, 7',area:124,ceilingHeight:null,clusterId:'mitino',clusterName:'Митино',geo:{lat:55.843,lng:37.364},stage:1,lifecyclePhase:0,createdAt:stamp,updatedAt:stamp,phase0:phase({status:S.STATUS.ANALYSING,selectionCriteria:Object.fromEntries(S.CRITERIA_KEYS.map(key=>[key,null])),layout:{received:false,fileName:'',mime:'',size:null,updatedAt:'',updatedBy:null},interest:{confirmed:false,confirmedAt:'',updatedAt:'',updatedBy:null},measurement:{status:'Не назначен',date:'',comment:''}})},
      {id:'layout-rejected',address:'Москва, Улица Свободы, 18',area:98,ceilingHeight:3.1,clusterId:'mitino',clusterName:'Митино',geo:{lat:55.844,lng:37.366},stage:1,lifecyclePhase:0,createdAt:stamp,updatedAt:stamp,phase0:phase({status:S.STATUS.REJECTED,rejection:{reason:'Не подходит по условиям тестового сценария',date:stamp,user:'fixture'}})}
    ];
    localStorage.setItem('slogi_locations_v1',JSON.stringify(projects));
    window.dispatchEvent(new CustomEvent('slogi:locations-updated',{detail:{source:'layout-fixture'}}));
    await window.SlogiCloud.sync();
  });
}

async function navigateAuditPage(device,origin,path,kind){
  await device.page.goto(origin+path,{waitUntil:'domcontentloaded'});
  await device.page.waitForFunction(()=>window.SlogiCloud?.ready===true);
  if(kind==='search')await device.page.waitForFunction(()=>document.querySelectorAll('[data-listing-card]').length===53);
  if(kind==='premises')await device.page.waitForFunction(()=>document.querySelectorAll('.phase0-card').length>=3);
  if(kind==='estimate')await device.page.waitForFunction(()=>document.querySelectorAll('.stage-card').length>=3);
  if(kind==='repair')await device.page.waitForFunction(()=>document.querySelectorAll('.stage-card').length>=1);
  await device.page.waitForTimeout(60);
}

async function auditVisibleLayout(device,label,viewport,kind){
  const metrics=await device.page.evaluate(()=>{
    const visible=node=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0};
    const controls=[...document.querySelectorAll('button,input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]),select,textarea,summary')]
      .filter(node=>visible(node)&&!node.classList.contains('fixture-map-marker'))
      .map(node=>({name:node.id||node.className||node.tagName,height:node.getBoundingClientRect().height}))
      .filter(item=>item.height<43.5);
    const header=document.querySelector('.site-header'),mobileBar=document.querySelector('.figma-shell-mobilebar'),h1=document.querySelector('main h1,#pro-app h1,.workflow-hero h2'),hero=document.querySelector('.cian-hero,.phase0-page-toolbar,.stage-toolbar,.passport-hero,.workflow-hero,.pro-page-head');
    const offenders=[...document.querySelectorAll('body *')].filter(node=>{if(!visible(node))return false;const rect=node.getBoundingClientRect();return rect.right>document.documentElement.clientWidth+1||rect.left<-1}).slice(0,12).map(node=>({tag:node.tagName.toLowerCase(),id:node.id,className:String(node.className||''),left:Math.round(node.getBoundingClientRect().left),right:Math.round(node.getBoundingClientRect().right),width:Math.round(node.getBoundingClientRect().width)}));
    return{
      overflow:Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth,document.body.scrollWidth-document.body.clientWidth),
      offenders,
      headerHeight:header?.getBoundingClientRect().height||0,mobileBarHeight:mobileBar?.getBoundingClientRect().height||0,h1Size:h1?Number.parseFloat(getComputedStyle(h1).fontSize):0,
      heroHeight:hero?.getBoundingClientRect().height||0,controls,
      heroParts:hero?[...hero.children].map(node=>({className:node.className,height:node.getBoundingClientRect().height,width:node.getBoundingClientRect().width})):[],
      nav:[...document.querySelectorAll('.pro-product-nav>a')].map(node=>({text:node.textContent.trim(),href:node.getAttribute('href')})),
    };
  });
  assert.equal(metrics.overflow,0,`${label}: horizontal overflow ${JSON.stringify(metrics.offenders)}`);
  assert.deepEqual(metrics.nav.map(item=>item.text),['Поиск помещенийПоиск','Мои помещенияОбъекты','Смета и КПСмета','РемонтРемонт'],label+': navigation order');
  if(visualStage==='after'){
    if(viewport.width>900){if(kind==='search')assert.equal(metrics.headerHeight,0,`${label}: empty search header removed`);else assert.ok(Math.abs(metrics.headerHeight-68)<1.1,`${label}: desktop header ${metrics.headerHeight}/68`);assert.equal(metrics.mobileBarHeight,0,`${label}: mobile bar hidden`);if(metrics.h1Size>0)assert.ok(metrics.h1Size>=24&&metrics.h1Size<=30,`${label}: desktop H1 ${metrics.h1Size}`);if(['search','premises','estimate','repair'].includes(kind))assert.ok(metrics.heroHeight>=48&&metrics.heroHeight<=126,`${label}: compact hero ${metrics.heroHeight} ${JSON.stringify(metrics.heroParts)}`)}
    else{assert.equal(metrics.headerHeight,0,`${label}: legacy header hidden`);assert.ok(metrics.mobileBarHeight>=50&&metrics.mobileBarHeight<=56,`${label}: mobile bar ${metrics.mobileBarHeight}`);if(metrics.h1Size>0)assert.ok(metrics.h1Size<=26,`${label}: responsive H1 ${metrics.h1Size}`)}
  }
  if(kind==='search'&&visualStage==='after'){
    const search=await device.page.evaluate(()=>{const results=document.querySelector('.cian-results'),map=document.querySelector('.cian-map-card'),listTitle=document.querySelector('.cian-results .cian-section-heading h2'),mapTitle=document.querySelector('#cian-map-title'),fontNodes=[document.body,document.querySelector('.cian-hero h1'),document.querySelector('.cian-parse-rules-copy strong'),listTitle,mapTitle,document.querySelector('.cian-button')].filter(Boolean),fontDetails=fontNodes.map(node=>({node:`${node.tagName}.${node.className}`,family:getComputedStyle(node).fontFamily})),style=node=>{const value=getComputedStyle(node);return{family:value.fontFamily,size:Number.parseFloat(value.fontSize),weight:value.fontWeight,color:value.color,transform:value.textTransform}};return{rule:Number.parseFloat(getComputedStyle(document.querySelector('.cian-parse-rules-copy strong')).fontSize),ruleHint:Number.parseFloat(getComputedStyle(document.querySelector('.cian-parse-rules-copy span')).fontSize),chip:Number.parseFloat(getComputedStyle(document.querySelector('.cian-parse-rule-chips span')).fontSize),resultWidth:results.getBoundingClientRect().width,mapWidth:map.getBoundingClientRect().width,mapVisible:map.getBoundingClientRect().height>0,topDelta:Math.abs(results.getBoundingClientRect().top-map.getBoundingClientRect().top),fontFamilies:[...new Set(fontDetails.map(item=>item.family))],fontDetails,listTitle:style(listTitle),mapTitle:style(mapTitle),profileCount:document.querySelectorAll('.figma-shell-profile').length,hasPersonalName:document.body.textContent.includes('Анастасия Константинова')}});
    assert.ok(search.rule>=14,label+': readable parsing-rule label');
    assert.ok(search.ruleHint>=12&&search.chip>=12,label+': readable parsing-rule details');
    assert.equal(search.mapVisible,true,label+': map visible');
    if(viewport.width>1320)assert.ok(search.topDelta<1.1,`${label}: list and map aligned, delta ${search.topDelta}`);
    assert.equal(search.fontFamilies.length,1,`${label}: one font family across search page ${JSON.stringify(search.fontDetails)}`);
    assert.deepEqual(search.mapTitle,search.listTitle,label+': map and list headings share typography');
    assert.equal(search.profileCount,0,label+': personal-account profile removed');
    assert.equal(search.hasPersonalName,false,label+': personal name removed');
    if(viewport.width>1320)assert.ok(search.resultWidth>search.mapWidth,label+': 58/42 list-map');
  }
  return metrics;
}

async function screenshotAudit(device,slug,viewport){
  if(!visualOutput)return;
  const suffix=`${viewport.width}x${viewport.height}`;
  await device.page.screenshot({path:join(visualOutput,`${slug}-${suffix}.jpg`),type:'jpeg',quality:80,fullPage:false});
}

async function openAddObject(device){
  const desktop=device.page.locator('#phase0-add'),mobile=device.page.locator('#phase0-mobile-add');
  if(await desktop.isVisible())await desktop.click();else await mobile.click();
  await device.page.locator('#phase0-object-overlay:not([hidden])').waitFor();
}

async function runLayoutAudit(device,origin){
  if(!visualStage)return;
  if(visualOutput)await mkdir(visualOutput,{recursive:true});
  await seedLayoutProjects(device);
  const viewports=[{width:1440,height:900},{width:1536,height:960},{width:1280,height:800},{width:1024,height:768},{width:768,height:1024},{width:390,height:844}];
  const pages=[
    {slug:'search',path:'/available-spaces.html',kind:'search'},
    {slug:'my-premises',path:'/index.html',kind:'premises'},
    {slug:'estimate-and-proposal',path:'/workspace.html?section=estimate',kind:'estimate'},
    {slug:'repair',path:'/workspace.html?section=repair',kind:'repair'},
    {slug:'passport',path:'/passport.html?location=layout-ready',kind:'generic'},
    {slug:'source-specification',path:'/source-specification.html?location=layout-ready',kind:'generic'},
    {slug:'specification',path:'/specification.html?location=layout-ready',kind:'generic'},
    {slug:'proposal',path:'/proposal.html?location=layout-ready',kind:'generic'},
    {slug:'team',path:'/team.html',kind:'generic'},
    {slug:'settings',path:'/settings.html',kind:'generic'},
  ];
  const screenshotSizes=visualStage==='before'?new Set(['1440x900','390x844']):new Set(['1440x900','768x1024','390x844']);
  for(const viewport of viewports){
    await device.page.setViewportSize(viewport);
    const headerHeights=[];
    for(const entry of pages){
      await navigateAuditPage(device,origin,entry.path,entry.kind);
      const metrics=await auditVisibleLayout(device,`${visualStage}/${entry.slug}/${viewport.width}x${viewport.height}`,viewport,entry.kind);
      headerHeights.push(metrics.headerHeight);
      if(screenshotSizes.has(`${viewport.width}x${viewport.height}`))await screenshotAudit(device,entry.slug,viewport);
    }
    if(visualStage==='after'){const comparable=viewport.width>900?headerHeights.slice(1):headerHeights;assert.ok(Math.max(...comparable)-Math.min(...comparable)<1,`${viewport.width}: identical shared header geometry`);}
    if(screenshotSizes.has(`${viewport.width}x${viewport.height}`)){
      await navigateAuditPage(device,origin,'/index.html','premises');
      await openAddObject(device);
      if(visualStage==='after'){
        assert.deepEqual(await device.page.locator('.phase0-editor-section-title h3').allTextContents(),['Основное','Проверка','Решение']);
        const modal=await device.page.evaluate(()=>{const body=document.querySelector('.phase0-card-editor-body'),footer=document.querySelector('.phase0-card-editor-actions');body.scrollTop=body.scrollHeight;return{scrollable:body.scrollHeight>body.clientHeight,scrolled:body.scrollTop>0,overlap:Math.max(0,body.getBoundingClientRect().bottom-footer.getBoundingClientRect().top)}});
        assert.equal(modal.scrollable,true,`${viewport.width}: modal body scroll`);assert.equal(modal.scrolled,true,`${viewport.width}: modal scroll operates`);assert.ok(modal.overlap<1,`${viewport.width}: footer overlap`);
        await device.page.locator('.phase0-card-editor-body').evaluate(node=>{node.scrollTop=0});
      }
      await screenshotAudit(device,'add-object',viewport);
      await device.page.locator('[data-action="close-editor"]').first().click();
    }
  }
  if(visualStage!=='after')return;
  await device.page.setViewportSize({width:1440,height:900});
  await navigateAuditPage(device,origin,'/available-spaces.html','search');
  assert.equal(await device.page.locator('.cian-filter-card').count(),0);
  await device.page.locator('.cian-remove-listing').first().click();
  await device.page.waitForFunction(()=>document.querySelectorAll('[data-listing-card]').length===52&&document.querySelector('#cian-map-count')?.textContent==='50 из 52 на карте');
  await device.page.locator('.cian-add-object').first().click();
  await device.page.waitForFunction(()=>document.querySelector('.cian-add-object')?.disabled===true);
  await navigateAuditPage(device,origin,'/index.html','premises');
  await device.page.locator('#phase0-search').fill('Петровский');
  await device.page.waitForFunction(()=>document.querySelectorAll('.phase0-card').length===1);
  await device.page.locator('.phase0-reset-button').click();
  await device.page.selectOption('#phase0-status-filter',{label:'Подошло'});
  await device.page.waitForFunction(()=>document.querySelectorAll('.phase0-card').length>=1&&document.querySelectorAll('.phase0-card').length<5);
  await device.page.locator('.phase0-reset-button').click();
  const collapsed=await device.page.locator('.phase0-map-column').evaluate(node=>node.getBoundingClientRect().height);
  await device.page.locator('#phase0-map-expand').click();
  assert.equal(await device.page.locator('#phase0-map-expand').getAttribute('aria-expanded'),'true');
  assert.ok(await device.page.locator('.phase0-map-column').evaluate(node=>node.getBoundingClientRect().height)>collapsed,'map presentation toggle expands');
  await openAddObject(device);
  const countBefore=await device.page.locator('.phase0-card').count();
  await device.page.locator('[name="address"]').fill('Москва, тестовое помещение интерфейса');
  await device.page.locator('#phase0-save').click();
  await device.page.waitForFunction(expected=>document.querySelectorAll('.phase0-card').length>expected,countBefore);
  assert.equal(await device.page.locator('#phase0-object-overlay').getAttribute('hidden'),null,'saved card remains open in the existing edit workflow');
  await device.page.locator('[data-action="close-editor"]').first().click();
  for(const id of ['layout-ready','layout-partial','layout-rejected'])assert.equal(await device.page.evaluate(projectId=>JSON.parse(localStorage.getItem('slogi_locations_v1')||'[]').some(item=>item.id===projectId),id),true,id+': existing fixture preserved');
  await navigateAuditPage(device,origin,'/workspace.html?section=estimate','estimate');
  await device.page.locator('.stage-card.ready a').first().click();
  await device.page.waitForURL(/source-specification\.html\?location=/);
  assert.ok(device.page.url().includes('layout-ready'),'estimate transition keeps selected object');
  await device.page.setViewportSize({width:768,height:1024});
  await navigateAuditPage(device,origin,'/workspace.html?section=repair','repair');
  const menu=device.page.locator('.figma-shell-menu-button');await menu.click();assert.equal(await menu.getAttribute('aria-expanded'),'true');await device.page.keyboard.press('Escape');assert.equal(await menu.getAttribute('aria-expanded'),'false');
}

const server=await fixtureServer();
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:chromePath});
const devices=[];
try{
  const desktop=await openDevice(browser,origin,{width:1440,height:900});devices.push(desktop);
  await desktop.page.getByRole('dialog',{name:'Доступ к SLOGI'}).waitFor();
  assert.equal(await desktop.page.locator('html').getAttribute('data-slogi-access'),'pending');
  assert.equal(desktop.identity.requests.length,0,'workspace request occurred before the grant');
  await desktop.page.keyboard.press('Escape');
  assert.equal(await desktop.page.getByRole('dialog',{name:'Доступ к SLOGI'}).isVisible(),true);
  await desktop.page.locator('#slogi-gate-password').fill(randomUUID());
  const wrongBefore=desktop.identity.unlockRequests;
  await desktop.page.getByRole('button',{name:'Открыть SLOGI'}).click();
  await desktop.page.getByText('Пароль не подошёл. Проверьте ввод и повторите.').waitFor();
  assert.equal(desktop.identity.unlockRequests-wrongBefore,1,'one wrong-password click must issue exactly one unlock request');
  assert.equal(await desktop.page.locator('#slogi-gate-password').inputValue(),'');
  assert.equal(desktop.identity.requests.length,0,'wrong password triggered a workspace request');
  await unlock(desktop);
  assert.equal(await desktop.page.locator('html').getAttribute('data-slogi-access'),'granted');
  assert.equal(await desktop.page.getByText(/Пригласить коллегу/i).count(),0);
  assert.equal(await desktop.page.getByText(/войти|регистрац|личный кабинет/i).count(),0);
  const desktopGrant=await desktop.page.evaluate(key=>JSON.parse(localStorage.getItem(key)),grantKey);
  const originalRequestCount=desktop.identity.requests.length;
  await desktop.page.reload({waitUntil:'domcontentloaded'});
  await desktop.page.waitForFunction(()=>window.SlogiCloud?.ready===true);
  assert.ok(desktop.identity.requests.length>originalRequestCount,'reload did not reuse the persistent grant');
  await assertAvailableSpace(desktop,'desktop');

  await desktop.page.evaluate(async()=>{
    localStorage.setItem('slogi_locations_v1',JSON.stringify([{id:'cross-device-fixture',source:'manual'}]));
    await window.SlogiCloud.sync();
  });
  const mobile=await openDevice(browser,origin,{width:390,height:844});devices.push(mobile);
  assert.equal(mobile.identity.requests.length,0,'new device bypassed the password prompt');
  await unlock(mobile);
  assert.equal(await mobile.page.evaluate(()=>JSON.parse(localStorage.getItem('slogi_locations_v1')||'[]')[0]?.id),'cross-device-fixture');
  assert.equal(await mobile.page.evaluate(()=>window.SlogiCloud.workspaceId),canonicalWorkspace);
  assert.equal(await mobile.page.getByText(/Пригласить коллегу/i).count(),0);
  await assertAvailableSpace(mobile,'mobile');

  const tablet=await openDevice(browser,origin,{width:768,height:1024});devices.push(tablet);
  assert.equal(tablet.identity.requests.length,0,'tablet bypassed the password prompt');
  await unlock(tablet);
  await assertAvailableSpace(tablet,'tablet');

  await runLayoutAudit(desktop,origin);

  const replay=await openDevice(browser,origin,{width:390,height:844},desktopGrant);devices.push(replay);
  await replay.page.getByRole('dialog',{name:'Доступ к SLOGI'}).waitFor();
  assert.equal(replay.identity.requests.length,0,'copied grant under another anonymous user reached workspace data');

  await desktop.page.evaluate(()=>window.SlogiCloud.sync());
  const requestCountBeforeTamper=desktop.identity.requests.length;
  await desktop.page.evaluate(({key,envelope})=>localStorage.setItem(key,JSON.stringify({...envelope,grant:envelope.grant+'x'})),{key:grantKey,envelope:desktopGrant});
  await desktop.page.reload({waitUntil:'domcontentloaded'});
  await desktop.page.getByRole('dialog',{name:'Доступ к SLOGI'}).waitFor();
  const invalidAfterTamper=desktop.identity.requests.slice(requestCountBeforeTamper).filter(item=>!item.valid);
  assert.deepEqual(invalidAfterTamper,[],'tampered grant reached a data endpoint: '+JSON.stringify(invalidAfterTamper));
  await unlock(desktop);
  const revoked=await desktop.page.evaluate(key=>JSON.parse(localStorage.getItem(key)),grantKey);
  const countBeforeRevoke=desktop.identity.requests.length;
  grants.get(revoked.grant).active=false;
  await desktop.page.reload({waitUntil:'domcontentloaded'});
  await desktop.page.getByRole('dialog',{name:'Доступ к SLOGI'}).waitFor();
  assert.equal(desktop.identity.requests.length,countBeforeRevoke,'revoked grant triggered a workspace request');
  await unlock(desktop);
  const expired=await desktop.page.evaluate(key=>JSON.parse(localStorage.getItem(key)),grantKey);
  const countBeforeExpiry=desktop.identity.requests.length;
  grants.get(expired.grant).expiresAt=new Date(Date.now()-1000).toISOString();
  await desktop.page.reload({waitUntil:'domcontentloaded'});
  await desktop.page.getByRole('dialog',{name:'Доступ к SLOGI'}).waitFor();
  assert.equal(desktop.identity.requests.length,countBeforeExpiry,'expired grant triggered a workspace request');

  const limited=await openDevice(browser,origin,{width:390,height:844});devices.push(limited);
  for(let attempt=0;attempt<3;attempt+=1){
    await limited.page.locator('#slogi-gate-password').fill(randomUUID());
    const requestCountBefore=limited.identity.unlockRequests;
    const unlockResponse=limited.page.waitForResponse(response=>response.url()===apiUrl+'/functions/v1/password-gate'&&response.request().postData()?.includes('"action":"unlock"'));
    await limited.page.getByRole('button',{name:'Открыть SLOGI'}).click();
    assert.equal((await unlockResponse).status(),attempt<2?401:429);
    assert.equal(limited.identity.unlockRequests-requestCountBefore,1,'one rate-limit click must issue exactly one unlock request');
    if(attempt<2){
      await limited.page.getByText('Пароль не подошёл. Проверьте ввод и повторите.').waitFor();
      await limited.page.waitForFunction(()=>!document.querySelector('.slogi-gate-submit')?.disabled);
    }
  }
  await limited.page.getByText(/Слишком много попыток/).waitFor();
  assert.equal(await limited.page.getByRole('button',{name:/Подождите/}).isDisabled(),true);

  for(const device of [desktop,mobile,tablet,replay,limited]){
    const metrics=await device.page.evaluate(()=>({overflow:Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth,document.body.scrollWidth-document.body.clientWidth),invites:[...document.querySelectorAll('button,a,dialog')].some(node=>/приглас/i.test(node.textContent||''))}));
    assert.equal(metrics.overflow,0);
    assert.equal(metrics.invites,false);
    assert.ok(device.identity.transportChecks>0,'password gate transport was not exercised');
    assert.deepEqual(device.issues,[]);
  }
  console.log('password gate browser e2e: PASS');
}finally{
  await Promise.all(devices.map(device=>device.context.close().catch(()=>{})));
  await browser.close().catch(()=>{});
  await new Promise(resolve=>server.close(resolve));
}
