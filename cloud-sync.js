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
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  const PRODUCTION_SITE_URL = 'https://motomaria16-jpg.github.io/slogi-estimate/';

  let client = null;
  let currentUser = null;
  let syncTimer = null;
  let lastUploadedRaw = '';
  let internalWrite = false;
  let cloudReady = false;
  let databaseReady = true;
  let authEventSubscription = null;
  let initialSyncRunning = false;

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

  function localRaw(){
    try{return normalizeRaw(localStorage.getItem(STORAGE_KEY) || '[]');}
    catch(err){return '[]';}
  }

  function nativeSetLocations(raw){
    internalWrite = true;
    try{originalSetItem.call(localStorage, STORAGE_KEY, normalizeRaw(raw));}
    finally{internalWrite = false;}
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
      text.includes('slogi_user_state') || text.includes('slogi_attachments') ||
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
      .slogi-account-nav{position:relative;z-index:2147483000;flex:0 0 auto;margin-left:auto;color:#33474b;font-family:Arial,sans-serif}
      .slogi-account-trigger{display:flex;align-items:center;gap:10px;max-width:330px;min-height:48px;padding:6px 10px 6px 7px;border:1px solid rgba(55,84,90,.18);border-radius:14px;background:#fff;color:#33474b;box-shadow:0 5px 18px rgba(51,71,75,.10);cursor:pointer;text-align:left;transition:.16s ease}
      .slogi-account-trigger:hover,.slogi-account-trigger[aria-expanded="true"]{border-color:rgba(79,143,145,.55);box-shadow:0 7px 22px rgba(51,71,75,.16)}
      .slogi-account-avatar{position:relative;display:grid;place-items:center;width:35px;height:35px;flex:0 0 35px;border-radius:11px;background:#e8f1f1;color:#37545a;font:900 12px/1 Arial,sans-serif;letter-spacing:.02em}
      .slogi-account-avatar::after{content:"";position:absolute;right:-2px;bottom:-2px;width:9px;height:9px;border:2px solid #fff;border-radius:50%;background:#c7a87b}
      .slogi-account-nav[data-state="online"] .slogi-account-avatar::after{background:#3aaa77}
      .slogi-account-nav[data-state="syncing"] .slogi-account-avatar::after{background:#dc972d;animation:slogiAccountPulse 1s infinite alternate}
      .slogi-account-nav[data-state="error"] .slogi-account-avatar::after{background:#d75c5c}
      @keyframes slogiAccountPulse{to{opacity:.35}}
      .slogi-account-summary{display:grid;min-width:0;gap:2px}
      .slogi-account-summary strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#33474b;font:800 13px/1.15 Arial,sans-serif}
      .slogi-account-summary span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#76878b;font:600 11px/1.15 Arial,sans-serif}
      .slogi-account-chevron{width:8px;height:8px;flex:0 0 8px;margin:0 2px 4px 5px;border-right:2px solid #6c8084;border-bottom:2px solid #6c8084;transform:rotate(45deg);transition:.16s ease}
      .slogi-account-trigger[aria-expanded="true"] .slogi-account-chevron{margin-bottom:-3px;transform:rotate(225deg)}
      .slogi-account-panel{position:absolute;top:calc(100% + 10px);right:0;width:min(410px,calc(100vw - 24px));max-height:calc(100vh - 100px);overflow:auto;display:none;padding:18px;border:1px solid rgba(55,84,90,.14);border-radius:18px;background:#fff;box-shadow:0 24px 70px rgba(27,42,46,.25);color:#33474b;font:14px/1.4 Arial,sans-serif}
      .slogi-account-panel.show{display:block}
      .slogi-account-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:15px}
      .slogi-account-panel h2{margin:0;color:#33474b;font:850 21px/1.15 Arial,sans-serif}
      .slogi-account-panel h3{margin:0 0 10px;color:#455e63;font:850 14px/1.2 Arial,sans-serif}
      .slogi-account-email{margin-top:4px;color:#7a8b8e;font-size:12px;overflow-wrap:anywhere}
      .slogi-account-close{display:grid;place-items:center;width:32px;height:32px;flex:0 0 32px;border:0;border-radius:50%;background:#f1f4f4;color:#4b6267;font-size:20px;line-height:1;cursor:pointer}
      .slogi-account-section{padding:14px 0;border-top:1px solid #e6ecec}
      .slogi-account-section:first-of-type{padding-top:0;border-top:0}
      .slogi-cloud-field{display:grid;gap:6px;margin:10px 0}
      .slogi-cloud-field span{font-weight:800;color:#455e63;font-size:12px}
      .slogi-cloud-field input{width:100%;box-sizing:border-box;min-height:44px;border:1px solid #ccd7d8;border-radius:10px;padding:10px 12px;background:#fff;color:#24383c;font:16px Arial,sans-serif;outline:none}
      .slogi-cloud-field input[readonly]{background:#f5f7f7;color:#697b7f}
      .slogi-cloud-field input:focus{border-color:#579b9d;box-shadow:0 0 0 3px rgba(87,155,157,.13)}
      .slogi-cloud-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:13px}
      .slogi-cloud-actions.single{grid-template-columns:1fr}
      .slogi-cloud-action{min-height:44px;border:0;border-radius:10px;padding:10px 12px;font:800 13px Arial,sans-serif;cursor:pointer}
      .slogi-cloud-primary{background:#4f8f91;color:#fff}
      .slogi-cloud-secondary{background:#eef3f3;color:#37545a}
      .slogi-cloud-danger{background:#fff0ef;color:#a63f3f}
      .slogi-cloud-link{display:inline-block;margin-top:11px;border:0;background:transparent;color:#4f8f91;text-decoration:underline;font:700 13px Arial,sans-serif;cursor:pointer;padding:0}
      .slogi-cloud-message{display:none;margin:12px 0 0;padding:10px 11px;border-radius:9px;background:#edf7f3;color:#2f7658;font-weight:700;overflow-wrap:anywhere}
      .slogi-cloud-message.show{display:block}
      .slogi-cloud-message.error{background:#fff0ef;color:#9d4141}
      .slogi-cloud-note{margin:9px 0 0;color:#7b8b8e;font-size:11.5px;line-height:1.4}
      .slogi-cloud-toast{position:fixed;right:16px;bottom:16px;z-index:2147483100;max-width:min(390px,calc(100vw - 32px));padding:11px 14px;border-radius:12px;background:#33474b;color:#fff;box-shadow:0 10px 30px rgba(31,45,49,.24);font:700 13px/1.35 Arial,sans-serif;opacity:0;transform:translateY(8px);pointer-events:none;transition:.2s}
      .slogi-cloud-toast.show{opacity:1;transform:none}
      .slogi-cloud-toast.error{background:#a94747}
      @media(max-width:760px){
        .slogi-account-nav{order:20;width:100%;margin-left:0}
        .slogi-account-trigger{width:100%;max-width:none;min-height:44px;padding:5px 8px 5px 6px;border-radius:12px}
        .slogi-account-avatar{width:32px;height:32px;flex-basis:32px;border-radius:9px}
        .slogi-account-summary{flex:1}
        .slogi-account-summary strong{font-size:12px}
        .slogi-account-summary span{font-size:10px}
        .slogi-account-chevron{margin-left:auto}
        .slogi-account-panel{position:absolute;top:calc(100% + 8px);right:0;left:0;width:100%;max-height:calc(100vh - 145px);padding:16px;border-radius:16px}
        .slogi-cloud-actions{grid-template-columns:1fr}
        .slogi-cloud-toast{right:10px;bottom:10px;max-width:calc(100vw - 20px)}
      }
      @media(max-width:430px){
        .site-header .top{gap:8px!important}
      }
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

  function showDialog(mode){
    ensureUi();
    const panel = document.getElementById('slogi-account-panel');
    const trigger = document.getElementById('slogi-account-trigger');
    if(!panel || !trigger) return;

    if(mode === 'account' && currentUser){
      const meta = userMetadata();
      panel.innerHTML = `
        ${panelHeader('Личный кабинет', currentUser.email || '')}
        <div class="slogi-account-section">
          <label class="slogi-cloud-field"><span>ФИО</span><input id="slogi-profile-name" type="text" autocomplete="name" maxlength="160" placeholder="Введите фамилию, имя и отчество" value="${escapeHtml(meta.full_name || meta.name || '')}"></label>
          <label class="slogi-cloud-field"><span>Должность</span><input id="slogi-profile-position" type="text" autocomplete="organization-title" maxlength="120" placeholder="Например: руководитель проекта" value="${escapeHtml(meta.position || meta.job_title || '')}"></label>
          <div class="slogi-cloud-actions single"><button type="button" class="slogi-cloud-action slogi-cloud-primary" id="slogi-profile-save">Сохранить личные данные</button></div>
        </div>
        <div class="slogi-account-section">
          <h3>Смена пароля</h3>
          <label class="slogi-cloud-field"><span>Новый пароль</span><input id="slogi-profile-password" type="password" minlength="8" autocomplete="new-password" placeholder="Не менее 8 символов"></label>
          <label class="slogi-cloud-field"><span>Повторите пароль</span><input id="slogi-profile-password-repeat" type="password" minlength="8" autocomplete="new-password"></label>
          <div class="slogi-cloud-actions single"><button type="button" class="slogi-cloud-action slogi-cloud-secondary" id="slogi-profile-password-save">Сменить пароль</button></div>
        </div>
        <div class="slogi-cloud-message" id="slogi-cloud-message"></div>
        <div class="slogi-account-section"><button type="button" class="slogi-cloud-action slogi-cloud-danger" id="slogi-cloud-signout" style="width:100%">Выйти из личного кабинета</button></div>`;
      bindPanelClose(panel);
      panel.querySelector('#slogi-profile-save').addEventListener('click', async () => {
        const fullName = panel.querySelector('#slogi-profile-name').value.trim();
        const position = panel.querySelector('#slogi-profile-position').value.trim();
        dialogMessage('Сохраняю данные…', false);
        const {data, error} = await client.auth.updateUser({data:{full_name:fullName, position}});
        if(error){dialogMessage(humanError(error), true);return;}
        if(data && data.user) currentUser = data.user;
        updateUi();
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

  async function flushState(){
    clearTimeout(syncTimer);
    return uploadState(localRaw());
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

      await migrateLocalAttachments();
      cloudReady = true;
      window.dispatchEvent(new CustomEvent('slogi:cloud-ready', {detail:{user:currentUser}}));

      const changed = targetRaw !== beforeRaw;
      if(changed || options.forceReload){
        const marker = 'slogi_cloud_reload_' + simpleHash(targetRaw);
        if(sessionStorage.getItem('slogi_cloud_last_reload') !== marker){
          sessionStorage.setItem('slogi_cloud_last_reload', marker);
          setTimeout(() => location.reload(), options.manual ? 250 : 80);
        }
      }
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
        }else if(event === 'SIGNED_IN' && currentUser){
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
    if(internalWrite || this !== localStorage || key !== STORAGE_KEY) return;
    scheduleStateUpload(String(value));
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

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ensureUi, {once:true});
  }else{
    ensureUi();
  }
  window.addEventListener('resize', updateUi);
  init();
})();
