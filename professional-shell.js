(function(){
'use strict';
const P=window.SlogiPro;if(!P)return;
const esc=v=>String(v==null?'':v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const page=location.pathname.split('/').pop()||'index.html';
const ACTIVE_PROJECT_KEY='slogi_active_project_v1';
const OBJECT_PAGES=['passport.html','source-specification.html','specification.html','proposal.html'];
const ADMIN_PAGES=['catalog.html','team.html','settings.html'];
const STAGES=[
  {id:1,name:'Первичная оценка объекта',short:'Первичная оценка'},
  {id:2,name:'Замеры и расчёт концепции',short:'Замеры и расчёт'},
  {id:3,name:'Согласование условий аренды',short:'Согласование аренды'},
  {id:4,name:'Подготовка к ремонту',short:'Подготовка к ремонту'},
  {id:5,name:'Ремонт и подготовка к открытию',short:'Ремонт'},
  {id:6,name:'Открытие и закрытие проекта',short:'Открытие'}
];
const pageTitles={
  'index.html':['Объекты','Карта сети, кластеры и карточки объектов'],
  'passport.html':['Рабочее пространство объекта','Обзор, этапы, документы, сроки и финансы'],
  'source-specification.html':['Расчётная спецификация','Исходные позиции и подтверждение данных для точной сметы'],
  'specification.html':['Смета объекта','Расчёт по подтверждённой спецификации'],
  'proposal.html':['Коммерческое предложение','Редактирование и выгрузка по корпоративному шаблону'],
  'tasks.html':['Задачи по всем объектам','Поручения, сроки и ответственные по сети'],
  'documents.html':['Документы по всем объектам','Единый реестр файлов и версий'],
  'approvals.html':['Согласования по всем объектам','Решения, замечания и статусы согласования'],
  'finance.html':['Финансы по всем объектам','Бюджеты, обязательства и оплаты по сети'],
  'contractors.html':['Подрядчики и поставщики','Контрагенты, договоры и предложения'],
  'analytics.html':['Аналитика сети','Сводные показатели и контроль отклонений'],
  'catalog.html':['Справочники','Цены, шаблоны и нормативные данные'],
  'team.html':['Команда и доступ','Сотрудники, роли и права'],
  'settings.html':['Настройки системы','Рабочие процессы, безопасность и резервные копии']
};
const globalLinks=[
  ['index.html','Объекты'],['tasks.html','Задачи'],['documents.html','Документы'],
  ['finance.html','Финансы'],['contractors.html','Подрядчики'],['analytics.html','Аналитика']
];
const extraLinks=[['approvals.html','Согласования']];
const adminLinks=[['catalog.html','Справочники'],['team.html','Команда'],['settings.html','Настройки']];
function queryId(){return new URLSearchParams(location.search).get('location')||''}
function availableProjects(){return P.readLocations().filter(x=>x&&x.id&&!x.deletedAt)}
function activeProjectId(){
  const requested=queryId();
  if(requested){localStorage.setItem(ACTIVE_PROJECT_KEY,requested);return requested}
  const saved=localStorage.getItem(ACTIVE_PROJECT_KEY)||'';
  return availableProjects().some(x=>String(x.id)===String(saved))?saved:'';
}
function setActiveProject(id){if(id)localStorage.setItem(ACTIVE_PROJECT_KEY,id);else localStorage.removeItem(ACTIVE_PROJECT_KEY)}
function activeProject(){const id=activeProjectId();return availableProjects().find(x=>String(x.id)===String(id))||null}
function stageNumber(project){return Math.min(6,Math.max(1,Number(project&&(project.stage||project.phase))||1))}
function stageLabel(project,short=true){const s=STAGES.find(x=>x.id===stageNumber(project))||STAGES[0];return short?s.short:s.name}
function normalizeHeader(){
  let header=document.querySelector('.site-header');
  if(!header){header=document.createElement('header');header.className='site-header';document.body.insertBefore(header,document.body.firstChild)}
  const account=document.getElementById('slogi-account-nav');
  const configured=pageTitles[page]||[(document.querySelector('.site-header h1')?.textContent||'СЛОГИ'),(document.querySelector('.site-header .subtitle')?.textContent||'')];
  header.innerHTML=`<div class="top"><div class="brand"><a class="logo-link" href="index.html" aria-label="СЛОГИ — объекты"><div class="logo-word" aria-hidden="true"><span>С</span><span>Л</span><span>О</span><span>Г</span><span>И</span></div></a><div class="title-wrap"><h1>${esc(configured[0])}</h1><div class="subtitle">${esc(configured[1])}</div></div></div></div>`;
  if(account)header.querySelector('.top').appendChild(account);
  document.title='СЛОГИ — '+configured[0];
}
function isPage(file){return page===file}
function dropdownHtml(id,label,links,isActive){return `<div class="pro-management"><button type="button" class="pro-management-trigger ${isActive?'active':''}" id="${id}-trigger">${label} <span>⌄</span></button><div class="pro-management-menu" id="${id}-menu">${links.filter(([file])=>P.can(file,'view')).map(([file,text])=>`<a href="${file}" class="${isPage(file)?'active':''}">${text}</a>`).join('')}</div></div>`}
function bindDropdown(nav,id){const trigger=nav.querySelector(`#${id}-trigger`),menu=nav.querySelector(`#${id}-menu`);if(!trigger||!menu)return;trigger.onclick=e=>{e.stopPropagation();document.querySelectorAll('.pro-management-menu.open').forEach(x=>{if(x!==menu)x.classList.remove('open')});menu.classList.toggle('open')};menu.onclick=e=>e.stopPropagation()}
function addNav(){
  if(document.querySelector('.pro-nav'))return;
  const header=document.querySelector('.site-header');if(!header)return;
  const state=P.read(),unread=state.notifications.filter(x=>!x.read).length;
  const nav=document.createElement('nav');nav.className='pro-nav';nav.setAttribute('aria-label','Разделы по всей сети');
  nav.innerHTML=`<div class="pro-nav-inner"><span class="pro-nav-scope">Вся сеть</span>${globalLinks.filter(([file])=>P.can(file,'view')).map(([file,label])=>`<a href="${file}" class="${isPage(file)?'active':''}">${label}</a>`).join('')}${dropdownHtml('pro-extra','Ещё',extraLinks,extraLinks.some(([f])=>isPage(f)))}<span class="pro-nav-spacer"></span>${dropdownHtml('pro-management','Управление',adminLinks,ADMIN_PAGES.includes(page))}<div class="pro-global-search-wrap"><input class="pro-global-search" id="pro-global-search" type="search" placeholder="Поиск по системе…" aria-label="Глобальный поиск"><button type="button" id="pro-global-search-btn" aria-label="Найти">⌕</button></div><button type="button" class="pro-notification-btn" id="pro-notification-btn" aria-label="Уведомления">🔔${unread?`<span class="pro-notification-count">${unread}</span>`:''}</button></div>`;
  header.appendChild(nav);header.classList.add('has-pro-nav');
  nav.querySelector('#pro-notification-btn').addEventListener('click',toggleDrawer);
  const input=nav.querySelector('#pro-global-search');
  nav.querySelector('#pro-global-search-btn').onclick=()=>runGlobalSearch(input.value);
  input.addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();runGlobalSearch(input.value)}});
  bindDropdown(nav,'pro-extra');bindDropdown(nav,'pro-management');
  document.addEventListener('click',()=>document.querySelectorAll('.pro-management-menu.open').forEach(x=>x.classList.remove('open')));
}
function objectHref(file,id,extra){if(!id)return'#';const q=new URLSearchParams({location:id});if(extra)Object.entries(extra).forEach(([k,v])=>q.set(k,v));return file+'?'+q.toString()}
function currentTab(){return new URLSearchParams(location.search).get('tab')||'overview'}
function objectLinkActive(kind){
  const tab=currentTab();
  if(kind==='overview')return page==='passport.html'&&tab==='overview';
  if(kind==='stages')return page==='passport.html'&&tab==='stages';
  if(kind==='documents')return page==='passport.html'&&tab==='documents';
  if(kind==='calculations')return ['source-specification.html','specification.html'].includes(page)||(page==='passport.html'&&tab==='calculations');
  if(kind==='proposal')return page==='proposal.html'||(page==='passport.html'&&tab==='proposal');
  if(kind==='schedule')return page==='passport.html'&&tab==='schedule';
  if(kind==='finance')return page==='passport.html'&&tab==='finance';
  if(kind==='history')return page==='passport.html'&&tab==='history';
  return false;
}
function addObjectContext(){
  const header=document.querySelector('.site-header');if(!header||document.querySelector('.object-context-bar'))return;
  const projects=availableProjects(),current=activeProject();
  const bar=document.createElement('div');bar.className='object-context-bar';
  bar.innerHTML=`<div class="object-context-inner"><span class="object-context-scope">Выбранный объект</span><select id="active-object-select" aria-label="Выбранный объект"><option value="">Выберите объект…</option>${projects.map(p=>`<option value="${esc(p.id)}" ${current&&String(current.id)===String(p.id)?'selected':''}>${esc(p.address||'Объект без адреса')}</option>`).join('')}</select><span class="object-stage-chip" id="object-stage-chip">${current?esc(stageLabel(current)):'Объект не выбран'}</span><div class="object-context-links"><a data-kind="overview" class="${objectLinkActive('overview')?'active':''}">Обзор</a><a data-kind="stages" class="${objectLinkActive('stages')?'active':''}">Этапы</a><a data-kind="documents" class="${objectLinkActive('documents')?'active':''}">Документы</a><a data-kind="calculations" class="${objectLinkActive('calculations')?'active':''}">Расчёты</a><a data-kind="proposal" class="${objectLinkActive('proposal')?'active':''}">КП</a><a data-kind="schedule" class="${objectLinkActive('schedule')?'active':''}">Работы и сроки</a><a data-kind="finance" class="${objectLinkActive('finance')?'active':''}">Финансы</a><a data-kind="history" class="${objectLinkActive('history')?'active':''}">История</a></div><a class="object-new-link" href="passport.html">＋ Новый объект</a></div>`;
  header.appendChild(bar);
  const select=bar.querySelector('#active-object-select');
  const updateLinks=id=>{
    const selected=projects.find(x=>String(x.id)===String(id));
    bar.querySelector('#object-stage-chip').textContent=selected?stageLabel(selected):'Объект не выбран';
    const map={
      overview:objectHref('passport.html',id),stages:objectHref('passport.html',id,{tab:'stages'}),documents:objectHref('passport.html',id,{tab:'documents'}),
      calculations:objectHref('passport.html',id,{tab:'calculations'}),proposal:objectHref('proposal.html',id),schedule:objectHref('passport.html',id,{tab:'schedule'}),
      finance:objectHref('passport.html',id,{tab:'finance'}),history:objectHref('passport.html',id,{tab:'history'})
    };
    bar.querySelectorAll('[data-kind]').forEach(a=>{a.href=map[a.dataset.kind]||'#';a.classList.toggle('disabled',!id);a.setAttribute('aria-disabled',id?'false':'true')});
    const subtitle=document.querySelector('.site-header .subtitle');
    if(OBJECT_PAGES.includes(page)&&subtitle&&selected)subtitle.textContent=selected.address||'Выбранный объект';
  };
  updateLinks(current&&current.id||'');
  select.onchange=()=>{
    const selectedId=select.value;setActiveProject(selectedId);updateLinks(selectedId);
    if(OBJECT_PAGES.includes(page)&&selectedId){
      const params=new URLSearchParams(location.search);params.set('location',selectedId);location.href=page+'?'+params.toString();
    }
  };
}
function ensureDrawer(){let d=document.getElementById('pro-drawer');if(d)return d;d=document.createElement('aside');d.id='pro-drawer';d.className='pro-drawer';d.innerHTML='<div class="pro-drawer-head"><div><strong>Уведомления</strong><div class="pro-muted" style="font-size:11px;margin-top:3px">Сроки, платежи и согласования</div></div><button class="pro-modal-close" id="pro-drawer-close" type="button">×</button></div><div class="pro-drawer-list" id="pro-drawer-list"></div>';document.body.appendChild(d);d.querySelector('#pro-drawer-close').addEventListener('click',()=>d.classList.remove('open'));return d}
function seedNotifications(){const s=P.read();if(s.notifications.length)return;const today=new Date().toISOString().slice(0,10),overdue=s.tasks.filter(t=>t.dueDate&&t.dueDate<today&&!['Готово','Отменена'].includes(t.status));if(overdue.length)s.notifications.push({id:P.uid('note'),title:'Просроченные задачи',text:`Требуют внимания: ${overdue.length}`,link:'tasks.html?filter=overdue',read:false,createdAt:P.now()});const pending=s.approvals.filter(a=>['На согласовании','Возвращено'].includes(a.status));if(pending.length)s.notifications.push({id:P.uid('note'),title:'Согласования',text:`Ожидают решения: ${pending.length}`,link:'approvals.html',read:false,createdAt:P.now()});if(s.notifications.length)P.write(s,'seed-notifications')}
function toggleDrawer(){seedNotifications();const d=ensureDrawer(),s=P.read(),list=d.querySelector('#pro-drawer-list');list.innerHTML=s.notifications.length?s.notifications.map(n=>`<div class="pro-note ${n.read?'':'unread'}"><h4>${esc(n.title)}</h4><p>${esc(n.text)}</p><time>${P.formatDate(n.createdAt,true)}</time>${n.link?`<a class="pro-btn small" style="margin-top:9px" href="${esc(n.link)}">Открыть</a>`:''}</div>`).join(''):'<div class="pro-empty">Новых уведомлений нет.</div>';d.classList.toggle('open');if(d.classList.contains('open')){s.notifications.forEach(n=>n.read=true);P.write(s,'notifications-read');document.querySelector('.pro-notification-count')?.remove()}}
function runGlobalSearch(query){const q=String(query||'').trim().toLowerCase();if(q.length<2){toast('Введите минимум два символа');return}const s=P.read(),projects=P.readLocations(),results=[];projects.filter(x=>String(x.address||'').toLowerCase().includes(q)).forEach(x=>results.push({type:'Объект',title:x.address,sub:stageLabel(x,false)+' · '+(x.status||x.projectStatus||'Новый'),href:'passport.html?location='+encodeURIComponent(x.id)}));s.tasks.filter(x=>String(x.title||'').toLowerCase().includes(q)).forEach(x=>results.push({type:'Задача',title:x.title,sub:P.projectName(x.projectId)+' · '+x.status,href:'tasks.html?project='+encodeURIComponent(x.projectId||'')}));s.documentVersions.filter(x=>String(x.name||'').toLowerCase().includes(q)||String(x.type||'').toLowerCase().includes(q)).forEach(x=>results.push({type:'Документ',title:x.name,sub:P.projectName(x.projectId)+' · '+x.version,href:'documents.html?project='+encodeURIComponent(x.projectId||'')}));s.contractors.filter(x=>String(x.name||'').toLowerCase().includes(q)||String(x.inn||'').toLowerCase().includes(q)).forEach(x=>results.push({type:'Подрядчик',title:x.name,sub:x.speciality||'',href:'contractors.html'}));modal({title:'Результаты поиска',saveLabel:'Закрыть',body:results.length?'<div class="pro-stack">'+results.slice(0,30).map(r=>`<a class="pro-list-item" href="${esc(r.href)}" style="color:inherit;text-decoration:none"><div><div class="pro-list-title">${esc(r.title)}</div><div class="pro-list-sub">${esc(r.type)} · ${esc(r.sub)}</div></div><span class="pro-status neutral">Открыть</span></a>`).join('')+'</div>':'<div class="pro-empty">Ничего не найдено</div>',onSave:()=>true})}
function toast(text){let t=document.getElementById('pro-toast');if(!t){t=document.createElement('div');t.id='pro-toast';t.className='pro-toast';document.body.appendChild(t)}t.textContent=text;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),2600)}
function modal(opts){const backdrop=document.createElement('div');backdrop.className='pro-modal-backdrop open';backdrop.innerHTML=`<div class="pro-modal" role="dialog" aria-modal="true"><div class="pro-modal-head"><h2>${esc(opts.title||'')}</h2><button type="button" class="pro-modal-close">×</button></div><div class="pro-modal-body">${opts.body||''}</div><div class="pro-modal-actions"><button type="button" class="pro-btn" data-cancel>Отмена</button><button type="button" class="pro-btn primary" data-save>${esc(opts.saveLabel||'Сохранить')}</button></div></div>`;document.body.appendChild(backdrop);const close=()=>backdrop.remove();backdrop.querySelector('.pro-modal-close').onclick=close;backdrop.querySelector('[data-cancel]').onclick=close;backdrop.addEventListener('click',e=>{if(e.target===backdrop)close()});backdrop.querySelector('[data-save]').onclick=async()=>{const button=backdrop.querySelector('[data-save]');button.disabled=true;try{const result=opts.onSave&&opts.onSave(backdrop);const resolved=result&&typeof result.then==='function'?await result:result;if(resolved!==false)close()}finally{if(document.body.contains(button))button.disabled=false}};return backdrop}
function syncShellHeight(header){const apply=()=>document.documentElement.style.setProperty('--app-shell-height',(header.offsetHeight||166)+'px');apply();if('ResizeObserver'in window){const ro=new ResizeObserver(()=>requestAnimationFrame(apply));ro.observe(header);header._slogiResizeObserver=ro}else window.addEventListener('resize',apply,{passive:true})}
function init(){normalizeHeader();addNav();addObjectContext();const header=document.querySelector('.site-header');if(header)syncShellHeight(header)}
window.SlogiUI={esc,toast,modal,page,activeProjectId,activeProject,stageLabel,stages:STAGES};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
window.addEventListener('slogi:professional-state',()=>{const count=document.querySelector('.pro-notification-count'),unread=P.read().notifications.filter(x=>!x.read).length;if(unread){if(count)count.textContent=unread;else{const b=document.getElementById('pro-notification-btn');if(b)b.insertAdjacentHTML('beforeend',`<span class="pro-notification-count">${unread}</span>`)}}else count?.remove()});
window.addEventListener('slogi:locations-updated',()=>{document.querySelector('.object-context-bar')?.remove();addObjectContext()});
})();
