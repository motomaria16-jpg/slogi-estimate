(function(){
  'use strict';

  document.documentElement.setAttribute('data-slogi-access','pending');

  const LOCATIONS_KEY='slogi_locations_v1';
  const WORKFLOW_KEY='slogi_professional_state_v2';
  const BUCKET='slogi-files';
  const cfg=window.SLOGI_PHASE0_CONFIG||{};
  const supabase=cfg.supabase||{};
  const workspaceCfg=cfg.sharedWorkspace||{};
  const baseUrl=String(supabase.url||'').replace(/\/$/,'');
  const publishableKey=String(supabase.publishableKey||'');
  const gateEndpoint=String(workspaceCfg.passwordGateEndpoint||'');
  const SESSION_KEY=String(workspaceCfg.sessionStorageKey||'slogi_anonymous_session_v1');
  const GRANT_KEY=String(workspaceCfg.grantStorageKey||'slogi_device_grant_v1');
  const CONNECTION_KEY=String(workspaceCfg.connectionStorageKey||'slogi_shared_workspace_connection_v1');
  const CACHE_KEY=String(workspaceCfg.stateCacheKey||'slogi_shared_workspace_cache_v1');
  const CONFLICT_KEY='slogi_shared_workspace_conflict_v1';
  const originalSetItem=Storage.prototype.setItem;
  const originalFetch=window.fetch.bind(window);
  const grantProtectedEdgePaths=new Set(['/functions/v1/search-listings','/functions/v1/import-listing']);

  if(window.location.hash){
    window.history.replaceState(window.history.state,'',String(window.location.pathname||'/')+String(window.location.search||''));
  }

  let session=null;
  let deviceGrant=null;
  let membership=null;
  let revision=0;
  let ready=false;
  let grantAccepted=false;
  let internalWrite=false;
  let pushTimer=null;
  let pushRunning=false;
  let pendingPush=false;
  let lastUploaded='';
  let sessionTask=null;
  let initializationTask=null;
  let localMutationVersion=0;
  let grantWaitPromise=null;
  let grantWaitResolve=null;

  function validConfig(){
    try{
      const parsed=new URL(baseUrl);
      const gate=new URL(gateEndpoint);
      return /^https?:$/.test(parsed.protocol)&&gate.protocol===parsed.protocol&&gate.origin===parsed.origin&&publishableKey.length>20;
    }catch(_err){return false;}
  }

  function safeJson(raw,fallback){try{return JSON.parse(raw||'');}catch(_err){return fallback;}}
  function readObject(key){const value=safeJson(localStorage.getItem(key),'__invalid__');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
  function readArray(key){const value=safeJson(localStorage.getItem(key),'__invalid__');return Array.isArray(value)?value:[];}
  function localState(){return{locations:readArray(LOCATIONS_KEY),workspace:readObject(WORKFLOW_KEY)};}
  function normalizedState(value){
    const state=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    return{locations:Array.isArray(state.locations)?state.locations:[],workspace:state.workspace&&typeof state.workspace==='object'&&!Array.isArray(state.workspace)?state.workspace:{}};
  }
  function serialized(value){return JSON.stringify(normalizedState(value));}
  async function isRevisionConflict(response){
    if(response.status===400||response.status===409)return true;
    if(response.status!==500)return false;
    const payload=await response.clone().json().catch(()=>null);
    return payload&&payload.code==='40001'&&payload.message==='workspace_revision_conflict';
  }

  function nativeSet(key,value){internalWrite=true;try{originalSetItem.call(localStorage,key,value);}finally{internalWrite=false;}}
  function applyRemoteState(value){
    const state=normalizedState(value);
    nativeSet(LOCATIONS_KEY,JSON.stringify(state.locations));
    nativeSet(WORKFLOW_KEY,JSON.stringify(state.workspace));
    nativeSet(CACHE_KEY,JSON.stringify({workspaceId:membership&&membership.workspace_id||'',revision,state,updatedAt:new Date().toISOString()}));
    lastUploaded=serialized(state);
    window.dispatchEvent(new CustomEvent('slogi:locations-updated',{detail:{source:'shared-workspace'}}));
    window.dispatchEvent(new CustomEvent('slogi:workspace-updated',{detail:{source:'shared-workspace'}}));
  }

  function loadStoredSession(){
    const value=safeJson(localStorage.getItem(SESSION_KEY),'__invalid__');
    return value&&typeof value==='object'&&value.access_token&&value.refresh_token?value:null;
  }
  function storeSession(value){
    session={access_token:String(value.access_token||''),refresh_token:String(value.refresh_token||''),expires_at:Number(value.expires_at)||Math.floor(Date.now()/1000)+Number(value.expires_in||3600),user:value.user||null};
    nativeSet(SESSION_KEY,JSON.stringify(session));
  }
  function clearSession(){session=null;membership=null;revision=0;localStorage.removeItem(SESSION_KEY);localStorage.removeItem(CONNECTION_KEY);}

  function loadStoredGrant(){
    const value=safeJson(localStorage.getItem(GRANT_KEY),'__invalid__');
    if(!value||typeof value!=='object'||typeof value.grant!=='string'||!value.grant||!Number.isFinite(new Date(value.expiresAt).getTime()))return null;
    if(new Date(value.expiresAt).getTime()<=Date.now())return null;
    return{grant:value.grant,expiresAt:String(value.expiresAt),version:Number(value.version)||0};
  }
  function storeGrant(value){
    deviceGrant={grant:String(value.grant||''),expiresAt:String(value.expiresAt||''),version:Number(value.version)||0};
    nativeSet(GRANT_KEY,JSON.stringify(deviceGrant));
  }
  function clearGrant(){
    deviceGrant=null;grantAccepted=false;ready=false;membership=null;revision=0;
    localStorage.removeItem(GRANT_KEY);localStorage.removeItem(CONNECTION_KEY);
    document.documentElement.setAttribute('data-slogi-access','pending');
  }
  function waitForGrant(){
    if(grantAccepted)return Promise.resolve();
    if(!grantWaitPromise)grantWaitPromise=new Promise(resolve=>{grantWaitResolve=resolve;});
    return grantWaitPromise;
  }
  function acceptGrant(){
    grantAccepted=true;
    if(grantWaitResolve)grantWaitResolve();
    grantWaitResolve=null;grantWaitPromise=null;
  }

  async function authRequest(path,options){
    const response=await fetch(baseUrl+path,Object.assign({},options,{headers:Object.assign({'apikey':publishableKey,'Content-Type':'application/json'},options&&options.headers||{})}));
    if(!response.ok)throw new Error('anonymous_auth_unavailable');
    return response.json();
  }
  async function createAnonymousSession(){
    const value=await authRequest('/auth/v1/signup',{method:'POST',body:'{}'});
    if(!value.access_token||!value.refresh_token||!value.user||value.user.is_anonymous!==true)throw new Error('anonymous_auth_unavailable');
    storeSession(value);
  }
  async function refreshSession(){
    if(!session||!session.refresh_token)throw new Error('anonymous_auth_unavailable');
    const value=await authRequest('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})});
    if(!value.user||value.user.is_anonymous!==true)throw new Error('anonymous_auth_unavailable');
    storeSession(value);
  }
  async function ensureSessionOnce(){
    if(!validConfig())throw new Error('shared_workspace_config_invalid');
    session=loadStoredSession();
    if(!session){await createAnonymousSession();return session;}
    if(Number(session.expires_at||0)<=Math.floor(Date.now()/1000)+60){
      try{await refreshSession();}catch(_err){clearSession();await createAnonymousSession();}
    }
    const response=await fetch(baseUrl+'/auth/v1/user',{headers:{'apikey':publishableKey,'Authorization':'Bearer '+session.access_token}});
    if(!response.ok){
      try{await refreshSession();}catch(_err){clearSession();clearGrant();await createAnonymousSession();}
    }else{
      const user=await response.json();
      if(user.is_anonymous!==true){clearSession();clearGrant();await createAnonymousSession();}
      else{session.user=user;storeSession(session);}
    }
    return session;
  }
  async function ensureSession(){
    if(sessionTask)return sessionTask;
    sessionTask=ensureSessionOnce();
    try{return await sessionTask;}finally{sessionTask=null;}
  }

  async function gateFetch(body,includeGrant){
    await ensureSession();
    const headers={'apikey':publishableKey,'Authorization':'Bearer '+session.access_token,'Content-Type':'application/json'};
    if(includeGrant&&deviceGrant&&deviceGrant.grant)headers['x-slogi-device-grant']=deviceGrant.grant;
    return fetch(gateEndpoint,{method:'POST',headers,body:JSON.stringify(body)});
  }

  async function authorizedFetch(path,options){
    await ensureSession();
    await waitForGrant();
    if(!deviceGrant||!deviceGrant.grant)throw new Error('access_denied');
    const execute=()=>fetch(baseUrl+path,Object.assign({},options,{headers:Object.assign({
      'apikey':publishableKey,
      'Authorization':'Bearer '+session.access_token,
      'x-slogi-device-grant':deviceGrant.grant
    },options&&options.headers||{})}));
    let response=await execute();
    if(response.status===401){await refreshSession();response=await execute();}
    return response;
  }

  async function validateStoredGrant(){
    deviceGrant=loadStoredGrant();
    if(!deviceGrant){clearGrant();return false;}
    const response=await gateFetch({action:'status'},true);
    const payload=await response.json().catch(()=>null);
    if(response.ok&&payload&&payload.status==='granted'){
      storeGrant({grant:deviceGrant.grant,expiresAt:payload.expiresAt,version:payload.version});
      acceptGrant();
      return true;
    }
    if(response.status===401||response.status===403){clearGrant();return false;}
    throw new Error('password_gate_unavailable');
  }

  async function readMembership(){
    const response=await authorizedFetch('/rest/v1/slogi_shared_workspace_members?select=workspace_id&limit=2');
    if(!response.ok)throw new Error(response.status===401||response.status===403?'access_denied':'shared_workspace_membership_unavailable');
    const rows=await response.json();
    if(!Array.isArray(rows)||rows.length!==1)throw new Error('access_denied');
    membership=rows[0];
    nativeSet(CONNECTION_KEY,JSON.stringify({workspaceId:membership.workspace_id}));
    return membership;
  }
  async function readRemoteState(){
    if(!membership)return null;
    const path='/rest/v1/slogi_shared_workspace_state?workspace_id=eq.'+encodeURIComponent(membership.workspace_id)+'&select=state,revision,updated_at&limit=2';
    const response=await authorizedFetch(path);
    if(!response.ok)throw new Error(response.status===401||response.status===403?'access_denied':'shared_workspace_state_unavailable');
    const rows=await response.json();
    if(!Array.isArray(rows)||rows.length!==1)throw new Error('access_denied');
    revision=Number(rows[0].revision)||0;
    return normalizedState(rows[0].state);
  }

  async function pushState(){
    if(!ready||!membership){pendingPush=true;return false;}
    if(pushRunning){pendingPush=true;return false;}
    const state=localState();
    const raw=serialized(state);
    if(raw===lastUploaded)return true;
    pushRunning=true;pendingPush=false;
    try{
      const response=await authorizedFetch('/rest/v1/rpc/slogi_update_shared_workspace_state',{method:'POST',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify({p_workspace_id:membership.workspace_id,p_expected_revision:revision,p_state:state})});
      if(response.ok){
        const rows=await response.json(),row=Array.isArray(rows)?rows[0]:rows;
        revision=Number(row&&row.revision)||revision+1;lastUploaded=raw;
        nativeSet(CACHE_KEY,JSON.stringify({workspaceId:membership.workspace_id,revision,state,updatedAt:row&&row.updated_at||new Date().toISOString()}));
        return true;
      }
      if(response.status===401||response.status===403){lockAccess();throw new Error('access_denied');}
      if(await isRevisionConflict(response)){
        nativeSet(CONFLICT_KEY,JSON.stringify({workspaceId:membership.workspace_id,state,savedAt:new Date().toISOString()}));
        const remote=await readRemoteState();if(remote)applyRemoteState(remote);
        announce('Данные изменились на другом компьютере. Локальная версия сохранена как черновик; загружена актуальная версия.',true);
        window.dispatchEvent(new CustomEvent('slogi:workspace-conflict'));return false;
      }
      throw new Error('shared_workspace_save_failed');
    }finally{
      pushRunning=false;
      if(pendingPush){pendingPush=false;schedulePush(150);}
    }
  }
  function schedulePush(delay){
    clearTimeout(pushTimer);
    pushTimer=setTimeout(()=>{pushTimer=null;pushState().catch(()=>announce('Не удалось синхронизировать изменения. Локальная копия сохранена.',true));},Number(delay)||650);
  }
  function preserveInitializationConflict(local){
    nativeSet(CONFLICT_KEY,JSON.stringify({workspaceId:membership&&membership.workspace_id||'',state:normalizedState(local),savedAt:new Date().toISOString()}));
    announce('Данные изменились на другом компьютере. Локальная версия сохранена как черновик; загружена актуальная версия.',true);
    window.dispatchEvent(new CustomEvent('slogi:workspace-conflict'));
  }

  function announce(message,isError){
    let node=document.getElementById('slogi-workspace-live');
    if(!node){node=document.createElement('div');node.id='slogi-workspace-live';node.className='slogi-workspace-live';node.setAttribute('aria-live','polite');document.body.appendChild(node);}
    node.textContent=message;node.dataset.error=isError?'true':'false';
  }
  function ensureUiStyles(){
    if(document.getElementById('slogi-workspace-style'))return;
    const style=document.createElement('style');style.id='slogi-workspace-style';
    style.textContent='html[data-slogi-access="pending"] body>:not(#slogi-password-gate):not(#slogi-workspace-live){visibility:hidden!important}html[data-slogi-access="pending"] body{overflow:hidden}.slogi-password-gate{visibility:visible!important;border:0;border-radius:32px;padding:0;width:min(520px,calc(100vw - 32px));color:#3c3c3c;background:#fcf5eb;box-shadow:0 28px 80px rgba(60,60,60,.25)}.slogi-password-gate::backdrop{background:#f3eadf}.slogi-gate-card{padding:32px}.slogi-gate-card h1{font:700 30px/1.15 Ubuntu Sans,Arial,sans-serif;margin:0 0 12px}.slogi-gate-card p{line-height:1.55;margin:0 0 20px}.slogi-gate-field{display:grid;gap:8px}.slogi-gate-field label{font-weight:700}.slogi-gate-field input{box-sizing:border-box;width:100%;min-height:50px;border:1px solid #cdbfae;border-radius:16px;padding:0 16px;font:inherit;background:#fff}.slogi-gate-submit{width:100%;min-height:48px;margin-top:18px;border:1px solid #e39b2f;border-radius:24px;background:#e39b2f;color:#252525;font:700 15px Ubuntu Sans,Arial,sans-serif;cursor:pointer}.slogi-gate-submit:disabled{opacity:.6;cursor:wait}.slogi-gate-submit:focus-visible,.slogi-gate-field input:focus-visible{outline:3px solid #1c7773;outline-offset:3px}.slogi-gate-help{font-size:13px;color:#68645f}.slogi-gate-error{min-height:24px;margin-top:10px;color:#8a2d24}.slogi-workspace-live{visibility:visible!important;position:fixed;left:20px;bottom:20px;z-index:10020;max-width:min(480px,calc(100vw - 40px));padding:12px 16px;border-radius:16px;background:#275f5c;color:#fff;transform:translateY(150%);transition:transform .2s}.slogi-workspace-live:not(:empty){transform:none}.slogi-workspace-live[data-error=true]{background:#8a2d24}@media(max-width:520px){.slogi-gate-card{padding:24px}}@media(prefers-reduced-motion:reduce){.slogi-workspace-live{transition:none}}';
    document.head.appendChild(style);
  }
  function gateDialog(){
    ensureUiStyles();
    let dialog=document.getElementById('slogi-password-gate');
    if(dialog)return dialog;
    dialog=document.createElement('dialog');dialog.id='slogi-password-gate';dialog.className='slogi-password-gate';dialog.setAttribute('aria-labelledby','slogi-gate-title');
    dialog.innerHTML='<form class="slogi-gate-card" id="slogi-gate-form"><h1 id="slogi-gate-title">Доступ к SLOGI</h1><p>Введите общий пароль один раз на этом устройстве.</p><div class="slogi-gate-field"><label for="slogi-gate-password">Общий пароль</label><input id="slogi-gate-password" name="password" type="password" autocomplete="current-password" required></div><button class="slogi-gate-submit" type="submit">Открыть SLOGI</button><div class="slogi-gate-error" id="slogi-gate-error" role="alert"></div><p class="slogi-gate-help">Доступ сохраняется на этом устройстве до истечения или отзыва разрешения.</p></form>';
    dialog.addEventListener('cancel',event=>event.preventDefault());
    dialog.querySelector('#slogi-gate-form').addEventListener('submit',submitPassword);
    document.body.appendChild(dialog);return dialog;
  }
  function showGate(message){
    const dialog=gateDialog(),error=dialog.querySelector('#slogi-gate-error');
    error.textContent=message||'';
    if(!dialog.open)dialog.showModal();
    setTimeout(()=>dialog.querySelector('#slogi-gate-password').focus(),0);
  }
  function lockAccess(message){clearGrant();showGate(message||'Разрешение недействительно. Введите общий пароль снова.');}
  function cooldown(button,error,seconds){
    let remaining=Math.max(1,Math.min(900,Math.ceil(Number(seconds)||1)));button.disabled=true;
    const render=()=>{error.textContent='Слишком много попыток. Повторите через '+remaining+' сек.';button.textContent='Подождите '+remaining+' сек.';};
    render();
    const timer=setInterval(()=>{remaining-=1;if(remaining<=0){clearInterval(timer);button.disabled=false;button.textContent='Открыть SLOGI';error.textContent='';}else render();},1000);
  }
  async function submitPassword(event){
    event.preventDefault();
    const form=event.currentTarget,input=form.querySelector('#slogi-gate-password'),button=form.querySelector('.slogi-gate-submit'),error=form.querySelector('#slogi-gate-error');
    let password=String(input.value||'');input.value='';error.textContent='';button.disabled=true;button.textContent='Проверяем…';
    try{
      const challengeResponse=await gateFetch({action:'challenge'},false);
      const challengePayload=await challengeResponse.json().catch(()=>null);
      if(!challengeResponse.ok||!challengePayload||challengePayload.status!=='challenge')throw new Error('gate_unavailable');
      const unlockResponse=await gateFetch({action:'unlock',challenge:challengePayload.challenge,password},false);
      password='';
      const unlockPayload=await unlockResponse.json().catch(()=>null);
      if(unlockResponse.status===429){
        cooldown(button,error,unlockPayload&&unlockPayload.retryAfter||unlockResponse.headers.get('Retry-After'));return;
      }
      if(!unlockResponse.ok||!unlockPayload||unlockPayload.status!=='granted'||typeof unlockPayload.grant!=='string'){
        error.textContent=unlockResponse.status===401?'Пароль не подошёл. Проверьте ввод и повторите.':'Доступ временно недоступен. Попробуйте позже.';
        return;
      }
      storeGrant(unlockPayload);acceptGrant();
      await initializeWorkspace();
    }catch(_err){error.textContent='Доступ временно недоступен. Попробуйте позже.';}
    finally{password='';if(!button.disabled||button.textContent==='Проверяем…'){button.disabled=false;button.textContent='Открыть SLOGI';}}
  }

  function revealApp(){
    const dialog=document.getElementById('slogi-password-gate');if(dialog&&dialog.open)dialog.close();
    document.documentElement.setAttribute('data-slogi-access','granted');
  }

  function encodeSegment(value){return encodeURIComponent(String(value||'').trim().slice(0,180)).replace(/%2F/gi,'_');}
  function attachmentPath(locationId,type){return'workspace/'+membership.workspace_id+'/'+encodeSegment(locationId)+'/'+encodeSegment(type);}
  async function saveAttachment(locationId,type,file,name,options){
    if(!membership||!file)return null;
    const blob=file instanceof Blob?file:new Blob([file]),path=attachmentPath(locationId,type);
    const upload=await authorizedFetch('/storage/v1/object/'+BUCKET+'/'+path,{method:'POST',headers:{'Content-Type':blob.type||'application/octet-stream','x-upsert':'true'},body:blob});
    if(!upload.ok)throw new Error('shared_attachment_upload_failed');
    const meta={workspace_id:membership.workspace_id,location_id:String(locationId),attachment_type:String(type),file_name:String(name||file.name||type).slice(0,240),mime_type:String(blob.type||'application/octet-stream').slice(0,120),storage_path:path,updated_by:session.user.id};
    const response=await authorizedFetch('/rest/v1/slogi_shared_workspace_attachments?on_conflict=workspace_id,location_id,attachment_type',{method:'POST',headers:{'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(meta)});
    if(!response.ok)throw new Error('shared_attachment_metadata_failed');
    if(!(options&&options.silent))announce('Файл сохранён в рабочем пространстве.',false);return meta;
  }
  async function getAttachment(locationId,type){
    if(!membership)return null;
    const query='/rest/v1/slogi_shared_workspace_attachments?workspace_id=eq.'+encodeURIComponent(membership.workspace_id)+'&location_id=eq.'+encodeURIComponent(String(locationId))+'&attachment_type=eq.'+encodeURIComponent(String(type))+'&select=file_name,mime_type,storage_path&limit=1';
    const response=await authorizedFetch(query);if(!response.ok)return null;
    const rows=await response.json();if(!rows.length)return null;
    const downloaded=await authorizedFetch('/storage/v1/object/authenticated/'+BUCKET+'/'+rows[0].storage_path);if(!downloaded.ok)return null;
    return{blob:await downloaded.blob(),name:rows[0].file_name,mime:rows[0].mime_type};
  }
  async function deleteAttachments(locationId){
    if(!membership)return;
    const query='/rest/v1/slogi_shared_workspace_attachments?workspace_id=eq.'+encodeURIComponent(membership.workspace_id)+'&location_id=eq.'+encodeURIComponent(String(locationId));
    const listed=await authorizedFetch(query+'&select=storage_path');if(!listed.ok)return;
    const rows=await listed.json();
    if(rows.length)await authorizedFetch('/storage/v1/object/'+BUCKET,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:rows.map(row=>row.storage_path)})});
    await authorizedFetch(query,{method:'DELETE'});
  }
  function safeName(value,fallback){return String(value||'').trim().replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,' ').slice(0,140)||fallback||'файл';}
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=safeName(name);document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}

  async function initializeWorkspace(){
    if(initializationTask)return initializationTask;
    initializationTask=(async()=>{
      const mutationVersionAtStart=localMutationVersion,localAtStart=localState(),cacheAtStart=safeJson(localStorage.getItem(CACHE_KEY),null);
      try{
        await readMembership();
        const remote=await readRemoteState(),mutatedWhileLoading=localMutationVersion!==mutationVersionAtStart;
        if(remote&&mutatedWhileLoading){
          const local=localState(),cachedForWorkspace=cacheAtStart&&cacheAtStart.workspaceId===membership.workspace_id&&cacheAtStart.state;
          const base=cachedForWorkspace?normalizedState(cacheAtStart.state):normalizedState(localAtStart);
          const revisionMatches=!cachedForWorkspace||Number(cacheAtStart.revision)===revision;
          if(revisionMatches&&serialized(base)===serialized(remote)){
            clearTimeout(pushTimer);pushTimer=null;pendingPush=false;lastUploaded=serialized(remote);ready=true;
            try{await pushState();}catch(_err){pendingPush=true;announce('Не удалось синхронизировать изменения. Локальная копия сохранена.',true);}
          }else{
            clearTimeout(pushTimer);pushTimer=null;pendingPush=false;preserveInitializationConflict(local);applyRemoteState(remote);ready=true;
          }
        }else{if(remote)applyRemoteState(remote);ready=true;}
        revealApp();window.dispatchEvent(new CustomEvent('slogi:shared-workspace-ready'));
      }catch(error){
        ready=false;
        if(error&&error.message==='access_denied'){lockAccess();return;}
        const cache=safeJson(localStorage.getItem(CACHE_KEY),null);
        if(grantAccepted&&localMutationVersion===mutationVersionAtStart&&cache&&cache.state){applyRemoteState(cache.state);ready=true;revealApp();announce('Облачная синхронизация временно недоступна. Работа продолжается с локальной копией.',true);}
        else{showGate('Доступ временно недоступен. Попробуйте позже.');}
      }
    })();
    try{return await initializationTask;}finally{initializationTask=null;}
  }

  async function initialize(){
    ensureUiStyles();
    try{
      await ensureSession();
      if(await validateStoredGrant())await initializeWorkspace();
      else showGate();
    }catch(_err){showGate('Доступ временно недоступен. Попробуйте позже.');}
  }

  Storage.prototype.setItem=function(key,value){
    originalSetItem.apply(this,arguments);
    if(this===localStorage&&!internalWrite&&(key===LOCATIONS_KEY||key===WORKFLOW_KEY)){localMutationVersion++;schedulePush();}
  };
  window.fetch=async function(input,options){
    let target=null;
    try{target=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,window.location.href);}catch(_err){}
    if(target&&target.origin===baseUrl&&grantProtectedEdgePaths.has(target.pathname)){
      await waitForGrant();
      if(!deviceGrant||!deviceGrant.grant)throw new Error('access_denied');
      const headers=new Headers((options&&options.headers)||(input instanceof Request?input.headers:undefined));
      headers.set('x-slogi-device-grant',deviceGrant.grant);
      return originalFetch(input,Object.assign({},options,{headers}));
    }
    return originalFetch(input,options);
  };
  const api={
    enabled:true,
    get ready(){return ready;},
    get user(){return session&&session.user||null;},
    get workspaceId(){return membership&&membership.workspace_id||null;},
    async getAccessToken(){await ensureSession();await waitForGrant();return session.access_token;},
    async getDeviceGrant(){await ensureSession();await waitForGrant();return deviceGrant&&deviceGrant.grant||'';},
    schedulePush,
    async sync(){return pushState();},
    showAccessGate:showGate,
    saveAttachment,
    getAttachment,
    deleteAttachments,
    safeName,
    download
  };
  window.SlogiCloud=api;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
})();
