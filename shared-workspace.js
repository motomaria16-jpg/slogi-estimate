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
  const inviteJoinEndpoint=String(workspaceCfg.inviteJoinEndpoint||'');
  const inviteManageEndpoint=String(workspaceCfg.inviteManageEndpoint||'');
  const SESSION_KEY=String(workspaceCfg.sessionStorageKey||'slogi_anonymous_session_v1');
  const CONNECTION_KEY=String(workspaceCfg.connectionStorageKey||'slogi_shared_workspace_connection_v1');
  const CACHE_KEY=String(workspaceCfg.stateCacheKey||'slogi_shared_workspace_cache_v1');
  const CONFLICT_KEY='slogi_shared_workspace_conflict_v1';
  const originalSetItem=Storage.prototype.setItem;

  function takeInviteFromFragment(){
    const currentLocation=window.location||{hash:'',pathname:'/',search:''};
    const fragment=String(currentLocation.hash||'').replace(/^#/, '');
    if(!fragment)return null;
    const params=new URLSearchParams(fragment);
    if(!params.has('invite'))return null;
    const token=String(params.get('invite')||'');
    params.delete('invite');
    const remaining=params.toString();
    const cleanUrl=String(currentLocation.pathname||'/')+String(currentLocation.search||'')+(remaining?'#'+remaining:'');
    window.history.replaceState(window.history.state,'',cleanUrl);
    return /^[A-Za-z0-9_-]{43}$/.test(token)?token:null;
  }

  let pendingInviteToken=takeInviteFromFragment();
  let activeInvite=null;

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
      const join=new URL(inviteJoinEndpoint);
      const manage=new URL(inviteManageEndpoint);
      return /^https?:$/.test(parsed.protocol)&&join.protocol===parsed.protocol&&join.origin===parsed.origin&&manage.protocol===parsed.protocol&&manage.origin===parsed.origin&&publishableKey.length>20;
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

  async function inviteFunctionFetch(endpoint,body){
    await ensureSession();
    return fetch(endpoint,{method:'POST',headers:{'apikey':publishableKey,'Authorization':'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify(body)});
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
    style.textContent='.slogi-workspace-dialog{border:0;border-radius:32px;padding:0;width:min(560px,calc(100vw - 32px));color:#3c3c3c;background:#fcf5eb;box-shadow:0 28px 80px rgba(60,60,60,.22)}.slogi-workspace-dialog::backdrop{background:rgba(45,55,52,.55)}.slogi-workspace-card{padding:32px}.slogi-workspace-card h2{font:700 30px/1.15 Ubuntu Sans,Arial,sans-serif;margin:0 0 12px}.slogi-workspace-card p{line-height:1.55;margin:0 0 20px}.slogi-workspace-field{display:grid;gap:8px}.slogi-workspace-field label{font-weight:700}.slogi-workspace-field input{box-sizing:border-box;width:100%;min-height:48px;border:1px solid #cdbfae;border-radius:16px;padding:0 16px;font:inherit;background:#fff}.slogi-workspace-action:focus-visible,.slogi-workspace-connect:focus-visible,.slogi-workspace-field input:focus-visible{outline:3px solid #1c7773;outline-offset:3px}.slogi-workspace-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.slogi-workspace-action{min-height:46px;padding:0 18px;border:1px solid #285b58;border-radius:23px;background:#fff;color:#285b58;font:700 15px Ubuntu Sans,Arial,sans-serif;cursor:pointer}.slogi-workspace-action[data-primary=true]{border-color:#e39b2f;background:#e39b2f;color:#252525}.slogi-workspace-action:disabled{opacity:.55;cursor:wait}.slogi-workspace-help{font-size:13px;color:#68645f}.slogi-workspace-error{min-height:22px;color:#8a2d24;margin-top:10px}.slogi-workspace-connect{position:fixed;right:18px;bottom:18px;z-index:10010;min-height:46px;padding:0 18px;border:1px solid #285b58;border-radius:23px;background:#fcf5eb;color:#285b58;font:800 13px Ubuntu Sans,Arial,sans-serif;cursor:pointer}.slogi-workspace-live{position:fixed;left:20px;bottom:20px;z-index:10020;max-width:min(480px,calc(100vw - 40px));padding:12px 16px;border-radius:16px;background:#275f5c;color:#fff;transform:translateY(150%);transition:transform .2s}.slogi-workspace-live:not(:empty){transform:none}.slogi-workspace-live[data-error=true]{background:#8a2d24}@media(max-width:520px){.slogi-workspace-card{padding:24px}.slogi-workspace-actions{display:grid}.slogi-workspace-action{width:100%}}@media(prefers-reduced-motion:reduce){.slogi-workspace-live{transition:none}}';
    document.head.appendChild(style);
  }

  function needInviteDialog(){
    ensureUiStyles();
    let dialog=document.getElementById('slogi-workspace-dialog');
    if(dialog)return dialog;
    dialog=document.createElement('dialog');
    dialog.id='slogi-workspace-dialog';
    dialog.className='slogi-workspace-dialog';
    dialog.setAttribute('aria-labelledby','slogi-workspace-title');
    dialog.innerHTML='<form method="dialog" class="slogi-workspace-card"><h2 id="slogi-workspace-title">Нужна ссылка-приглашение</h2><p>Попросите действующего участника открыть SLOGI и выбрать «Пригласить коллегу». Откройте полученную ссылку на этом устройстве — подключение произойдёт автоматически.</p><p class="slogi-workspace-help">Личный кабинет и ручной ввод данных не требуются.</p><div class="slogi-workspace-actions"><button class="slogi-workspace-action" data-primary="true" type="submit">Понятно</button></div></form>';
    document.body.appendChild(dialog);
    return dialog;
  }
  function showNeedInviteDialog(){const dialog=needInviteDialog();if(!dialog.open){dialog.showModal();setTimeout(()=>dialog.querySelector('button').focus(),0);}}
  function ensureConnectButton(){
    let button=document.getElementById('slogi-workspace-connect');
    if(button)return button;
    button=document.createElement('button');button.id='slogi-workspace-connect';button.className='slogi-workspace-connect';button.type='button';button.textContent='Нужна ссылка-приглашение';button.onclick=showNeedInviteDialog;document.body.appendChild(button);return button;
  }

  function inviteDialog(){
    ensureUiStyles();
    let dialog=document.getElementById('slogi-invite-dialog');
    if(dialog)return dialog;
    dialog=document.createElement('dialog');
    dialog.id='slogi-invite-dialog';dialog.className='slogi-workspace-dialog';dialog.setAttribute('aria-labelledby','slogi-invite-title');
    dialog.innerHTML='<div class="slogi-workspace-card"><h2 id="slogi-invite-title">Пригласить коллегу</h2><p>Ссылка действует 7 суток и позволяет подключить до 5 устройств. Передайте её только тем, кому доверяете доступ к общему пространству.</p><div class="slogi-workspace-field"><label for="slogi-invite-link">Ссылка-приглашение</label><input id="slogi-invite-link" type="text" readonly autocomplete="off" spellcheck="false"><span class="slogi-workspace-help" id="slogi-invite-expiry"></span></div><div class="slogi-workspace-error" id="slogi-invite-error" role="alert"></div><div class="slogi-workspace-actions"><button class="slogi-workspace-action" data-primary="true" id="slogi-invite-copy" type="button">Скопировать ссылку</button><button class="slogi-workspace-action" id="slogi-invite-revoke" type="button">Отозвать</button><button class="slogi-workspace-action" id="slogi-invite-close" type="button">Закрыть</button></div></div>';
    document.body.appendChild(dialog);
    const clearSecret=()=>{activeInvite=null;const input=dialog.querySelector('#slogi-invite-link');if(input)input.value='';};
    dialog.addEventListener('close',clearSecret);
    dialog.querySelector('#slogi-invite-close').addEventListener('click',()=>dialog.close());
    dialog.querySelector('#slogi-invite-copy').addEventListener('click',async()=>{
      const error=dialog.querySelector('#slogi-invite-error');error.textContent='';
      if(!activeInvite)return;
      try{await navigator.clipboard.writeText(activeInvite.link);announce('Ссылка-приглашение скопирована.',false);}
      catch(_err){error.textContent='Не удалось скопировать ссылку. Разрешите доступ к буферу обмена и повторите.';}
    });
    dialog.querySelector('#slogi-invite-revoke').addEventListener('click',async event=>{
      const button=event.currentTarget,error=dialog.querySelector('#slogi-invite-error');error.textContent='';
      if(!activeInvite)return;button.disabled=true;
      try{
        const response=await inviteFunctionFetch(inviteManageEndpoint,{action:'revoke',inviteId:activeInvite.inviteId});
        const payload=await response.json().catch(()=>null);
        if(!response.ok||!payload||payload.status!=='revoked')throw new Error('invite_revoke_failed');
        clearSecret();dialog.close();announce('Ссылка-приглашение отозвана.',false);
      }catch(_err){error.textContent='Не удалось отозвать ссылку. Попробуйте позже.';}
      finally{button.disabled=false;}
    });
    return dialog;
  }

  async function showInviteDialog(){
    const trigger=document.getElementById('slogi-workspace-connect');
    if(trigger)trigger.disabled=true;
    try{
      const response=await inviteFunctionFetch(inviteManageEndpoint,{action:'create'});
      const payload=await response.json().catch(()=>null);
      if(!response.ok||!payload||payload.status!=='created'||!/^[A-Za-z0-9_-]{43}$/.test(String(payload.inviteToken||''))||!/^[0-9a-f-]{36}$/i.test(String(payload.inviteId||'')))throw new Error('invite_create_failed');
      const expiresAt=new Date(payload.expiresAt);
      if(!Number.isFinite(expiresAt.getTime()))throw new Error('invite_create_failed');
      const url=new URL('./index.html',window.location.href);url.hash='invite='+payload.inviteToken;
      activeInvite={link:url.toString(),inviteId:String(payload.inviteId)};
      const dialog=inviteDialog();
      dialog.querySelector('#slogi-invite-link').value=activeInvite.link;
      dialog.querySelector('#slogi-invite-expiry').textContent='Действует до '+new Intl.DateTimeFormat('ru-RU',{dateStyle:'long',timeStyle:'short'}).format(expiresAt)+'.';
      dialog.querySelector('#slogi-invite-error').textContent='';
      dialog.showModal();setTimeout(()=>dialog.querySelector('#slogi-invite-copy').focus(),0);
    }catch(_err){activeInvite=null;announce('Не удалось создать ссылку-приглашение.',true);}
    finally{if(trigger)trigger.disabled=false;}
  }

  function ensureInviteButton(){
    let button=document.getElementById('slogi-workspace-connect');
    if(button){button.textContent='Пригласить коллегу';button.onclick=showInviteDialog;return button;}
    button=document.createElement('button');button.id='slogi-workspace-connect';button.className='slogi-workspace-connect';button.type='button';button.textContent='Пригласить коллегу';button.onclick=showInviteDialog;document.body.appendChild(button);return button;
  }

  async function acceptPendingInvite(){
    if(!pendingInviteToken)return false;
    const token=pendingInviteToken;
    try{
      const response=await inviteFunctionFetch(inviteJoinEndpoint,{token});
      const payload=await response.json().catch(()=>null);
      if(!response.ok||!payload||payload.status!=='connected')throw new Error('invite_not_available');
      await readMembership();
      if(!membership)throw new Error('invite_not_available');
      return true;
    }finally{
      pendingInviteToken=null;
    }
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
      let joinedFromInvite=false;
      if(!membership&&pendingInviteToken)joinedFromInvite=await acceptPendingInvite();
      else pendingInviteToken=null;
      if(!membership){ready=false;ensureConnectButton();showNeedInviteDialog();return;}
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
      ensureInviteButton();
      if(joinedFromInvite)announce('Рабочее пространство подключено по ссылке-приглашению.',false);
      window.dispatchEvent(new CustomEvent('slogi:shared-workspace-ready'));
    }catch(_err){
      ready=false;
      const cache=safeJson(localStorage.getItem(CACHE_KEY),null);
      if(localMutationVersion===mutationVersionAtStart&&cache&&cache.state)applyRemoteState(cache.state);
      else pendingPush=true;
      if(!membership){ensureConnectButton();showNeedInviteDialog();announce('Ссылка-приглашение недействительна или больше не доступна.',true);}
      else announce('Облачная синхронизация временно недоступна. Работа продолжается с локальной копией.',true);
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
    showWorkspaceDialog:showNeedInviteDialog,
    saveAttachment,
    getAttachment,
    deleteAttachments,
    safeName,
    download
  };
  window.SlogiCloud=api;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
})();
