(function(){
  'use strict';

  const LOCATIONS_KEY='slogi_locations_v1';
  const WORKFLOW_KEY='slogi_professional_state_v2';
  const BUCKET='slogi-files';
  const cfg=window.SLOGI_PHASE0_CONFIG||{};
  const supabase=cfg.supabase||{};
  const workspaceCfg=cfg.sharedWorkspace||{};
  const baseUrl=String(supabase.url||'').replace(/\/$/,'');
  const publishableKey=String(supabase.publishableKey||'');
  const joinEndpoint=String(workspaceCfg.joinEndpoint||'');
  const SESSION_KEY=String(workspaceCfg.sessionStorageKey||'slogi_anonymous_session_v1');
  const CONNECTION_KEY=String(workspaceCfg.connectionStorageKey||'slogi_shared_workspace_connection_v1');
  const CACHE_KEY=String(workspaceCfg.stateCacheKey||'slogi_shared_workspace_cache_v1');
  const CONFLICT_KEY='slogi_shared_workspace_conflict_v1';
  const originalSetItem=Storage.prototype.setItem;

  let session=null;
  let membership=null;
  let revision=0;
  let ready=false;
  let internalWrite=false;
  let pushTimer=null;
  let pushRunning=false;
  let pendingPush=false;
  let lastUploaded='';
  let sessionTask=null;
  let localMutationVersion=0;

  function validConfig(){
    try{
      const parsed=new URL(baseUrl);
      const join=new URL(joinEndpoint);
      return /^https?:$/.test(parsed.protocol)&&join.protocol===parsed.protocol&&join.origin===parsed.origin&&publishableKey.length>20;
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
      try{await refreshSession();}catch(_err){clearSession();await createAnonymousSession();}
    }else{
      const user=await response.json();
      if(user.is_anonymous!==true){clearSession();await createAnonymousSession();}
      else{session.user=user;storeSession(session);}
    }
    return session;
  }
  async function ensureSession(){
    if(sessionTask)return sessionTask;
    sessionTask=ensureSessionOnce();
    try{return await sessionTask;}finally{sessionTask=null;}
  }
  async function authorizedFetch(path,options){
    await ensureSession();
    const execute=()=>fetch(baseUrl+path,Object.assign({},options,{headers:Object.assign({'apikey':publishableKey,'Authorization':'Bearer '+session.access_token},options&&options.headers||{})}));
    let response=await execute();
    if(response.status===401){await refreshSession();response=await execute();}
    return response;
  }

  async function readMembership(){
    const response=await authorizedFetch('/rest/v1/slogi_shared_workspace_members?select=workspace_id&limit=1');
    if(!response.ok)throw new Error('shared_workspace_membership_unavailable');
    const rows=await response.json();
    membership=Array.isArray(rows)&&rows.length?rows[0]:null;
    if(membership)nativeSet(CONNECTION_KEY,JSON.stringify({workspaceId:membership.workspace_id}));else localStorage.removeItem(CONNECTION_KEY);
    return membership;
  }
  async function readRemoteState(){
    if(!membership)return null;
    const path='/rest/v1/slogi_shared_workspace_state?workspace_id=eq.'+encodeURIComponent(membership.workspace_id)+'&select=state,revision,updated_at&limit=1';
    const response=await authorizedFetch(path);
    if(!response.ok)throw new Error('shared_workspace_state_unavailable');
    const rows=await response.json();
    if(!Array.isArray(rows)||rows.length!==1)throw new Error('shared_workspace_state_unavailable');
    revision=Number(rows[0].revision)||0;
    return normalizedState(rows[0].state);
  }

  async function pushState(){
    if(!ready||!membership){pendingPush=true;return false;}
    if(pushRunning){pendingPush=true;return false;}
    const state=localState();
    const raw=serialized(state);
    if(raw===lastUploaded)return true;
    pushRunning=true;
    pendingPush=false;
    try{
      const response=await authorizedFetch('/rest/v1/rpc/slogi_update_shared_workspace_state',{method:'POST',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify({p_workspace_id:membership.workspace_id,p_expected_revision:revision,p_state:state})});
      if(response.ok){
        const rows=await response.json();
        const row=Array.isArray(rows)?rows[0]:rows;
        revision=Number(row&&row.revision)||revision+1;
        lastUploaded=raw;
        nativeSet(CACHE_KEY,JSON.stringify({workspaceId:membership.workspace_id,revision,state,updatedAt:row&&row.updated_at||new Date().toISOString()}));
        return true;
      }
      if(await isRevisionConflict(response)){
        nativeSet(CONFLICT_KEY,JSON.stringify({workspaceId:membership.workspace_id,state,savedAt:new Date().toISOString()}));
        const remote=await readRemoteState();
        if(remote)applyRemoteState(remote);
        announce('Данные изменились на другом компьютере. Локальная версия сохранена как черновик; загружена актуальная версия.',true);
        window.dispatchEvent(new CustomEvent('slogi:workspace-conflict'));
        return false;
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
    node.textContent=message;
    node.dataset.error=isError?'true':'false';
  }
  function ensureUiStyles(){
    if(document.getElementById('slogi-workspace-style'))return;
    const style=document.createElement('style');
    style.id='slogi-workspace-style';
    style.textContent='.slogi-workspace-dialog{border:0;border-radius:32px;padding:0;width:min(520px,calc(100vw - 32px));color:#3c3c3c;background:#fcf5eb;box-shadow:0 28px 80px rgba(60,60,60,.22)}.slogi-workspace-dialog::backdrop{background:rgba(45,55,52,.55)}.slogi-workspace-card{padding:32px}.slogi-workspace-card h2{font:700 30px/1.15 Ubuntu Sans,Arial,sans-serif;margin:0 0 12px}.slogi-workspace-card p{line-height:1.55;margin:0 0 20px}.slogi-workspace-field{display:grid;gap:8px}.slogi-workspace-field label{font-weight:700}.slogi-workspace-field input{min-height:48px;border:1px solid #cdbfae;border-radius:16px;padding:0 16px;font:inherit;background:#fff}.slogi-workspace-field input:focus-visible,.slogi-workspace-submit:focus-visible,.slogi-workspace-connect:focus-visible{outline:3px solid #1c7773;outline-offset:3px}.slogi-workspace-submit{margin-top:18px;min-height:48px;width:100%;border:0;border-radius:24px;background:#e39b2f;color:#252525;font:700 16px Ubuntu Sans,Arial,sans-serif;cursor:pointer}.slogi-workspace-submit:disabled{opacity:.55;cursor:wait}.slogi-workspace-help{font-size:13px;color:#68645f}.slogi-workspace-error{min-height:22px;color:#8a2d24;margin-top:10px}.slogi-workspace-connect{position:fixed;right:18px;bottom:18px;z-index:10010;min-height:46px;padding:0 18px;border:1px solid #285b58;border-radius:23px;background:#fcf5eb;color:#285b58;font:800 13px Ubuntu Sans,Arial,sans-serif;cursor:pointer}.slogi-workspace-live{position:fixed;left:20px;bottom:20px;z-index:10020;max-width:min(480px,calc(100vw - 40px));padding:12px 16px;border-radius:16px;background:#275f5c;color:#fff;transform:translateY(150%);transition:transform .2s}.slogi-workspace-live:not(:empty){transform:none}.slogi-workspace-live[data-error=true]{background:#8a2d24}@media(prefers-reduced-motion:reduce){.slogi-workspace-live{transition:none}}';
    document.head.appendChild(style);
  }

  function workspaceDialog(){
    ensureUiStyles();
    let dialog=document.getElementById('slogi-workspace-dialog');
    if(dialog)return dialog;
    dialog=document.createElement('dialog');
    dialog.id='slogi-workspace-dialog';
    dialog.className='slogi-workspace-dialog';
    dialog.setAttribute('aria-labelledby','slogi-workspace-title');
    dialog.innerHTML='<form method="dialog" class="slogi-workspace-card" id="slogi-workspace-form"><h2 id="slogi-workspace-title">Подключить рабочее пространство</h2><p>Введите длинный код, полученный от владельца пространства. Код не сохраняется в браузере и не передаётся в адресной строке.</p><div class="slogi-workspace-field"><label for="slogi-workspace-code">Код рабочего пространства</label><input id="slogi-workspace-code" name="code" type="password" autocomplete="off" minlength="32" maxlength="256" spellcheck="false" required aria-describedby="slogi-workspace-help slogi-workspace-error"><span class="slogi-workspace-help" id="slogi-workspace-help">Код содержит не менее 32 символов.</span></div><div class="slogi-workspace-error" id="slogi-workspace-error" role="alert"></div><button class="slogi-workspace-submit" type="submit">Подключить</button></form>';
    document.body.appendChild(dialog);
    const form=dialog.querySelector('form');
    const input=dialog.querySelector('input');
    dialog.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return;
      const focusable=[input,form.querySelector('button')];
      const index=focusable.indexOf(document.activeElement);
      if(event.shiftKey&&index===0){event.preventDefault();focusable[1].focus();}
      else if(!event.shiftKey&&index===1){event.preventDefault();focusable[0].focus();}
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const code=input.value.trim();
      const error=dialog.querySelector('#slogi-workspace-error');
      const button=form.querySelector('button');
      error.textContent='';
      if(code.length<32||code.length>256||!/^[A-Za-z0-9_-]+$/.test(code)){error.textContent='Не удалось подключить рабочее пространство.';return;}
      button.disabled=true;
      try{
        await ensureSession();
        const response=await fetch(joinEndpoint,{method:'POST',headers:{'apikey':publishableKey,'Authorization':'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({code})});
        if(!response.ok)throw new Error('workspace_not_available');
        const payload=await response.json();
        if(!payload||!payload.workspaceId)throw new Error('workspace_not_available');
        input.value='';
        await readMembership();
        const remote=await readRemoteState();
        const local=localState();
        const remoteEmpty=remote&&remote.locations.length===0&&Object.keys(remote.workspace).length===0;
        if(remoteEmpty&&(local.locations.length>0||Object.keys(local.workspace).length>0)){lastUploaded='';ready=true;await pushState();}
        else if(remote)applyRemoteState(remote);
        ready=true;
        dialog.close();
        document.getElementById('slogi-workspace-connect')?.remove();
        announce('Рабочее пространство подключено.',false);
        window.dispatchEvent(new CustomEvent('slogi:shared-workspace-ready'));
      }catch(_err){error.textContent='Не удалось подключить рабочее пространство.';}
      finally{input.value='';button.disabled=false;}
    });
    return dialog;
  }
  function showWorkspaceDialog(){const dialog=workspaceDialog();if(!dialog.open){dialog.showModal();setTimeout(()=>dialog.querySelector('input').focus(),0);}}
  function ensureConnectButton(){
    let button=document.getElementById('slogi-workspace-connect');
    if(button)return button;
    button=document.createElement('button');button.id='slogi-workspace-connect';button.className='slogi-workspace-connect';button.type='button';button.textContent='Подключить пространство';button.addEventListener('click',showWorkspaceDialog);document.body.appendChild(button);return button;
  }

  function encodeSegment(value){return encodeURIComponent(String(value||'').trim().slice(0,180)).replace(/%2F/gi,'_');}
  function attachmentPath(locationId,type){return'workspace/'+membership.workspace_id+'/'+encodeSegment(locationId)+'/'+encodeSegment(type);}
  async function saveAttachment(locationId,type,file,name,options){
    if(!membership||!file)return null;
    const blob=file instanceof Blob?file:new Blob([file]);
    const path=attachmentPath(locationId,type);
    const upload=await authorizedFetch('/storage/v1/object/'+BUCKET+'/'+path,{method:'POST',headers:{'Content-Type':blob.type||'application/octet-stream','x-upsert':'true'},body:blob});
    if(!upload.ok)throw new Error('shared_attachment_upload_failed');
    const meta={workspace_id:membership.workspace_id,location_id:String(locationId),attachment_type:String(type),file_name:String(name||file.name||type).slice(0,240),mime_type:String(blob.type||'application/octet-stream').slice(0,120),storage_path:path,updated_by:session.user.id};
    const response=await authorizedFetch('/rest/v1/slogi_shared_workspace_attachments?on_conflict=workspace_id,location_id,attachment_type',{method:'POST',headers:{'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(meta)});
    if(!response.ok)throw new Error('shared_attachment_metadata_failed');
    if(!(options&&options.silent))announce('Файл сохранён в рабочем пространстве.',false);
    return meta;
  }
  async function getAttachment(locationId,type){
    if(!membership)return null;
    const query='/rest/v1/slogi_shared_workspace_attachments?workspace_id=eq.'+encodeURIComponent(membership.workspace_id)+'&location_id=eq.'+encodeURIComponent(String(locationId))+'&attachment_type=eq.'+encodeURIComponent(String(type))+'&select=file_name,mime_type,storage_path&limit=1';
    const response=await authorizedFetch(query);
    if(!response.ok)return null;
    const rows=await response.json();
    if(!rows.length)return null;
    const downloaded=await authorizedFetch('/storage/v1/object/authenticated/'+BUCKET+'/'+rows[0].storage_path);
    if(!downloaded.ok)return null;
    return{blob:await downloaded.blob(),name:rows[0].file_name,mime:rows[0].mime_type};
  }
  async function deleteAttachments(locationId){
    if(!membership)return;
    const query='/rest/v1/slogi_shared_workspace_attachments?workspace_id=eq.'+encodeURIComponent(membership.workspace_id)+'&location_id=eq.'+encodeURIComponent(String(locationId));
    const listed=await authorizedFetch(query+'&select=storage_path');
    if(!listed.ok)return;
    const rows=await listed.json();
    if(rows.length)await authorizedFetch('/storage/v1/object/'+BUCKET,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:rows.map(row=>row.storage_path)})});
    await authorizedFetch(query,{method:'DELETE'});
  }
  function safeName(value,fallback){return String(value||'').trim().replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,' ').slice(0,140)||fallback||'файл';}
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=safeName(name);document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}

  async function initialize(){
    ensureUiStyles();
    const mutationVersionAtStart=localMutationVersion;
    const localAtStart=localState();
    const cacheAtStart=safeJson(localStorage.getItem(CACHE_KEY),null);
    try{
      await ensureSession();
      await readMembership();
      if(!membership){ready=false;ensureConnectButton();showWorkspaceDialog();return;}
      const remote=await readRemoteState();
      const mutatedWhileLoading=localMutationVersion!==mutationVersionAtStart;
      if(remote&&mutatedWhileLoading){
        // The cached UI can change while the initial remote read is in flight.
        // Rebase that change only when the cached base is still the remote base.
        const local=localState();
        const cachedForWorkspace=cacheAtStart&&cacheAtStart.workspaceId===membership.workspace_id&&cacheAtStart.state;
        const base=cachedForWorkspace?normalizedState(cacheAtStart.state):normalizedState(localAtStart);
        const revisionMatches=!cachedForWorkspace||Number(cacheAtStart.revision)===revision;
        if(revisionMatches&&serialized(base)===serialized(remote)){
          clearTimeout(pushTimer);pushTimer=null;pendingPush=false;
          lastUploaded=serialized(remote);
          ready=true;
          try{await pushState();}catch(_err){pendingPush=true;announce('Не удалось синхронизировать изменения. Локальная копия сохранена.',true);}
        }else{
          clearTimeout(pushTimer);pushTimer=null;pendingPush=false;
          preserveInitializationConflict(local);
          applyRemoteState(remote);
          ready=true;
        }
      }else{
        if(remote)applyRemoteState(remote);
        ready=true;
      }
      window.dispatchEvent(new CustomEvent('slogi:shared-workspace-ready'));
    }catch(_err){
      ready=false;
      const cache=safeJson(localStorage.getItem(CACHE_KEY),null);
      if(localMutationVersion===mutationVersionAtStart&&cache&&cache.state)applyRemoteState(cache.state);
      else pendingPush=true;
      announce('Облачная синхронизация временно недоступна. Работа продолжается с локальной копией.',true);
    }
  }

  Storage.prototype.setItem=function(key,value){
    originalSetItem.apply(this,arguments);
    if(this===localStorage&&!internalWrite&&(key===LOCATIONS_KEY||key===WORKFLOW_KEY)){localMutationVersion++;schedulePush();}
  };
  const api={
    enabled:true,
    get ready(){return ready;},
    get user(){return session&&session.user||null;},
    get workspaceId(){return membership&&membership.workspace_id||null;},
    async getAccessToken(){await ensureSession();return session.access_token;},
    schedulePush,
    async sync(){return pushState();},
    showWorkspaceDialog,
    saveAttachment,
    getAttachment,
    deleteAttachments,
    safeName,
    download
  };
  window.SlogiCloud=api;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
})();
