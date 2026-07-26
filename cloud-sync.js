(function(){
  'use strict';

  const PROJECT_URL = 'https://badyvlegwumldciibxfe.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_Pe0ZW2FANEERMm62k53mvw_4i0s5-nb';
  const STORAGE_KEY = 'slogi_locations_v1';
  const FILES_DB_NAME = 'slogi_files_v1';
  const FILES_STORE_NAME = 'attachments';
  const STATE_TABLE = 'slogi_user_state';
  const ATTACHMENTS_TABLE = 'slogi_attachments';
  const FILES_BUCKET = 'slogi-files';
  const WORKSPACE_KEY = 'slogi_professional_state_v2';
  const WORKSPACE_TABLE = 'slogi_workspace_state';
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  const PRODUCTION_SITE_URL = 'https://motomaria16-jpg.github.io/slogi-estimate/';

  let client = null;
  let currentUser = null;
  let syncTimer = null;
  let workspaceSyncTimer = null;
  let lastUploadedRaw = '';
  let lastWorkspaceRaw = '';
  let internalWrite = false;
  let cloudReady = false;
  let databaseReady = true;
  let workspaceAvailable = true;
  let authEventSubscription = null;
  let initialSyncRunning = false;
  let initStarted = false;

  const originalSetItem = Storage.prototype.setItem;

  function parseLocations(raw){
    try{
      const value = JSON.parse(raw || '[]');
      return Array.isArray(value) ? value : [];
    }catch(err){
      return [];
    }
  }

  function normalizeRaw(raw){
    return JSON.stringify(parseLocations(raw));
  }

  function parseWorkspace(raw){
    try{const value=JSON.parse(raw||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
    catch(err){return {};}
  }

  function normalizeWorkspaceRaw(raw){return JSON.stringify(parseWorkspace(raw));}

  function localWorkspaceRaw(){
    try{return normalizeWorkspaceRaw(localStorage.getItem(WORKSPACE_KEY)||'{}');}
    catch(err){return '{}';}
  }

  function nativeSetWorkspace(raw){
    internalWrite=true;
    try{originalSetItem.call(localStorage,WORKSPACE_KEY,normalizeWorkspaceRaw(raw));}
    finally{internalWrite=false;}
    try{window.dispatchEvent(new CustomEvent('slogi:workspace-updated'));}catch(err){}
  }

  function localRaw(){
    try{return normalizeRaw(localStorage.getItem(STORAGE_KEY) || '[]');}
    catch(err){return '[]';}
  }

  function nativeSetLocations(raw){
    internalWrite = true;
    try{originalSetItem.call(localStorage, STORAGE_KEY, normalizeRaw(raw));}
    finally{internalWrite = false;}
    try{window.dispatchEvent(new CustomEvent('slogi:locations-updated'));}catch(err){}
  }

  function currentRedirectUrl(){
    if(location.hostname === 'motomaria16-jpg.github.io') return PRODUCTION_SITE_URL;
    if(/^https?:/.test(location.protocol)){
      const path = location.pathname.replace(/[^/]*$/, '');
      return location.origin + path;
    }
    return PRODUCTION_SITE_URL;
  }

  function isSetupError(error){
    const text = String((error && (error.message || error.details || error.hint)) || error || '').toLowerCase();
    const code = String((error && error.code) || '');
    return code === '42P01' || code === 'PGRST205' || code === 'PGRST204' ||
      text.includes('slogi_user_state') || text.includes('slogi_workspace_state') || text.includes('slogi_attachments') ||
      text.includes('bucket not found') || text.includes('not found');
  }

  function loadSdk(){
    if(window.supabase && typeof window.supabase.createClient === 'function') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-slogi-supabase-sdk]');
      if(existing){
        existing.addEventListener('load', resolve, {once:true});
        existing.addEventListener('error', () => reject(new Error('Не удалось загрузить библиотеку Supabase.')), {once:true});
        return;
      }
      const script = document.createElement('script');
      script.src = SDK_URL;
      script.async = true;
      script.dataset.slogiSupabaseSdk = '1';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Не удалось загрузить библиотеку Supabase.'));
      document.head.appendChild(script);
    });
  }

  function addStyles(){
    if(document.getElementById('slogi-cloud-styles')) return;
    const style = document.createElement('style');
    style.id = 'slogi-cloud-styles';
    style.textContent = `
      .slogi-account-nav{position:relative;z-index:2147483000;flex:0 0 auto;margin-left:auto;color:#33474b;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
      .slogi-account-trigger{display:flex;align-items:center;gap:9px;min-width:190px;max-width:260px;min-height:42px;padding:4px 10px 4px 5px;border:1px solid rgba(75,110,115,.32);border-radius:13px;background:rgba(255,255,255,.97);color:#33474b;box-shadow:0 8px 22px rgba(12,42,46,.16);cursor:pointer;text-align:left;transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}
      .slogi-account-trigger:hover,.slogi-account-trigger[aria-expanded="true"]{border-color:#78aeb1;box-shadow:0 10px 28px rgba(12,42,46,.22);transform:translateY(-1px)}
      .slogi-account-avatar{position:relative;display:grid;place-items:center;width:33px;height:33px;flex:0 0 33px;border-radius:10px;background:linear-gradient(145deg,#edf5f5,#dfeaec);color:#26474d;font:900 13px/1 Arial,sans-serif;letter-spacing:.02em}
      .slogi-account-avatar::after{content:none;display:none}
      .slogi-account-summary{display:grid;min-width:0;gap:2px;flex:1}
      .slogi-account-summary strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#2e4348;font:850 13px/1.15 Arial,sans-serif}
      .slogi-account-summary span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6f8185;font:650 11px/1.15 Arial,sans-serif}
      .slogi-account-chevron{width:9px;height:9px;flex:0 0 9px;margin:0 2px 4px 6px;border-right:2px solid #60767a;border-bottom:2px solid #60767a;transform:rotate(45deg);transition:.16s ease}
      .slogi-account-trigger[aria-expanded="true"] .slogi-account-chevron{margin-bottom:-3px;transform:rotate(225deg)}

      .slogi-account-panel{position:fixed;top:calc(var(--site-header-height,72px) + 10px);right:max(16px,calc((100vw - var(--site-layout-max,1360px))/2 + var(--site-layout-gutter,22px)));width:min(430px,calc(100vw - 32px));max-height:calc(100vh - var(--site-header-height,72px) - 24px);overflow:auto;display:none;padding:20px;border:1px solid rgba(93,134,139,.20);border-radius:24px;background:rgba(255,255,255,.98);box-shadow:0 30px 85px rgba(26,50,54,.28);color:#33474b;font:14px/1.4 Arial,sans-serif;overscroll-behavior:contain;scrollbar-width:thin}
      .slogi-account-panel[data-mode="account"]{width:min(600px,calc(100vw - 32px));padding:18px 20px 17px;border-radius:22px}
      .slogi-account-panel.show{display:block;animation:slogiAccountOpen .18s ease-out}
      @keyframes slogiAccountOpen{from{opacity:0;transform:translateY(-7px) scale(.99)}to{opacity:1;transform:none}}
      .slogi-account-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:15px}
      .slogi-account-panel h2{margin:0;color:#2f454a;font:850 22px/1.15 Arial,sans-serif}
      .slogi-account-panel h3{margin:0;color:#35565b;font:850 16px/1.2 Arial,sans-serif}
      .slogi-account-email{margin-top:4px;color:#7a8b8e;font-size:12px;overflow-wrap:anywhere}
      .slogi-account-close{display:grid;place-items:center;width:38px;height:38px;flex:0 0 38px;border:0;border-radius:50%;background:#eef2f2;color:#53696e;font-size:25px;line-height:1;cursor:pointer;transition:.15s ease}
      .slogi-account-close:hover{background:#e2eaea;color:#28464c;transform:rotate(4deg)}

      .slogi-profile-head{display:grid;grid-template-columns:68px minmax(0,1fr) 34px;align-items:center;gap:14px;margin-bottom:16px}
      .slogi-profile-avatar-large{position:relative;display:grid;place-items:center;width:68px;height:68px;border-radius:50%;background:linear-gradient(145deg,#edf5f5,#dbe7e8);color:#29474d;font:900 23px/1 Arial,sans-serif}
      .slogi-profile-avatar-large::after{content:none;display:none}
      .slogi-profile-copy{min-width:0}
      .slogi-profile-copy h2{font-size:21px;line-height:1.12;margin:0 0 2px}
      .slogi-profile-position-large{font-size:14px;line-height:1.25;color:#667b7f;margin-bottom:2px}
      .slogi-profile-email-large{display:inline-block;color:#71888c;font-size:12.5px;text-decoration:none;overflow-wrap:anywhere}
      .slogi-profile-email-large:hover{text-decoration:underline}
      .slogi-profile-head .slogi-account-close{align-self:start}

      .slogi-account-accordions{display:grid;gap:8px}
      .slogi-account-accordion{overflow:hidden;border:1px solid #cfdddd;border-radius:13px;background:#fff;transition:border-color .16s ease,box-shadow .16s ease}
      .slogi-account-accordion.is-open{border-color:#aacacc;box-shadow:0 7px 20px rgba(57,92,97,.07)}
      .slogi-account-accordion-toggle{width:100%;min-height:48px;display:grid;grid-template-columns:28px minmax(0,1fr) auto 10px;align-items:center;gap:10px;padding:9px 14px;border:0;background:linear-gradient(180deg,#fff,#fbfdfd);color:#33474b;text-align:left;cursor:pointer;font:850 14px/1.2 Arial,sans-serif}
      .slogi-account-accordion.is-open .slogi-account-accordion-toggle{color:#2f777a}
      .slogi-account-icon{width:25px;height:25px;display:grid;place-items:center;color:#5b7176}
      .slogi-account-icon svg{width:23px;height:23px;display:block;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .slogi-account-accordion.is-open .slogi-account-icon{color:#2f777a}
      .slogi-role-badge{display:inline-flex;align-items:center;justify-content:center;min-height:24px;padding:4px 9px;border-radius:999px;background:#e8f2f2;color:#2f777a;font:800 10.5px/1 Arial,sans-serif;white-space:nowrap}
      .slogi-account-accordion-chevron{width:9px;height:9px;border-right:2px solid #61767b;border-bottom:2px solid #61767b;transform:rotate(45deg);transition:.16s ease;margin-bottom:6px}
      .slogi-account-accordion.is-open .slogi-account-accordion-chevron{transform:rotate(225deg);margin-bottom:-5px}
      .slogi-account-accordion-body{display:none;padding:13px 16px 16px;border-top:1px solid #d9e4e4;background:#fff}
      .slogi-account-accordion.is-open .slogi-account-accordion-body{display:block}

      .slogi-account-form-grid{display:grid;grid-template-columns:128px minmax(0,1fr);align-items:center;gap:10px 14px}
      .slogi-account-field-label{font-weight:850;color:#344b50;font-size:12.5px}
      .slogi-cloud-field{display:grid;gap:6px;margin:10px 0}
      .slogi-cloud-field span{font-weight:800;color:#455e63;font-size:12px}
      .slogi-cloud-field input,.slogi-account-input{width:100%;box-sizing:border-box;min-height:40px;border:1px solid #bfd2d4;border-radius:10px;padding:9px 11px;background:#fff;color:#24383c;font:13.5px Arial,sans-serif;outline:none;transition:.15s ease}
      .slogi-cloud-field input[readonly],.slogi-account-input[readonly]{background:#f7fafa;color:#697b7f}
      .slogi-cloud-field input:focus,.slogi-account-input:focus{border-color:#579b9d;box-shadow:0 0 0 3px rgba(87,155,157,.13)}
      .slogi-account-form-action{grid-column:1/-1;margin-top:4px}
      .slogi-cloud-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:13px}
      .slogi-cloud-actions.single{grid-template-columns:1fr}
      .slogi-cloud-action{min-height:40px;border:0;border-radius:10px;padding:9px 12px;font:850 13px Arial,sans-serif;cursor:pointer;transition:.16s ease}
      .slogi-cloud-action:hover{transform:translateY(-1px)}
      .slogi-cloud-primary{background:linear-gradient(135deg,#4a9698,#3d8588);color:#fff;box-shadow:0 8px 18px rgba(63,137,140,.22)}
      .slogi-cloud-secondary{background:#edf4f4;color:#37545a;border:1px solid #c8dada}
      .slogi-cloud-danger{background:transparent;color:#b33f3f}
      .slogi-cloud-link{display:inline-block;margin-top:11px;border:0;background:transparent;color:#4f8f91;text-decoration:underline;font:700 13px Arial,sans-serif;cursor:pointer;padding:0}

      .slogi-security-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .slogi-security-form .slogi-cloud-field{margin:0}
      .slogi-security-form .slogi-account-form-action{grid-column:1/-1}
      .slogi-notification-list{display:grid;gap:7px}
      .slogi-notification-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:14px;padding:7px 0;border-bottom:1px solid #edf1f1}
      .slogi-notification-row:last-child{border-bottom:0}
      .slogi-notification-row strong{display:block;margin-bottom:2px;color:#334b50;font-size:12.5px}
      .slogi-notification-row span{display:block;color:#798b8e;font-size:11px;line-height:1.35}
      .slogi-switch{position:relative;width:48px;height:27px}
      .slogi-switch input{position:absolute;opacity:0;pointer-events:none}
      .slogi-switch-track{position:absolute;inset:0;border-radius:999px;background:#d8e2e2;cursor:pointer;transition:.18s ease}
      .slogi-switch-track::after{content:"";position:absolute;top:4px;left:4px;width:19px;height:19px;border-radius:50%;background:#fff;box-shadow:0 2px 5px rgba(37,62,66,.22);transition:.18s ease}
      .slogi-switch input:checked + .slogi-switch-track{background:#4b9597}
      .slogi-switch input:checked + .slogi-switch-track::after{transform:translateX(21px)}
      .slogi-access-card{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:14px;padding:11px;border-radius:11px;background:#f4f8f8;border:1px solid #d8e5e5}
      .slogi-access-card strong{display:block;color:#334b50;font-size:13px;margin-bottom:3px}
      .slogi-access-card p{margin:0;color:#718589;font-size:11px;line-height:1.4}

      .slogi-cloud-message{display:none;margin:14px 0 0;padding:11px 13px;border-radius:10px;background:#edf7f3;color:#2f7658;font-weight:700;overflow-wrap:anywhere}
      .slogi-cloud-message.show{display:block}
      .slogi-cloud-message.error{background:#fff0ef;color:#9d4141}
      .slogi-cloud-note{margin:9px 0 0;color:#7b8b8e;font-size:11.5px;line-height:1.4}
      .slogi-account-signout-wrap{margin-top:12px;padding-top:12px;border-top:1px solid #d5e1e1;text-align:center}
      .slogi-account-signout{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:38px;padding:7px 14px;border:0;background:transparent;color:#b43c3c;font:850 13.5px/1.2 Arial,sans-serif;cursor:pointer}
      .slogi-account-signout svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
      .slogi-account-signout:hover{color:#8e2929}
      .slogi-cloud-toast{position:fixed;right:16px;bottom:16px;z-index:2147483100;max-width:min(390px,calc(100vw - 32px));padding:11px 14px;border-radius:12px;background:#33474b;color:#fff;box-shadow:0 10px 30px rgba(31,45,49,.24);font:700 13px/1.35 Arial,sans-serif;opacity:0;transform:translateY(8px);pointer-events:none;transition:.2s}
      .slogi-cloud-toast.show{opacity:1;transform:none}
      .slogi-cloud-toast.error{background:#a94747}

      @media(max-width:960px){
        .slogi-account-nav{order:20;width:100%;margin-left:0}
        .slogi-account-trigger{width:100%;max-width:none;min-height:39px;padding:3px 8px 3px 5px;border-radius:11px}
        .slogi-account-avatar{width:31px;height:31px;flex-basis:31px;border-radius:9px}
        .slogi-account-summary strong{font-size:12px}
        .slogi-account-summary span{font-size:10px}
        .slogi-account-chevron{margin-left:auto}
        .slogi-account-panel{top:calc(var(--site-header-height,104px) + 8px);right:8px;left:8px;width:auto;max-height:calc(100vh - var(--site-header-height,104px) - 16px);padding:17px;border-radius:20px}
        .slogi-account-panel[data-mode="account"]{width:auto;padding:17px 18px}
        .slogi-profile-head{grid-template-columns:64px minmax(0,1fr) 34px;gap:12px}
        .slogi-profile-avatar-large{width:64px;height:64px;font-size:22px}
        .slogi-profile-copy h2{font-size:19px}
        .slogi-profile-position-large{font-size:13.5px}
        .slogi-profile-email-large{font-size:12px}
        .slogi-account-accordion-toggle{min-height:47px;padding:9px 13px;font-size:14px}
        .slogi-account-accordion-body{padding:13px 14px}
        .slogi-account-form-grid{grid-template-columns:122px minmax(0,1fr);gap:9px 12px}
        .slogi-cloud-actions{grid-template-columns:1fr}
        .slogi-cloud-toast{right:10px;bottom:10px;max-width:calc(100vw - 20px)}
      }
      @media(max-width:620px){
        .slogi-account-panel[data-mode="account"]{padding:17px 14px}
        .slogi-profile-head{grid-template-columns:66px minmax(0,1fr) 34px;gap:12px;margin-bottom:17px}
        .slogi-profile-avatar-large{width:66px;height:66px;font-size:23px}
        .slogi-profile-copy h2{font-size:20px}
        .slogi-profile-position-large{font-size:14px}
        .slogi-profile-email-large{font-size:12.5px}
        .slogi-account-close{width:34px;height:34px;flex-basis:34px;font-size:22px}
        .slogi-account-accordion-toggle{grid-template-columns:30px minmax(0,1fr) auto 10px;gap:10px;min-height:54px;padding:10px 12px;font-size:14px}
        .slogi-account-icon,.slogi-account-icon svg{width:25px;height:25px}
        .slogi-role-badge{min-height:26px;padding:4px 9px;font-size:10.5px}
        .slogi-account-accordion-chevron{width:9px;height:9px;border-width:2px}
        .slogi-account-accordion-body{padding:14px 12px 16px}
        .slogi-account-form-grid{grid-template-columns:1fr;gap:7px}
        .slogi-account-field-label{margin-top:5px;font-size:13px}
        .slogi-account-input{min-height:46px;font-size:14px}
        .slogi-security-form{grid-template-columns:1fr}
        .slogi-security-form .slogi-account-form-action{grid-column:1}
        .slogi-account-signout{font-size:14px}
      }
      @media(max-width:430px){.site-header .top{gap:8px!important}}
    `;
    document.head.appendChild(style);
  }

  function userMetadata(){
    return currentUser && currentUser.user_metadata && typeof currentUser.user_metadata === 'object' ? currentUser.user_metadata : {};
  }

  function displayName(){
    const meta = userMetadata();
    const name = String(meta.full_name || meta.name || '').trim();
    return name || String((currentUser && currentUser.email) || 'Личный кабинет');
  }

  function displayPosition(){
    const meta = userMetadata();
    const position = String(meta.position || meta.job_title || '').trim();
    return position || (currentUser ? 'Личный кабинет' : 'Вход в систему');
  }

  function userInitials(){
    if(!currentUser) return 'ЛК';
    const source = String(userMetadata().full_name || '').trim();
    if(source){
      const parts = source.split(/\s+/).filter(Boolean);
      return parts.slice(0,2).map(part => part.charAt(0).toUpperCase()).join('') || 'ЛК';
    }
    const email = String(currentUser.email || 'ЛК');
    return email.slice(0,2).toUpperCase();
  }

  function ensureUi(){
    if(!document.body) return;
    addStyles();
    let root = document.getElementById('slogi-account-nav');
    const headerTop = document.querySelector('.site-header .top');
    if(!root){
      root = document.createElement('div');
      root.id = 'slogi-account-nav';
      root.className = 'slogi-account-nav';
      root.dataset.state = 'offline';
      root.innerHTML = `
        <button type="button" class="slogi-account-trigger" id="slogi-account-trigger" aria-haspopup="dialog" aria-expanded="false">
          <span class="slogi-account-avatar" id="slogi-account-avatar">ЛК</span>
          <span class="slogi-account-summary"><strong id="slogi-account-name">Войти</strong><span id="slogi-account-position">Личный кабинет</span></span>
          <span class="slogi-account-chevron" aria-hidden="true"></span>
        </button>
        <div class="slogi-account-panel" id="slogi-account-panel" role="dialog" aria-label="Личный кабинет"></div>`;
      (headerTop || document.body).appendChild(root);
      root.querySelector('#slogi-account-trigger').addEventListener('click', event => {
        event.stopPropagation();
        const panel = root.querySelector('#slogi-account-panel');
        if(panel.classList.contains('show')) hideDialog();
        else showDialog(currentUser ? 'account' : 'login');
      });
      root.addEventListener('click', event => event.stopPropagation());
      document.addEventListener('click', hideDialog);
      document.addEventListener('keydown', event => {if(event.key === 'Escape') hideDialog();});
    }else if(headerTop && root.parentElement !== headerTop){
      headerTop.appendChild(root);
    }

    if(!document.getElementById('slogi-cloud-toast')){
      const toast = document.createElement('div');
      toast.id = 'slogi-cloud-toast';
      toast.className = 'slogi-cloud-toast';
      document.body.appendChild(toast);
    }
    updateUi();
  }

  function setButtonState(state, label){
    const root = document.getElementById('slogi-account-nav');
    if(!root) return;
    root.dataset.state = state || 'offline';
    root.title = label || '';
  }

  function updateUi(){
    if(!document.body) return;
    const root = document.getElementById('slogi-account-nav');
    if(!root){ensureUi();return;}
    let state = 'offline';
    let stateTitle = 'Личный кабинет';
    if(!databaseReady){state='error';stateTitle='Требуется настройка базы данных';}
    else if(initialSyncRunning){state='syncing';stateTitle='Синхронизация данных';}
    else if(currentUser){state='online';stateTitle='Вход выполнен';}
    setButtonState(state, stateTitle);

    const name = root.querySelector('#slogi-account-name');
    const position = root.querySelector('#slogi-account-position');
    const avatar = root.querySelector('#slogi-account-avatar');
    if(name) name.textContent = currentUser ? displayName() : 'Войти';
    if(position) position.textContent = currentUser ? displayPosition() : 'Личный кабинет';
    if(avatar) avatar.textContent = userInitials();
  }

  let toastTimer = null;
  function showToast(text, isError){
    ensureUi();
    const toast = document.getElementById('slogi-cloud-toast');
    if(!toast) return;
    toast.textContent = text;
    toast.className = 'slogi-cloud-toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {toast.className = 'slogi-cloud-toast';}, 4200);
  }

  function hideDialog(){
    const panel = document.getElementById('slogi-account-panel');
    const trigger = document.getElementById('slogi-account-trigger');
    if(panel) panel.classList.remove('show');
    if(trigger) trigger.setAttribute('aria-expanded','false');
  }

  function dialogMessage(text, isError){
    const message = document.getElementById('slogi-cloud-message');
    if(!message) return;
    message.textContent = text || '';
    message.className = 'slogi-cloud-message' + (text ? ' show' : '') + (isError ? ' error' : '');
  }

  function panelHeader(title, email){
    return `<div class="slogi-account-panel-head"><div><h2>${escapeHtml(title)}</h2>${email ? `<div class="slogi-account-email">${escapeHtml(email)}</div>` : ''}</div><button type="button" class="slogi-account-close" id="slogi-account-close" aria-label="Закрыть">×</button></div>`;
  }

  function bindPanelClose(panel){
    const close = panel.querySelector('#slogi-account-close');
    if(close) close.addEventListener('click', hideDialog);
  }


  function accountIcon(type){
    const paths = {
      user:'<path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="7" r="4"></circle>',
      lock:'<rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path><path d="M12 14v3"></path>',
      bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path>',
      shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"></path><circle cx="12" cy="10" r="2.5"></circle><path d="M8.5 16c.8-1.7 2-2.5 3.5-2.5s2.7.8 3.5 2.5"></path>',
      logout:'<path d="M10 17l5-5-5-5"></path><path d="M15 12H3"></path><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"></path>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[type] || ''}</svg>`;
  }

  function readNotificationPreferences(){
    try{
      const parsed = JSON.parse(localStorage.getItem('slogi_account_notifications_v1') || '{}');
      return {
        documents: parsed.documents !== false,
        estimates: parsed.estimates !== false,
        sync: parsed.sync !== false
      };
    }catch(error){
      return {documents:true, estimates:true, sync:true};
    }
  }

  function saveNotificationPreferences(panel){
    const prefs = {};
    panel.querySelectorAll('[data-notification-key]').forEach(input => {prefs[input.dataset.notificationKey] = !!input.checked;});
    localStorage.setItem('slogi_account_notifications_v1', JSON.stringify(prefs));
  }

  function showDialog(mode){
    ensureUi();
    const panel = document.getElementById('slogi-account-panel');
    const trigger = document.getElementById('slogi-account-trigger');
    if(!panel || !trigger) return;

    panel.dataset.mode = mode || 'login';
    if(mode === 'account' && currentUser){
      const meta = userMetadata();
      const role = String(meta.role || meta.access_level || 'Наблюдатель').trim() || 'Наблюдатель';
      const prefs = readNotificationPreferences();
      panel.innerHTML = `
        <div class="slogi-profile-head">
          <div class="slogi-profile-avatar-large">${escapeHtml(userInitials())}</div>
          <div class="slogi-profile-copy">
            <h2>${escapeHtml(displayName())}</h2>
            <div class="slogi-profile-position-large">${escapeHtml(displayPosition())}</div>
            <a class="slogi-profile-email-large" href="mailto:${escapeHtml(currentUser.email || '')}">${escapeHtml(currentUser.email || '')}</a>
          </div>
          <button type="button" class="slogi-account-close" id="slogi-account-close" aria-label="Закрыть">×</button>
        </div>

        <div class="slogi-account-accordions">
          <section class="slogi-account-accordion is-open">
            <button type="button" class="slogi-account-accordion-toggle" aria-expanded="true">
              <span class="slogi-account-icon">${accountIcon('user')}</span>
              <span>Личные данные</span>
              <span></span>
              <span class="slogi-account-accordion-chevron" aria-hidden="true"></span>
            </button>
            <div class="slogi-account-accordion-body">
              <div class="slogi-account-form-grid">
                <label class="slogi-account-field-label" for="slogi-profile-name">ФИО</label>
                <input class="slogi-account-input" id="slogi-profile-name" type="text" autocomplete="name" maxlength="160" placeholder="Введите фамилию, имя и отчество" value="${escapeHtml(meta.full_name || meta.name || '')}">
                <label class="slogi-account-field-label" for="slogi-profile-position">Должность</label>
                <input class="slogi-account-input" id="slogi-profile-position" type="text" autocomplete="organization-title" maxlength="120" placeholder="Например: руководитель проекта" value="${escapeHtml(meta.position || meta.job_title || '')}">
                <label class="slogi-account-field-label" for="slogi-profile-email">Электронная почта</label>
                <input class="slogi-account-input" id="slogi-profile-email" type="email" value="${escapeHtml(currentUser.email || '')}" readonly>
                <div class="slogi-account-form-action"><button type="button" class="slogi-cloud-action slogi-cloud-primary" id="slogi-profile-save" style="width:100%">Сохранить</button></div>
              </div>
            </div>
          </section>

          <section class="slogi-account-accordion">
            <button type="button" class="slogi-account-accordion-toggle" aria-expanded="false">
              <span class="slogi-account-icon">${accountIcon('lock')}</span>
              <span>Безопасность</span>
              <span></span>
              <span class="slogi-account-accordion-chevron" aria-hidden="true"></span>
            </button>
            <div class="slogi-account-accordion-body">
              <div class="slogi-security-form">
                <label class="slogi-cloud-field"><span>Новый пароль</span><input id="slogi-profile-password" type="password" minlength="8" autocomplete="new-password" placeholder="Не менее 8 символов"></label>
                <label class="slogi-cloud-field"><span>Повторите пароль</span><input id="slogi-profile-password-repeat" type="password" minlength="8" autocomplete="new-password" placeholder="Повторите новый пароль"></label>
                <div class="slogi-account-form-action"><button type="button" class="slogi-cloud-action slogi-cloud-secondary" id="slogi-profile-password-save" style="width:100%">Сменить пароль</button></div>
              </div>
            </div>
          </section>

          <section class="slogi-account-accordion">
            <button type="button" class="slogi-account-accordion-toggle" aria-expanded="false">
              <span class="slogi-account-icon">${accountIcon('bell')}</span>
              <span>Уведомления</span>
              <span></span>
              <span class="slogi-account-accordion-chevron" aria-hidden="true"></span>
            </button>
            <div class="slogi-account-accordion-body">
              <div class="slogi-notification-list">
                <div class="slogi-notification-row"><div><strong>Документы объекта</strong><span>Сообщать о добавлении и обновлении документов.</span></div><label class="slogi-switch"><input type="checkbox" data-notification-key="documents" ${prefs.documents ? 'checked' : ''}><span class="slogi-switch-track"></span></label></div>
                <div class="slogi-notification-row"><div><strong>Сметы и коммерческие предложения</strong><span>Показывать уведомления о сохранении и формировании файлов.</span></div><label class="slogi-switch"><input type="checkbox" data-notification-key="estimates" ${prefs.estimates ? 'checked' : ''}><span class="slogi-switch-track"></span></label></div>
                <div class="slogi-notification-row"><div><strong>Облачная синхронизация</strong><span>Сообщать об ошибках синхронизации между устройствами.</span></div><label class="slogi-switch"><input type="checkbox" data-notification-key="sync" ${prefs.sync ? 'checked' : ''}><span class="slogi-switch-track"></span></label></div>
              </div>
            </div>
          </section>

          <section class="slogi-account-accordion">
            <button type="button" class="slogi-account-accordion-toggle" aria-expanded="false">
              <span class="slogi-account-icon">${accountIcon('shield')}</span>
              <span>Доступ и права</span>
              <span class="slogi-role-badge">${escapeHtml(role)}</span>
              <span class="slogi-account-accordion-chevron" aria-hidden="true"></span>
            </button>
            <div class="slogi-account-accordion-body">
              <div class="slogi-access-card"><div><strong>Текущая роль: ${escapeHtml(role)}</strong><p>Уровень доступа назначается администратором системы. Для изменения роли обратитесь к ответственному сотруднику.</p></div><span class="slogi-role-badge">${escapeHtml(role)}</span></div>
            </div>
          </section>
        </div>

        <div class="slogi-cloud-message" id="slogi-cloud-message"></div>
        <div class="slogi-account-signout-wrap"><button type="button" class="slogi-account-signout" id="slogi-cloud-signout">${accountIcon('logout')}<span>Выйти из аккаунта</span></button></div>`;
      bindPanelClose(panel);

      panel.querySelectorAll('.slogi-account-accordion-toggle').forEach(button => {
        button.addEventListener('click', () => {
          const section = button.closest('.slogi-account-accordion');
          const open = !section.classList.contains('is-open');
          panel.querySelectorAll('.slogi-account-accordion').forEach(item => {
            item.classList.remove('is-open');
            const toggle = item.querySelector('.slogi-account-accordion-toggle');
            if(toggle) toggle.setAttribute('aria-expanded','false');
          });
          if(open){
            section.classList.add('is-open');
            button.setAttribute('aria-expanded','true');
          }
        });
      });

      panel.querySelectorAll('[data-notification-key]').forEach(input => {
        input.addEventListener('change', () => {
          saveNotificationPreferences(panel);
          dialogMessage('Настройки уведомлений сохранены.', false);
        });
      });

      panel.querySelector('#slogi-profile-save').addEventListener('click', async () => {
        const fullName = panel.querySelector('#slogi-profile-name').value.trim();
        const position = panel.querySelector('#slogi-profile-position').value.trim();
        dialogMessage('Сохраняю данные…', false);
        const {data, error} = await client.auth.updateUser({data:{full_name:fullName, position}});
        if(error){dialogMessage(humanError(error), true);return;}
        if(data && data.user) currentUser = data.user;
        updateUi();
        const profileName = panel.querySelector('.slogi-profile-copy h2');
        const profilePosition = panel.querySelector('.slogi-profile-position-large');
        const profileAvatar = panel.querySelector('.slogi-profile-avatar-large');
        if(profileName) profileName.textContent = displayName();
        if(profilePosition) profilePosition.textContent = displayPosition();
        if(profileAvatar) profileAvatar.textContent = userInitials();
        dialogMessage('Личные данные сохранены.', false);
      });
      panel.querySelector('#slogi-profile-password-save').addEventListener('click', async () => {
        const password = panel.querySelector('#slogi-profile-password').value;
        const repeat = panel.querySelector('#slogi-profile-password-repeat').value;
        if(password.length < 8){dialogMessage('Пароль должен содержать не менее 8 символов.', true);return;}
        if(password !== repeat){dialogMessage('Пароли не совпадают.', true);return;}
        dialogMessage('Сохраняю новый пароль…', false);
        const {data, error} = await client.auth.updateUser({password});
        if(error){dialogMessage(humanError(error), true);return;}
        if(data && data.user) currentUser = data.user;
        panel.querySelector('#slogi-profile-password').value = '';
        panel.querySelector('#slogi-profile-password-repeat').value = '';
        updateUi();
        dialogMessage('Пароль изменён.', false);
      });
      panel.querySelector('#slogi-cloud-signout').addEventListener('click', signOutSafely);
    }else if(mode === 'recovery'){
      panel.innerHTML = `
        ${panelHeader('Новый пароль', currentUser && currentUser.email ? currentUser.email : '')}
        <label class="slogi-cloud-field"><span>Новый пароль</span><input id="slogi-cloud-new-password" type="password" minlength="8" autocomplete="new-password" required></label>
        <label class="slogi-cloud-field"><span>Повторите пароль</span><input id="slogi-cloud-new-password-repeat" type="password" minlength="8" autocomplete="new-password" required></label>
        <div class="slogi-cloud-actions single"><button type="button" class="slogi-cloud-action slogi-cloud-primary" id="slogi-cloud-update-password">Сохранить пароль</button></div>
        <div class="slogi-cloud-message" id="slogi-cloud-message"></div>`;
      bindPanelClose(panel);
      panel.querySelector('#slogi-cloud-update-password').addEventListener('click', async () => {
        const password = panel.querySelector('#slogi-cloud-new-password').value;
        const repeat = panel.querySelector('#slogi-cloud-new-password-repeat').value;
        if(password.length < 8){dialogMessage('Пароль должен содержать не менее 8 символов.', true);return;}
        if(password !== repeat){dialogMessage('Пароли не совпадают.', true);return;}
        dialogMessage('Сохраняю новый пароль…', false);
        const {data, error} = await client.auth.updateUser({password});
        if(error){dialogMessage(humanError(error), true);return;}
        if(data && data.user) currentUser = data.user;
        dialogMessage('Пароль изменён.', false);
        setTimeout(() => showDialog('account'), 700);
      });
    }else{
      panel.innerHTML = `
        ${panelHeader('Вход в личный кабинет', '')}
        <label class="slogi-cloud-field"><span>Электронная почта</span><input id="slogi-cloud-email" type="email" autocomplete="email" placeholder="name@example.com" required></label>
        <label class="slogi-cloud-field"><span>Пароль</span><input id="slogi-cloud-password" type="password" minlength="8" autocomplete="current-password" placeholder="Не менее 8 символов" required></label>
        <div class="slogi-cloud-actions">
          <button type="button" class="slogi-cloud-action slogi-cloud-primary" id="slogi-cloud-login">Войти</button>
          <button type="button" class="slogi-cloud-action slogi-cloud-secondary" id="slogi-cloud-signup">Создать аккаунт</button>
        </div>
        <button type="button" class="slogi-cloud-link" id="slogi-cloud-forgot">Забыли пароль?</button>
        <div class="slogi-cloud-message" id="slogi-cloud-message"></div>`;
      bindPanelClose(panel);
      const emailInput = panel.querySelector('#slogi-cloud-email');
      const passwordInput = panel.querySelector('#slogi-cloud-password');
      panel.querySelector('#slogi-cloud-login').addEventListener('click', async () => {
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        if(!client){dialogMessage('Подключение ещё загружается. Повторите через несколько секунд.', true);return;}
        if(!email || !password){dialogMessage('Введите электронную почту и пароль.', true);return;}
        dialogMessage('Выполняю вход…', false);
        const {error} = await client.auth.signInWithPassword({email, password});
        if(error){dialogMessage(humanError(error), true);return;}
        dialogMessage('Вход выполнен. Загружаю данные…', false);
      });
      panel.querySelector('#slogi-cloud-signup').addEventListener('click', async () => {
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        if(!client){dialogMessage('Подключение ещё загружается. Повторите через несколько секунд.', true);return;}
        if(!email || password.length < 8){dialogMessage('Укажите почту и пароль не короче 8 символов.', true);return;}
        dialogMessage('Создаю аккаунт…', false);
        const {data, error} = await client.auth.signUp({email,password,options:{emailRedirectTo:currentRedirectUrl()}});
        if(error){dialogMessage(humanError(error), true);return;}
        if(data && data.session) dialogMessage('Аккаунт создан. Загружаю данные…', false);
        else dialogMessage('Аккаунт создан. Подтвердите электронную почту по ссылке из письма, затем войдите.', false);
      });
      panel.querySelector('#slogi-cloud-forgot').addEventListener('click', async () => {
        const email = emailInput.value.trim();
        if(!client){dialogMessage('Подключение ещё загружается. Повторите через несколько секунд.', true);return;}
        if(!email){dialogMessage('Сначала укажите электронную почту.', true);return;}
        dialogMessage('Отправляю письмо для восстановления…', false);
        const {error} = await client.auth.resetPasswordForEmail(email, {redirectTo:currentRedirectUrl()});
        if(error){dialogMessage(humanError(error), true);return;}
        dialogMessage('Письмо отправлено. Перейдите по ссылке из письма.', false);
      });
      setTimeout(() => emailInput.focus(), 30);
    }
    panel.classList.add('show');
    trigger.setAttribute('aria-expanded','true');
  }

  function escapeHtml(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function humanError(error){
    const msg = String((error && error.message) || error || 'Неизвестная ошибка');
    if(isSetupError(error)) return 'База Supabase ещё не настроена. Выполните файл SUPABASE_SETUP.sql в SQL Editor.';
    if(/invalid login credentials/i.test(msg)) return 'Неверная электронная почта или пароль.';
    if(/email not confirmed/i.test(msg)) return 'Сначала подтвердите электронную почту по ссылке из письма Supabase.';
    if(/user already registered/i.test(msg)) return 'Аккаунт с этой электронной почтой уже существует. Нажмите «Войти».';
    if(/password/i.test(msg) && /least|characters|weak/i.test(msg)) return 'Пароль слишком простой или короткий. Используйте не менее 8 символов.';
    if(/rate limit/i.test(msg)) return 'Слишком много попыток. Подождите немного и повторите.';
    return msg;
  }

  function scheduleStateUpload(raw){
    if(!currentUser || !client || !databaseReady) return;
    const normalized = normalizeRaw(raw);
    if(normalized === lastUploadedRaw) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => uploadState(normalized), 650);
  }

  async function uploadState(raw){
    if(!currentUser || !client) return false;
    const normalized = normalizeRaw(raw == null ? localRaw() : raw);
    setButtonState('syncing', 'Сохранение данных…');
    const {error} = await client.from(STATE_TABLE).upsert({
      user_id: currentUser.id,
      locations: parseLocations(normalized),
      updated_at: new Date().toISOString()
    }, {onConflict:'user_id'});
    if(error){
      if(isSetupError(error)) databaseReady = false;
      updateUi();
      showToast(humanError(error), true);
      return false;
    }
    databaseReady = true;
    lastUploadedRaw = normalized;
    updateUi();
    return true;
  }

  function scheduleWorkspaceUpload(raw){
    if(!currentUser || !client || !databaseReady || !workspaceAvailable) return;
    const normalized=normalizeWorkspaceRaw(raw);
    if(normalized===lastWorkspaceRaw) return;
    clearTimeout(workspaceSyncTimer);
    workspaceSyncTimer=setTimeout(()=>uploadWorkspace(normalized),700);
  }

  async function uploadWorkspace(raw){
    if(!currentUser || !client) return false;
    const normalized=normalizeWorkspaceRaw(raw==null?localWorkspaceRaw():raw);
    const {error}=await client.from(WORKSPACE_TABLE).upsert({
      user_id:currentUser.id,
      workspace:parseWorkspace(normalized),
      updated_at:new Date().toISOString()
    },{onConflict:'user_id'});
    if(error){
      if(isSetupError(error)){workspaceAvailable=false;console.warn('SLOGI workspace table is not configured yet.');return false;}
      showToast(humanError(error),true);return false;
    }
    workspaceAvailable=true;lastWorkspaceRaw=normalized;return true;
  }

  async function syncWorkspaceFromCloud(){
    if(!currentUser || !client) return false;
    const before=localWorkspaceRaw();
    const local=parseWorkspace(before);
    const {data,error}=await client.from(WORKSPACE_TABLE).select('workspace,updated_at').eq('user_id',currentUser.id).maybeSingle();
    if(error){if(isSetupError(error)){workspaceAvailable=false;return false;}throw error;}
    workspaceAvailable=true;
    if(data){const remote=JSON.stringify(data.workspace&&typeof data.workspace==='object'?data.workspace:{});if(remote!==before)nativeSetWorkspace(remote);lastWorkspaceRaw=remote;}
    else if(Object.keys(local).length){await uploadWorkspace(before);}
    else lastWorkspaceRaw='{}';
    window.dispatchEvent(new CustomEvent('slogi:workspace-ready'));
    return true;
  }

  async function flushState(){
    clearTimeout(syncTimer);clearTimeout(workspaceSyncTimer);
    const a=await uploadState(localRaw());
    const b=await uploadWorkspace(localWorkspaceRaw());
    return a&&(b||!workspaceAvailable);
  }

  async function syncFromCloud(options){
    options = options || {};
    if(!currentUser || !client || initialSyncRunning) return false;
    initialSyncRunning = true;
    updateUi();
    try{
      const beforeRaw = localRaw();
      const localItems = parseLocations(beforeRaw);
      const {data, error} = await client.from(STATE_TABLE)
        .select('locations,updated_at')
        .eq('user_id', currentUser.id)
        .maybeSingle();
      if(error) throw error;

      databaseReady = true;
      const remoteItems = data && Array.isArray(data.locations) ? data.locations : [];
      let targetRaw = beforeRaw;

      if(data){
        // Если строка уже существует, облачная версия является основной даже тогда,
        // когда список пуст: так удаление всех объектов не будет отменено старым устройством.
        targetRaw = JSON.stringify(remoteItems);
        if(targetRaw !== beforeRaw) nativeSetLocations(targetRaw);
        lastUploadedRaw = targetRaw;
      }else if(localItems.length){
        // Первый вход на устройстве, где уже были локальные данные: переносим их в Supabase.
        const uploaded = await uploadState(beforeRaw);
        if(!uploaded) return false;
        targetRaw = beforeRaw;
      }else{
        // На новом пустом устройстве строку пока не создаём. Она появится при первом сохранении.
        targetRaw = '[]';
        lastUploadedRaw = '[]';
      }

      await syncWorkspaceFromCloud();
      scheduleAttachmentMigration();
      cloudReady = true;
      window.dispatchEvent(new CustomEvent('slogi:cloud-ready', {detail:{user:currentUser}}));

      const changed = targetRaw !== beforeRaw;
      if(changed){
        try{window.dispatchEvent(new CustomEvent('slogi:locations-updated',{detail:{source:'cloud'}}));}catch(err){}
      }
      if(options.manual) showToast('Данные синхронизированы.', false);
      return true;
    }catch(error){
      if(isSetupError(error)) databaseReady = false;
      cloudReady = false;
      showToast(humanError(error), true);
      return false;
    }finally{
      initialSyncRunning = false;
      updateUi();
    }
  }

  function simpleHash(value){
    let hash = 2166136261;
    const text = String(value || '');
    for(let i=0;i<text.length;i++){
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function safePathPart(value){
    return String(value || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0,140) || 'file';
  }

  function storagePath(locationId, type){
    return currentUser.id + '/' + safePathPart(locationId) + '/' + safePathPart(type);
  }

  async function getAttachment(locationId, type){
    if(!currentUser || !client || !locationId || !type || !databaseReady) return null;
    try{
      const {data:meta, error:metaError} = await client.from(ATTACHMENTS_TABLE)
        .select('file_name,mime_type,storage_path,updated_at')
        .eq('user_id', currentUser.id)
        .eq('location_id', String(locationId))
        .eq('attachment_type', String(type))
        .maybeSingle();
      if(metaError) throw metaError;
      if(!meta) return null;
      const {data:blob, error:downloadError} = await client.storage.from(FILES_BUCKET).download(meta.storage_path);
      if(downloadError) throw downloadError;
      return {
        key:String(locationId)+':'+String(type),
        locationId:String(locationId),
        type:String(type),
        name:meta.file_name || 'Файл',
        mime:meta.mime_type || blob.type || 'application/octet-stream',
        blob,
        updatedAt:meta.updated_at || ''
      };
    }catch(error){
      if(isSetupError(error)) databaseReady = false;
      updateUi();
      return null;
    }
  }

  async function saveAttachment(locationId, type, blob, name, options){
    options = options || {};
    if(!currentUser || !client || !locationId || !type || !blob || !databaseReady) return false;
    const path = storagePath(locationId, type);
    try{
      if(options.skipIfNewer){
        const {data:existing} = await client.from(ATTACHMENTS_TABLE)
          .select('updated_at')
          .eq('user_id', currentUser.id)
          .eq('location_id', String(locationId))
          .eq('attachment_type', String(type))
          .maybeSingle();
        if(existing && existing.updated_at && options.localUpdatedAt && new Date(existing.updated_at) >= new Date(options.localUpdatedAt)) return true;
      }
      const mime = blob.type || 'application/octet-stream';
      const {error:uploadError} = await client.storage.from(FILES_BUCKET).upload(path, blob, {
        upsert:true,
        contentType:mime,
        cacheControl:'3600'
      });
      if(uploadError) throw uploadError;
      const {error:metaError} = await client.from(ATTACHMENTS_TABLE).upsert({
        user_id:currentUser.id,
        location_id:String(locationId),
        attachment_type:String(type),
        file_name:name || 'Файл',
        mime_type:mime,
        storage_path:path,
        updated_at:new Date().toISOString()
      }, {onConflict:'user_id,location_id,attachment_type'});
      if(metaError) throw metaError;
      return true;
    }catch(error){
      if(isSetupError(error)) databaseReady = false;
      updateUi();
      if(!options.silent) showToast('Не удалось сохранить файл в облаке: ' + humanError(error), true);
      return false;
    }
  }

  async function deleteAttachments(locationId){
    if(!currentUser || !client || !locationId || !databaseReady) return false;
    try{
      const {data:rows, error:readError} = await client.from(ATTACHMENTS_TABLE)
        .select('storage_path')
        .eq('user_id', currentUser.id)
        .eq('location_id', String(locationId));
      if(readError) throw readError;
      const paths = (rows || []).map(row => row.storage_path).filter(Boolean);
      if(paths.length){
        const {error:removeError} = await client.storage.from(FILES_BUCKET).remove(paths);
        if(removeError) throw removeError;
      }
      const {error:deleteError} = await client.from(ATTACHMENTS_TABLE)
        .delete()
        .eq('user_id', currentUser.id)
        .eq('location_id', String(locationId));
      if(deleteError) throw deleteError;
      return true;
    }catch(error){
      if(isSetupError(error)) databaseReady = false;
      updateUi();
      showToast('Не удалось удалить облачные файлы: ' + humanError(error), true);
      return false;
    }
  }

  function readAllIndexedDbAttachments(){
    return new Promise(resolve => {
      if(!('indexedDB' in window)){resolve([]);return;}
      const request = indexedDB.open(FILES_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if(!db.objectStoreNames.contains(FILES_STORE_NAME)) db.createObjectStore(FILES_STORE_NAME, {keyPath:'key'});
      };
      request.onerror = () => resolve([]);
      request.onsuccess = () => {
        const db = request.result;
        try{
          const tx = db.transaction(FILES_STORE_NAME, 'readonly');
          const getAll = tx.objectStore(FILES_STORE_NAME).getAll();
          getAll.onsuccess = () => {db.close();resolve(Array.isArray(getAll.result) ? getAll.result : []);};
          getAll.onerror = () => {db.close();resolve([]);};
        }catch(err){db.close();resolve([]);}
      };
    });
  }

  async function migrateLocalAttachments(){
    if(!currentUser || !databaseReady) return;
    const records = await readAllIndexedDbAttachments();
    for(const record of records){
      if(!record || !record.locationId || !record.type || !record.blob) continue;
      await saveAttachment(record.locationId, record.type, record.blob, record.name, {
        silent:true,
        skipIfNewer:true,
        localUpdatedAt:record.updatedAt || ''
      });
    }
  }

  function scheduleAttachmentMigration(){
    if(!currentUser) return;
    const marker='slogi_attachment_migration_'+currentUser.id;
    try{if(sessionStorage.getItem(marker)==='1')return;sessionStorage.setItem(marker,'1');}catch(err){}
    const run=()=>migrateLocalAttachments().catch(()=>{});
    if('requestIdleCallback' in window) requestIdleCallback(run,{timeout:6000});
    else setTimeout(run,3500);
  }

  async function signOutSafely(){
    dialogMessage('Сохраняю последние изменения…', false);
    const saved = await flushState();
    if(!saved){dialogMessage('Не удалось сохранить данные. Выход отменён.', true);return;}
    const {error} = await client.auth.signOut();
    if(error){dialogMessage(humanError(error), true);return;}
    nativeSetLocations('[]');
    try{indexedDB.deleteDatabase(FILES_DB_NAME);}catch(err){}
    hideDialog();
    location.reload();
  }

  async function handleSignedIn(user){
    currentUser = user;
    updateUi();
    hideDialog();
    const ok = await syncFromCloud();
    if(ok) showToast('Вход выполнен. Данные синхронизированы.', false);
  }

  async function init(){
    if(initStarted) return;
    initStarted=true;
    try{
      await loadSdk();
      client = window.supabase.createClient(PROJECT_URL, PUBLISHABLE_KEY, {
        auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}
      });
      window.SlogiCloud.client = client;

      const {data:{session}} = await client.auth.getSession();
      currentUser = session && session.user ? session.user : null;
      updateUi();

      const authListener = client.auth.onAuthStateChange((event, sessionNow) => {
        currentUser = sessionNow && sessionNow.user ? sessionNow.user : null;
        updateUi();
        if(event === 'PASSWORD_RECOVERY'){
          setTimeout(() => showDialog('recovery'), 0);
        }else if(event === 'SIGNED_IN' && currentUser && !cloudReady && !initialSyncRunning){
          setTimeout(() => handleSignedIn(currentUser), 0);
        }else if(event === 'USER_UPDATED' && currentUser){
          updateUi();
        }else if(event === 'SIGNED_OUT'){
          cloudReady = false;
          lastUploadedRaw = '';
          updateUi();
        }
      });
      authEventSubscription = authListener && authListener.data ? authListener.data.subscription : null;

      if(currentUser){
        await syncFromCloud();
      }else{
        cloudReady = false;
        updateUi();
      }
    }catch(error){
      cloudReady = false;
      updateUi();
      showToast('Supabase недоступен. Локальная версия сайта продолжит работать.', true);
    }
  }

  Storage.prototype.setItem = function(key, value){
    originalSetItem.call(this, key, value);
    if(internalWrite || this !== localStorage) return;
    if(key===STORAGE_KEY) scheduleStateUpload(String(value));
    if(key===WORKSPACE_KEY) scheduleWorkspaceUpload(String(value));
  };

  window.SlogiCloud = {
    get enabled(){return Boolean(currentUser && client && databaseReady);},
    get ready(){return cloudReady;},
    get user(){return currentUser;},
    client:null,
    showLogin(){showDialog(currentUser ? 'account' : 'login');},
    sync(){return syncFromCloud({forceReload:true, manual:true});},
    getAttachment,
    saveAttachment,
    deleteAttachments
  };

  function startCloud(){
    const run=()=>init();
    const schedule=()=>{
      if('requestIdleCallback' in window) requestIdleCallback(run,{timeout:3500});
      else setTimeout(run,500);
    };
    /* Сначала отдаём браузеру время на первый экран и обработчики кликов. */
    setTimeout(schedule,1200);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded',()=>{ensureUi();startCloud();},{once:true});
  }else{
    ensureUi();startCloud();
  }
  let resizeFrame=0;
  window.addEventListener('resize',()=>{if(resizeFrame)return;resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;updateUi();});},{passive:true});
})();
