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
      .slogi-cloud-button{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:inline-flex;align-items:center;gap:8px;max-width:min(360px,calc(100vw - 32px));min-height:44px;padding:10px 14px;border:1px solid rgba(55,84,90,.18);border-radius:999px;background:#fff;color:#37545a;box-shadow:0 10px 30px rgba(51,71,75,.2);font:800 13px/1.2 Arial,sans-serif;cursor:pointer}
      .slogi-cloud-button:hover{transform:translateY(-1px)}
      .slogi-cloud-dot{width:10px;height:10px;flex:0 0 10px;border-radius:50%;background:#c7a87b;box-shadow:0 0 0 4px rgba(199,168,123,.14)}
      .slogi-cloud-button[data-state="online"] .slogi-cloud-dot{background:#3aaa77;box-shadow:0 0 0 4px rgba(58,170,119,.14)}
      .slogi-cloud-button[data-state="syncing"] .slogi-cloud-dot{background:#dc972d;box-shadow:0 0 0 4px rgba(220,151,45,.14);animation:slogiCloudPulse 1s infinite alternate}
      .slogi-cloud-button[data-state="error"] .slogi-cloud-dot{background:#d75c5c;box-shadow:0 0 0 4px rgba(215,92,92,.14)}
      @keyframes slogiCloudPulse{to{opacity:.45}}
      .slogi-cloud-overlay{position:fixed;inset:0;z-index:2147483200;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(31,46,50,.5);backdrop-filter:blur(4px)}
      .slogi-cloud-overlay.show{display:flex}
      .slogi-cloud-dialog{width:min(460px,100%);max-height:calc(100vh - 36px);overflow:auto;border-radius:20px;background:#fff;box-shadow:0 25px 70px rgba(27,42,46,.3);padding:24px;color:#33474b;font:14px/1.45 Arial,sans-serif}
      .slogi-cloud-dialog h2{margin:0 36px 6px 0;font:800 23px/1.15 Arial,sans-serif;color:#33474b}
      .slogi-cloud-dialog p{margin:0 0 16px;color:#66787c}
      .slogi-cloud-close{position:absolute;margin:-8px 0 0 386px;width:36px;height:36px;border:0;border-radius:50%;background:#f1f4f4;color:#37545a;font-size:22px;cursor:pointer}
      .slogi-cloud-field{display:grid;gap:6px;margin:12px 0}
      .slogi-cloud-field span{font-weight:800;color:#455e63}
      .slogi-cloud-field input{width:100%;box-sizing:border-box;min-height:46px;border:1px solid #ccd7d8;border-radius:11px;padding:11px 12px;background:#fff;color:#24383c;font:16px Arial,sans-serif;outline:none}
      .slogi-cloud-field input:focus{border-color:#579b9d;box-shadow:0 0 0 3px rgba(87,155,157,.13)}
      .slogi-cloud-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:16px}
      .slogi-cloud-action{min-height:46px;border:0;border-radius:11px;padding:10px 12px;font:800 14px Arial,sans-serif;cursor:pointer}
      .slogi-cloud-primary{background:#4f8f91;color:#fff}
      .slogi-cloud-secondary{background:#eef3f3;color:#37545a}
      .slogi-cloud-danger{background:#fff0ef;color:#a63f3f}
      .slogi-cloud-link{display:inline-block;margin-top:12px;border:0;background:transparent;color:#4f8f91;text-decoration:underline;font:700 13px Arial,sans-serif;cursor:pointer}
      .slogi-cloud-message{display:none;margin:13px 0 0;padding:11px 12px;border-radius:10px;background:#edf7f3;color:#2f7658;font-weight:700;overflow-wrap:anywhere}
      .slogi-cloud-message.show{display:block}
      .slogi-cloud-message.error{background:#fff0ef;color:#9d4141}
      .slogi-cloud-account{padding:12px;border-radius:12px;background:#f3f7f7;margin:13px 0;overflow-wrap:anywhere}
      .slogi-cloud-note{font-size:12px!important;color:#7b8b8e!important;margin-top:14px!important}
      .slogi-cloud-toast{position:fixed;right:16px;bottom:72px;z-index:2147483100;max-width:min(390px,calc(100vw - 32px));padding:11px 14px;border-radius:12px;background:#33474b;color:#fff;box-shadow:0 10px 30px rgba(31,45,49,.24);font:700 13px/1.35 Arial,sans-serif;opacity:0;transform:translateY(8px);pointer-events:none;transition:.2s}
      .slogi-cloud-toast.show{opacity:1;transform:none}
      .slogi-cloud-toast.error{background:#a94747}
      @media(max-width:600px){
        body{padding-bottom:68px!important}
        .slogi-cloud-button{right:10px;bottom:10px;max-width:calc(100vw - 20px);min-height:46px}
        .slogi-cloud-dialog{padding:20px 16px;border-radius:16px}
        .slogi-cloud-close{right:28px;top:28px;margin:0;position:fixed}
        .slogi-cloud-actions{grid-template-columns:1fr}
        .slogi-cloud-toast{right:10px;bottom:67px;max-width:calc(100vw - 20px)}
      }
    `;
    document.head.appendChild(style);
  }

  function ensureUi(){
    if(!document.body || document.getElementById('slogi-cloud-button')) return;
    addStyles();

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'slogi-cloud-button';
    button.className = 'slogi-cloud-button';
    button.dataset.state = 'offline';
    button.innerHTML = '<span class="slogi-cloud-dot"></span><span class="slogi-cloud-label">Облако: войти</span>';
    button.addEventListener('click', () => showDialog(currentUser ? 'account' : 'login'));

    const overlay = document.createElement('div');
    overlay.id = 'slogi-cloud-overlay';
    overlay.className = 'slogi-cloud-overlay';
    overlay.innerHTML = `
      <div class="slogi-cloud-dialog" role="dialog" aria-modal="true" aria-labelledby="slogi-cloud-title">
        <button class="slogi-cloud-close" type="button" aria-label="Закрыть">×</button>
        <div id="slogi-cloud-content"></div>
      </div>`;
    overlay.addEventListener('click', event => {if(event.target === overlay) hideDialog();});
    overlay.querySelector('.slogi-cloud-close').addEventListener('click', hideDialog);

    const toast = document.createElement('div');
    toast.id = 'slogi-cloud-toast';
    toast.className = 'slogi-cloud-toast';

    document.body.appendChild(button);
    document.body.appendChild(overlay);
    document.body.appendChild(toast);
    updateUi();
  }

  function setButtonState(state, label){
    const button = document.getElementById('slogi-cloud-button');
    if(!button) return;
    button.dataset.state = state;
    const labelEl = button.querySelector('.slogi-cloud-label');
    if(labelEl) labelEl.textContent = label;
  }

  function updateUi(){
    if(!document.body) return;
    ensureUi();
    if(!databaseReady){
      setButtonState('error', 'Облако: нужна настройка');
    }else if(initialSyncRunning){
      setButtonState('syncing', 'Облако: синхронизация…');
    }else if(currentUser){
      const email = currentUser.email || 'подключено';
      setButtonState('online', window.innerWidth < 560 ? 'Облако подключено' : 'Облако: ' + email);
    }else{
      setButtonState('offline', 'Облако: войти');
    }
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
    const overlay = document.getElementById('slogi-cloud-overlay');
    if(overlay) overlay.classList.remove('show');
  }

  function dialogMessage(text, isError){
    const message = document.getElementById('slogi-cloud-message');
    if(!message) return;
    message.textContent = text || '';
    message.className = 'slogi-cloud-message' + (text ? ' show' : '') + (isError ? ' error' : '');
  }

  function showDialog(mode){
    ensureUi();
    const overlay = document.getElementById('slogi-cloud-overlay');
    const content = document.getElementById('slogi-cloud-content');
    if(!overlay || !content) return;

    if(mode === 'account' && currentUser){
      content.innerHTML = `
        <h2 id="slogi-cloud-title">Облачная синхронизация</h2>
        <p>Адреса, паспорта, сметы, КП и файлы синхронизируются через Supabase.</p>
        <div class="slogi-cloud-account"><strong>Выполнен вход:</strong><br>${escapeHtml(currentUser.email || currentUser.id)}</div>
        <div class="slogi-cloud-actions">
          <button type="button" class="slogi-cloud-action slogi-cloud-primary" id="slogi-cloud-sync-now">Синхронизировать сейчас</button>
          <button type="button" class="slogi-cloud-action slogi-cloud-danger" id="slogi-cloud-signout">Выйти</button>
        </div>
        <div class="slogi-cloud-message" id="slogi-cloud-message"></div>
        <p class="slogi-cloud-note">После выхода локальная копия данных на этом устройстве будет очищена. В облаке данные сохранятся.</p>`;
      content.querySelector('#slogi-cloud-sync-now').addEventListener('click', async () => {
        dialogMessage('Синхронизация…', false);
        const ok = await syncFromCloud({forceReload:true, manual:true});
        if(ok) dialogMessage('Данные синхронизированы.', false);
      });
      content.querySelector('#slogi-cloud-signout').addEventListener('click', signOutSafely);
    }else if(mode === 'recovery'){
      content.innerHTML = `
        <h2 id="slogi-cloud-title">Новый пароль</h2>
        <p>Введите новый пароль для доступа к данным SLOGI.</p>
        <label class="slogi-cloud-field"><span>Новый пароль</span><input id="slogi-cloud-new-password" type="password" minlength="8" autocomplete="new-password" required></label>
        <div class="slogi-cloud-actions"><button type="button" class="slogi-cloud-action slogi-cloud-primary" id="slogi-cloud-update-password">Сохранить пароль</button></div>
        <div class="slogi-cloud-message" id="slogi-cloud-message"></div>`;
      content.querySelector('#slogi-cloud-update-password').addEventListener('click', async () => {
        const password = content.querySelector('#slogi-cloud-new-password').value;
        if(password.length < 8){dialogMessage('Пароль должен содержать не менее 8 символов.', true);return;}
        dialogMessage('Сохраняю новый пароль…', false);
        const {error} = await client.auth.updateUser({password});
        if(error){dialogMessage(humanError(error), true);return;}
        dialogMessage('Пароль изменён.', false);
        setTimeout(() => showDialog('account'), 900);
      });
    }else{
      content.innerHTML = `
        <h2 id="slogi-cloud-title">Вход в SLOGI</h2>
        <p>Используйте один и тот же аккаунт на компьютере и телефоне.</p>
        <label class="slogi-cloud-field"><span>Электронная почта</span><input id="slogi-cloud-email" type="email" autocomplete="email" placeholder="name@example.com" required></label>
        <label class="slogi-cloud-field"><span>Пароль</span><input id="slogi-cloud-password" type="password" minlength="8" autocomplete="current-password" placeholder="Не менее 8 символов" required></label>
        <div class="slogi-cloud-actions">
          <button type="button" class="slogi-cloud-action slogi-cloud-primary" id="slogi-cloud-login">Войти</button>
          <button type="button" class="slogi-cloud-action slogi-cloud-secondary" id="slogi-cloud-signup">Создать аккаунт</button>
        </div>
        <button type="button" class="slogi-cloud-link" id="slogi-cloud-forgot">Забыли пароль?</button>
        <div class="slogi-cloud-message" id="slogi-cloud-message"></div>
        <p class="slogi-cloud-note">При первом создании аккаунта Supabase может отправить письмо для подтверждения электронной почты.</p>`;
      const emailInput = content.querySelector('#slogi-cloud-email');
      const passwordInput = content.querySelector('#slogi-cloud-password');
      content.querySelector('#slogi-cloud-login').addEventListener('click', async () => {
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        if(!client){dialogMessage('Подключение к Supabase ещё загружается. Повторите через несколько секунд.', true);return;}
        if(!email || !password){dialogMessage('Введите электронную почту и пароль.', true);return;}
        dialogMessage('Выполняю вход…', false);
        const {error} = await client.auth.signInWithPassword({email, password});
        if(error){dialogMessage(humanError(error), true);return;}
        dialogMessage('Вход выполнен. Загружаю данные…', false);
      });
      content.querySelector('#slogi-cloud-signup').addEventListener('click', async () => {
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        if(!client){dialogMessage('Подключение к Supabase ещё загружается. Повторите через несколько секунд.', true);return;}
        if(!email || password.length < 8){dialogMessage('Укажите почту и пароль не короче 8 символов.', true);return;}
        dialogMessage('Создаю аккаунт…', false);
        const {data, error} = await client.auth.signUp({
          email,
          password,
          options:{emailRedirectTo:currentRedirectUrl()}
        });
        if(error){dialogMessage(humanError(error), true);return;}
        if(data && data.session){
          dialogMessage('Аккаунт создан. Загружаю данные…', false);
        }else{
          dialogMessage('Аккаунт создан. Откройте письмо Supabase и подтвердите электронную почту, затем войдите.', false);
        }
      });
      content.querySelector('#slogi-cloud-forgot').addEventListener('click', async () => {
        const email = emailInput.value.trim();
        if(!client){dialogMessage('Подключение к Supabase ещё загружается. Повторите через несколько секунд.', true);return;}
        if(!email){dialogMessage('Сначала укажите электронную почту.', true);return;}
        dialogMessage('Отправляю письмо для восстановления…', false);
        const {error} = await client.auth.resetPasswordForEmail(email, {redirectTo:currentRedirectUrl()});
        if(error){dialogMessage(humanError(error), true);return;}
        dialogMessage('Письмо отправлено. Перейдите по ссылке из письма.', false);
      });
      setTimeout(() => emailInput.focus(), 30);
    }
    overlay.classList.add('show');
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
    setButtonState('syncing', 'Облако: сохраняю…');
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
    if(ok) showToast('Облачная синхронизация подключена.', false);
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
        }else if((event === 'SIGNED_IN' || event === 'USER_UPDATED') && currentUser){
          setTimeout(() => handleSignedIn(currentUser), 0);
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
        if(!sessionStorage.getItem('slogi_cloud_login_prompted')){
          sessionStorage.setItem('slogi_cloud_login_prompted', '1');
          setTimeout(() => showDialog('login'), 650);
        }
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
