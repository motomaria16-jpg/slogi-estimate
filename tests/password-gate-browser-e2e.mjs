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
  sharedWorkspace:{
    passwordGateEndpoint:apiUrl+'/functions/v1/password-gate',
    sessionStorageKey:'slogi_anonymous_session_v1',
    grantStorageKey:grantKey,
    connectionStorageKey:'slogi_shared_workspace_connection_v1',
    stateCacheKey:'slogi_shared_workspace_cache_v1',
  },
})};`;

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
  const valid=record&&record.userId===identity.id&&record.active;
  if(path==='/functions/v1/password-gate'){
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
  if(path==='/functions/v1/search-listings'||path==='/functions/v1/import-listing')return json(route,{ok:true});
  if(path.startsWith('/storage/v1/'))return json(route,{ok:true});
  return json(route,{message:'not_found'},404);
}

async function openDevice(browser,origin,viewport,seedGrant){
  const identity={id:randomUUID(),requests:[],unlockRequests:0};
  const context=await browser.newContext({viewport,locale:'ru-RU'});
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

  const replay=await openDevice(browser,origin,{width:390,height:844},desktopGrant);devices.push(replay);
  await replay.page.getByRole('dialog',{name:'Доступ к SLOGI'}).waitFor();
  assert.equal(replay.identity.requests.length,0,'copied grant under another anonymous user reached workspace data');

  await desktop.page.evaluate(({key,envelope})=>localStorage.setItem(key,JSON.stringify({...envelope,grant:envelope.grant+'x'})),{key:grantKey,envelope:desktopGrant});
  await desktop.page.reload({waitUntil:'domcontentloaded'});
  await desktop.page.getByRole('dialog',{name:'Доступ к SLOGI'}).waitFor();
  const countAfterTamper=desktop.identity.requests.length;
  assert.equal(desktop.identity.requests.slice(originalRequestCount).some(item=>!item.valid),false,'tampered grant reached a data endpoint');
  await unlock(desktop);
  const expiring=await desktop.page.evaluate(key=>JSON.parse(localStorage.getItem(key)),grantKey);
  grants.get(expiring.grant).active=false;
  await desktop.page.reload({waitUntil:'domcontentloaded'});
  await desktop.page.getByRole('dialog',{name:'Доступ к SLOGI'}).waitFor();
  assert.equal(desktop.identity.requests.length,countAfterTamper+2,'expired/revoked grant triggered a workspace request');

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

  for(const device of [desktop,mobile,replay,limited]){
    const metrics=await device.page.evaluate(()=>({overflow:Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth,document.body.scrollWidth-document.body.clientWidth),invites:[...document.querySelectorAll('button,a,dialog')].some(node=>/приглас/i.test(node.textContent||''))}));
    assert.equal(metrics.overflow,0);
    assert.equal(metrics.invites,false);
    assert.deepEqual(device.issues,[]);
  }
  console.log('password gate browser e2e: PASS');
}finally{
  await Promise.all(devices.map(device=>device.context.close().catch(()=>{})));
  await browser.close().catch(()=>{});
  await new Promise(resolve=>server.close(resolve));
}
