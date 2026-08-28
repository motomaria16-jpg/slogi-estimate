import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const chromePath=String(process.env.SLOGI_LOCAL_CHROME||'');
const nodeModules=String(process.env.SLOGI_NODE_MODULES||'');
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
const freshness=new Date(Date.now()-86400000).toISOString();
const cianListing=id=>({
  source:'cian',externalId:String(id),listingUrl:`https://www.cian.ru/rent/commercial/${id}`,
  title:`Помещение ${id}`,address:id>51?'':`Москва, Митино, тестовый адрес, ${id}`,
  latitude:id>51?null:55.84+(id%5)*0.0001,longitude:id>51?null:37.36+(id%7)*0.0001,
  area:100+id,rentMonthly:300000+id*1000,pricePerSquareMeter:3000,
  floor:1,totalFloors:5,ceilingHeight:3.2,freshnessAt:freshness,freshnessKind:'published',
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
    identity.searchPages.push(page);
    return json(route,{items,meta:{sources:{cian:{status:'ok',lastSucceededAt:snapshot}},page,limit:Number(body.limit)||50,total:53,returned:items.length,hasMore:page===1,nextPage:page===1?2:null,snapshotAt:snapshot}});
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
  await device.page.waitForFunction(()=>document.querySelectorAll('[data-listing-card]').length===53&&document.querySelector('#cian-map-count')?.textContent?.includes('51 из 53'));
  const metrics=await device.page.evaluate(()=>{
    const cards=[...document.querySelectorAll('[data-listing-card]')];
    const h1=Number.parseFloat(getComputedStyle(document.querySelector('.cian-hero h1')).fontSize);
    const sourceHeading=Number.parseFloat(getComputedStyle(document.querySelector('.cian-source-card h2')).fontSize);
    return{
      cards:cards.length,unique:new Set(cards.map(card=>card.dataset.listingCard)).size,
      mapCount:document.querySelector('#cian-map-count')?.textContent,
      missing:document.querySelector('#cian-map-missing')?.textContent,
      markers:window.__slogiFixtureMarkerCount,polygons:window.__slogiFixturePolygonCount,
      headerHeight:document.querySelector('.site-header').getBoundingClientRect().height,
      h1,sourceHeading,invites:[...document.querySelectorAll('button,a,dialog')].some(node=>/приглас|личный кабинет|регистрац|войти/i.test(node.textContent||'')),
      overflow:Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth,document.body.scrollWidth-document.body.clientWidth),
    };
  });
  assert.equal(metrics.cards,53,label+': all listings');assert.equal(metrics.unique,53,label+': unique listings');
  assert.equal(metrics.mapCount,'51 из 53 на карте',label+': honest map count');assert.equal(metrics.missing,'Без координат: 2',label+': honest missing count');
  assert.equal(metrics.markers,51,label+': all coordinate-capable markers');assert.equal(metrics.polygons,58,label+': canonical polygons');
  assert.ok(metrics.headerHeight<=80,label+': compact header');assert.ok(metrics.sourceHeading<metrics.h1,label+': source heading hierarchy');
  assert.equal(metrics.invites,false,label+': legacy access UI');assert.equal(metrics.overflow,0,label+': horizontal overflow');
  assert.deepEqual(device.identity.searchPages.slice(-2),[1,2],label+': complete pagination');
  await device.page.locator('.fixture-map-marker').first().click();
  assert.equal(await device.page.locator('[data-listing-card].selected').count(),1,label+': marker/card sync');
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

  const replay=await openDevice(browser,origin,{width:390,height:844},desktopGrant);devices.push(replay);
  await replay.page.getByRole('dialog',{name:'Доступ к SLOGI'}).waitFor();
  assert.equal(replay.identity.requests.length,0,'copied grant under another anonymous user reached workspace data');

  await desktop.page.evaluate(({key,envelope})=>localStorage.setItem(key,JSON.stringify({...envelope,grant:envelope.grant+'x'})),{key:grantKey,envelope:desktopGrant});
  await desktop.page.reload({waitUntil:'domcontentloaded'});
  await desktop.page.getByRole('dialog',{name:'Доступ к SLOGI'}).waitFor();
  assert.equal(desktop.identity.requests.slice(originalRequestCount).some(item=>!item.valid),false,'tampered grant reached a data endpoint');
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
