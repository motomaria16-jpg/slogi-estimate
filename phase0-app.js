(function(){
'use strict';

const S=window.SlogiPhase0;
if(!S)return;
const byId=id=>document.getElementById(id);
const one=(selector,root=document)=>root.querySelector(selector);
const all=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
const esc=S.esc;
const repo=S.projectRepository,competitive=S.competitiveRepository,clusters=S.clusterService,phaseService=S.phase0Service,listingService=S.listingImportService,geocoder=S.geocodingService,files=S.fileService;
const state={projects:[],visible:[],selectedId:'',hoverId:'',drawerProjectId:'',drawerRevision:null,drawerDirty:false,pendingLayout:null,lastFocused:null,competitiveCluster:'',quickFilter:'',map:null,syncing:false,listExpanded:false,addressGeocodeTimer:null,addressGeocodeSeq:0,backfillRunning:false};

function fmtNumber(value,max=0){return value==null||!Number.isFinite(Number(value))?'Нет данных':Number(value).toLocaleString('ru-RU',{maximumFractionDigits:max})}
function fmtMoney(value){return value==null||!Number.isFinite(Number(value))?'Нет данных':`${Math.round(Number(value)).toLocaleString('ru-RU')} ₽`}
function fmtDate(value,withTime=false){if(!value)return'Нет данных';const d=new Date(value);if(Number.isNaN(d.getTime()))return'Нет данных';return d.toLocaleString('ru-RU',withTime?{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}:{day:'2-digit',month:'2-digit',year:'numeric'})}
function statusClass(value){if(value===S.STATUS.SUITABLE)return'suitable';if(value===S.STATUS.REJECTED)return'rejected';if(value===S.STATUS.ANALYSING)return'analysing';if(value===S.STATUS.WAITING)return'waiting';return'no-answer'}
function shortStatus(value){if(value===S.STATUS.WAITING)return'Ждём информацию';if(value===S.STATUS.ANALYSING)return'Анализируем';return value||'Не отвечает'}
function deviationText(value){if(value==null)return'Нет данных';const sign=value>0?'+':value<0?'−':'';return`${sign}${Math.abs(value).toLocaleString('ru-RU',{maximumFractionDigits:1})}% от среднего`}
function cardDeviationText(value){if(value==null)return'Сравнение недоступно';const sign=value>0?'+':value<0?'−':'';return`${sign}${Math.abs(value).toLocaleString('ru-RU',{maximumFractionDigits:1})}% к кластеру`}
function deviationClass(value){if(value==null)return'';return value<=0?'good':'bad'}
function rentPeriodText(value){return value==='day'?'в день':value==='year'?'в год':'в месяц'}
function projectById(id){return state.projects.find(project=>String(project.id)===String(id))||null}
function rawProjectById(id){return repo.get(id)}
function readinessProgress(project){const phase=project.phase0||{},criteria=phase.selectionCriteria||{},measurement=phase.measurement||{},checks=[phase.status===S.STATUS.SUITABLE,project.area!=null&&phase.roomsCount!=null&&project.ceilingHeight!=null&&phase.rent&&phase.rent.period==='month'&&S.rentPerSqm(project.area,phase.rent.amount)!=null,Boolean(project.clusterId||project.clusterName),S.CRITERIA_KEYS.every(key=>criteria[key]===true),Boolean(phase.layout&&phase.layout.received),Boolean(phase.interest&&phase.interest.confirmed),measurement.status==='Выполнен'&&Boolean(measurement.date)];return{done:checks.filter(Boolean).length,total:checks.length}}
function nextAction(project){const phase=project.phase0||{},criteria=phase.selectionCriteria||{},measurement=phase.measurement||{};if(phase.status===S.STATUS.REJECTED)return{text:'Решение зафиксировано',tone:'muted'};if(phaseService.readiness(project).ready)return{text:'Готов к смете',tone:'ready'};if(phase.status!==S.STATUS.SUITABLE)return{text:'Дальше: принять решение',tone:''};if(!(project.area!=null&&phase.roomsCount!=null&&project.ceilingHeight!=null&&phase.rent&&phase.rent.period==='month'&&S.rentPerSqm(project.area,phase.rent.amount)!=null))return{text:'Дальше: заполнить параметры',tone:''};if(!(project.clusterId||project.clusterName))return{text:'Дальше: определить кластер',tone:''};if(!S.CRITERIA_KEYS.every(key=>criteria[key]===true))return{text:'Дальше: завершить отбор',tone:''};if(!(phase.layout&&phase.layout.received))return{text:'Дальше: получить планировку',tone:''};if(!(phase.interest&&phase.interest.confirmed))return{text:'Дальше: подтвердить интерес',tone:''};if(measurement.status==='Запланирован')return{text:'Дальше: выполнить замер',tone:'measure'};return{text:'Готов к замеру',tone:'measure'}}
function toast(message){const node=byId('phase0-toast');node.textContent=message;node.classList.add('show');clearTimeout(node._timer);node._timer=setTimeout(()=>node.classList.remove('show'),4200)}
function setUrlProject(id){const url=new URL(location.href);url.searchParams.delete('create');if(id)url.searchParams.set('location',id);else url.searchParams.delete('location');history.replaceState({},'',url.pathname+(url.search?url.search:''));if(id)localStorage.setItem('slogi_active_project_v1',id)}

function renderSyncStrip(){
  const snapshot=competitive.snapshot(),node=byId('phase0-sync-strip');let dot='',label='',details='';
  if(state.syncing||snapshot.status==='loading'){dot='warn';label='Читаем файл';details='Обрабатываем лист «Свод»'}
  else if(snapshot.status==='error'){dot='bad';label='Ошибка файла';details=snapshot.error||'Загрузите корректный XLSX-файл'}
  else if(snapshot.lastSuccess){dot='good';label=snapshot.fileName||'Файл загружен';details=`Лист «${snapshot.sheetName||'Свод'}» · ${snapshot.rows.length} кластеров · ${fmtDate(snapshot.lastSuccess,true)}`}
  else{label='Файл не загружен';details='Откройте «Конкурентный анализ» и загрузите XLSX с листом «Свод»'}
  node.innerHTML=`<button class="phase0-sync-summary" type="button" data-action="open-competitive" title="${esc(details)}"><span class="phase0-sync-dot ${dot}" aria-hidden="true"></span><span>${esc(label)}</span></button>`;
}

function renderKpis(){
  const projects=state.projects,working=projects.filter(p=>[S.STATUS.NO_ANSWER,S.STATUS.WAITING,S.STATUS.ANALYSING].includes(p.phase0.status)).length,suitable=projects.filter(p=>p.phase0.status===S.STATUS.SUITABLE).length,measuring=projects.filter(p=>p.phase0.measurement&&p.phase0.measurement.status==='Запланирован').length,rejected=projects.filter(p=>p.phase0.status===S.STATUS.REJECTED).length;
  const actionRequired=projects.filter(p=>p.phase0.status!==S.STATUS.REJECTED&&!phaseService.readiness(p).ready).length;
  const count=byId('phase0-title-count');if(count)count.textContent=`${projects.length} ${projects.length===1?'объект':'объектов'}`;
  const icons={
    all:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5 8.7 4l6.6 2 4.7-1.5v14L15.3 20l-6.6-2L4 19.5Z"/><path d="M8.7 4v14M15.3 6v14"/></svg>',
    working:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V6.5A2.5 2.5 0 0 1 9.5 4h5A2.5 2.5 0 0 1 17 6.5V8"/><rect x="4" y="8" width="16" height="11" rx="2"/><path d="M4 12h16M10 12v2h4v-2"/></svg>',
    suitable:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m8 12 2.5 2.5L16.5 9"/></svg>',
    measuring:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 18 12-12 2 2L8 20H6Z"/><path d="m12.5 11.5 2 2M9.5 14.5l2 2M15.5 8.5l2 2"/></svg>',
    rejected:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6m0-6-6 6"/></svg>',
    action:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13.2 3-6 10h4.5L10.8 21l6-10h-4.5Z"/></svg>'
  };
  byId('phase0-kpis').innerHTML=[
    ['all',projects.length,'Все объекты'],['working',working,'В работе'],['suitable',suitable,'Подходят'],['measuring',measuring,'На замере'],['rejected',rejected,'Не подошли'],['action',actionRequired,'Требуют действия']
  ].map(([key,value,label])=>`<button class="phase0-kpi ${(!state.quickFilter&&key==='all')||state.quickFilter===key?'active':''}" type="button" data-action="quick-filter" data-quick-filter="${key}" aria-pressed="${String((!state.quickFilter&&key==='all')||state.quickFilter===key)}"><span class="phase0-kpi-icon ${key}" aria-hidden="true">${icons[key]}</span><span class="phase0-kpi-copy"><span class="phase0-kpi-label">${label}</span><strong>${value}</strong><span class="phase0-kpi-show">${key==='all'?'Показать все':'Показать'}</span></span></button>`).join('');
}

function renderFilterState(){
  const active=[],cluster=byId('phase0-cluster-filter'),status=byId('phase0-status-filter'),sort=byId('phase0-sort'),readiness=byId('phase0-readiness-filter');
  if(cluster.value)active.push(cluster.selectedOptions[0]?.textContent||cluster.value);if(status.value)active.push(status.selectedOptions[0]?.textContent||status.value);if(sort.value!=='rating-asc')active.push(sort.selectedOptions[0]?.textContent||'Сортировка');if(readiness.value)active.push(readiness.selectedOptions[0]?.textContent||readiness.value);
  const quickLabels={working:'В работе',suitable:'Подходят',measuring:'На замере',rejected:'Не подошли',action:'Требуют действия'};if(state.quickFilter)active.push(quickLabels[state.quickFilter]);
  const button=byId('phase0-filter-button'),node=byId('phase0-active-filters');button.textContent=active.length?`Фильтры · ${active.length}`:'Фильтры';button.classList.toggle('has-filters',Boolean(active.length));node.hidden=!active.length;node.innerHTML=active.length?`<span>Активно: ${active.map(esc).join(' · ')}</span><button class="phase0-link-button" type="button" data-action="reset-filters">Сбросить</button>`:'';
}

function populateFilters(){
  const clusterSelect=byId('phase0-cluster-filter'),currentCluster=clusterSelect.value,names=[...new Set([...clusters.list().map(x=>x.name),...state.projects.map(x=>x.clusterName)].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  clusterSelect.innerHTML='<option value="">Кластер · все</option>'+names.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('');
  if(names.includes(currentCluster))clusterSelect.value=currentCluster;
  const statusSelect=byId('phase0-status-filter'),currentStatus=statusSelect.value;
  statusSelect.innerHTML='<option value="">Статус · все</option>'+S.STATUSES.map(status=>`<option value="${esc(status)}">${esc(shortStatus(status))}</option>`).join('');
  if(S.STATUSES.includes(currentStatus))statusSelect.value=currentStatus;
}

function sortedVisible(){
  const query=S.norm(byId('phase0-search').value),cluster=S.norm(byId('phase0-cluster-filter').value),status=byId('phase0-status-filter').value,sort=byId('phase0-sort').value,readiness=byId('phase0-readiness-filter')?.value||'';
  const list=state.projects.filter(project=>{
    const haystack=S.norm([project.address,project.clusterName,project.phase0.comments].filter(Boolean).join(' '));
    const phase=project.phase0,extra=!readiness||(readiness==='layout'&&phase.layout&&phase.layout.received)||(readiness==='interest'&&phase.interest&&phase.interest.confirmed)||(readiness==='measurement'&&phase.measurement&&phase.measurement.status==='Выполнен')||(readiness==='ready'&&phaseService.readiness(project).ready)||(readiness==='no-rating'&&project.computed.rating==null);
    const quick=!state.quickFilter||(state.quickFilter==='working'&&[S.STATUS.NO_ANSWER,S.STATUS.WAITING,S.STATUS.ANALYSING].includes(phase.status))||(state.quickFilter==='suitable'&&phase.status===S.STATUS.SUITABLE)||(state.quickFilter==='measuring'&&phase.measurement&&phase.measurement.status==='Запланирован')||(state.quickFilter==='rejected'&&phase.status===S.STATUS.REJECTED)||(state.quickFilter==='action'&&phase.status!==S.STATUS.REJECTED&&!phaseService.readiness(project).ready);
    return(!query||haystack.includes(query))&&(!cluster||S.norm(project.clusterName)===cluster)&&(!status||phase.status===status)&&extra&&quick;
  });
  const numeric=(value,fallback=Infinity)=>value==null||!Number.isFinite(Number(value))?fallback:Number(value);
  list.sort((a,b)=>{
    if(sort==='rent-asc')return numeric(a.phase0.rent&&a.phase0.rent.amount)-numeric(b.phase0.rent&&b.phase0.rent.amount);
    if(sort==='rentPerSqm-asc')return numeric(a.computed.rentPerSqm)-numeric(b.computed.rentPerSqm);
    if(sort==='area-desc')return numeric(b.area,-Infinity)-numeric(a.area,-Infinity);
    if(sort==='created-desc')return new Date(b.createdAt||0)-new Date(a.createdAt||0);
    const ar=a.computed.rating,br=b.computed.rating;if(ar==null&&br==null)return new Date(b.createdAt||0)-new Date(a.createdAt||0);if(ar==null)return 1;if(br==null)return-1;return Number(ar)-Number(br);
  });
  return list;
}

function cardHtml(project,index=0){
  const phase=project.phase0,computed=project.computed,gate=phaseService.readiness(project),rent=phase.rent&&phase.rent.amount;
  const source=phase.source==='cian'?'ЦИАН':'Ручной ввод',addedAt=phase.listingAddedAt||project.createdAt;
  const rating=computed.rating==null?'<strong>—</strong>':`<strong>${fmtNumber(computed.rating,0)}</strong>`;
  const rejection=phase.status===S.STATUS.REJECTED&&phase.rejection&&phase.rejection.reason?`<div class="phase0-rejection-note"><strong>Причина:</strong> ${esc(phase.rejection.reason)}</div>`:'';
  const progress=readinessProgress(project),action=nextAction(project),readyText=gate.ready?'Готов к смете':`${progress.done} из ${progress.total} к смете`;
  const listing=phase.listingUrl?`<a class="phase0-listing-link" href="${esc(phase.listingUrl)}" target="_blank" rel="noopener" data-action="listing-link">Ссылка на объявление</a>`:'';
  return`<article class="phase0-card ${String(project.id)===String(state.selectedId)?'selected':''}" data-project-id="${esc(project.id)}" data-action="open-project" tabindex="0" role="button" aria-label="Открыть объект ${esc(project.address||'без адреса')}">
    <div class="phase0-rating-cell"><div class="phase0-rating ${computed.rating==null?'unknown':''}">${rating}</div></div>
    <div class="phase0-card-main"><div class="phase0-card-origin"><span>${esc(source)}</span><time datetime="${esc(addedAt||'')}">Добавлено ${esc(addedAt?fmtDate(addedAt):'—')}</time></div><h4>${esc(project.address||'Адрес не указан')}</h4><p><button class="phase0-cluster-link" type="button" data-action="open-cluster" data-cluster="${esc(project.clusterName||project.clusterId||'')}" ${project.clusterName||project.clusterId?'':'disabled'}>${esc(project.clusterName||'Кластер не определён')}</button><span>·</span><span>${project.area==null?'Нет данных':`${fmtNumber(project.area,2)} м²`}</span><span>·</span><span>${phase.roomsCount==null?'Нет данных':`${fmtNumber(phase.roomsCount)} кабинетов`}</span></p>${listing}${rejection}</div>
    <div class="phase0-economy-cell"><strong>${rent==null?'—':fmtMoney(rent)}</strong><span>${computed.rentPerSqm==null?'—':`${fmtMoney(computed.rentPerSqm)} / м²`}</span></div>
    <div class="phase0-cluster-compare"><span class="phase0-deviation ${deviationClass(computed.deviationPercent)}">${computed.deviationPercent==null?'—':esc(cardDeviationText(computed.deviationPercent).replace(' к кластеру',''))}</span><small>${computed.averageRentPerSqm==null?'нет данных по кластеру':`${esc(fmtMoney(computed.averageRentPerSqm))}/м² по кластеру`}</small></div>
    <div class="phase0-card-status"><select class="phase0-inline-status ${statusClass(phase.status)}" data-action="inline-status" data-project-id="${esc(project.id)}" data-previous="${esc(phase.status)}" aria-label="Статус объекта ${esc(project.address||'')}">${S.STATUSES.map(value=>`<option value="${esc(value)}" ${value===phase.status?'selected':''}>${esc(shortStatus(value))}</option>`).join('')}</select></div>
    <div class="phase0-card-next"><button class="phase0-next-action ${action.tone}" type="button" data-action="open-project" data-project-id="${esc(project.id)}">${esc(action.text.replace('Дальше: ',''))} <b aria-hidden="true">→</b></button><small>${progress.done} из ${progress.total} к смете</small></div>
    <button class="phase0-card-more" type="button" aria-label="Открыть объект">⋮</button>
  </article>`;
}

function renderList(){
  state.visible=sortedVisible();const node=byId('phase0-object-list'),wrap=byId('phase0-list-scroll');
  byId('phase0-list-summary').textContent=`Показано ${state.visible.length} из ${state.projects.length}`;
  node.innerHTML=state.visible.length?state.visible.map((project,index)=>cardHtml(project,index)).join(''):`<div class="phase0-empty"><div><strong>${state.projects.length?'По фильтрам ничего не найдено':'В «Моих помещениях» пока пусто'}</strong><p>${state.projects.length?'Измените или сбросьте фильтры.':'Добавьте объект вручную или выберите сохранённое объявление в разделе «Поиск помещений».'}</p><div class="phase0-empty-actions"><a class="phase0-btn primary" href="available-spaces.html">Перейти к поиску</a><button class="phase0-btn" type="button" data-action="add-project">＋ Добавить вручную</button></div></div>`;
  if(wrap){wrap.classList.toggle('expanded',state.listExpanded);wrap.classList.toggle('has-more',state.visible.length>10)}
  const toggle=byId('phase0-list-expand');if(toggle){toggle.hidden=state.visible.length<=10;toggle.textContent=state.listExpanded?'Свернуть таблицу':`Развернуть все (${state.visible.length})`;toggle.setAttribute('aria-expanded',String(state.listExpanded))}
  if(state.map)state.map.setProjects(state.visible);
  renderFilterState();
}

function reload(){
  state.projects=repo.listPhase0().map(project=>S.viewModel(project,competitive));
  if(state.selectedId&&!projectById(state.selectedId))state.selectedId='';
  populateFilters();renderKpis();renderList();renderSyncStrip();
}

function selectProject(id,{scroll=true,focusMap=false}={}){
  state.selectedId=String(id||'');all('.phase0-card').forEach(card=>card.classList.toggle('selected',card.dataset.projectId===state.selectedId));if(state.map)state.map.setSelected(state.selectedId);
  const card=one(`.phase0-card[data-project-id="${CSS.escape(state.selectedId)}"]`);if(card&&scroll)card.scrollIntoView({behavior:'smooth',block:'center'});if(focusMap&&state.map)state.map.focus(state.selectedId);
}
function setCardHover(id){state.hoverId=String(id||'');all('.phase0-card').forEach(card=>card.classList.toggle('map-hover',card.dataset.projectId===state.hoverId));if(state.map)state.map.setSelected(state.hoverId||state.selectedId)}

function fieldValue(form,name){const input=form.elements[name];return input?input.value:''}
function numericValue(form,name){return S.nullableNumber(fieldValue(form,name))}
function collectDraft(form){
  const criteria={};S.CRITERIA_KEYS.forEach(key=>{const value=fieldValue(form,`criterion-${key}`);criteria[key]=value==='true'?true:value==='false'?false:null});
  return{
    listingUrl:fieldValue(form,'listingUrl'),source:fieldValue(form,'source')||'manual',address:fieldValue(form,'address'),
    latitude:numericValue(form,'latitude'),longitude:numericValue(form,'longitude'),clusterId:fieldValue(form,'clusterId'),clusterName:(fieldValue(form,'clusterName')||(fieldValue(form,'clusterId')&&form.elements.clusterId&&form.elements.clusterId.selectedOptions&&form.elements.clusterId.selectedOptions[0]?form.elements.clusterId.selectedOptions[0].textContent:'')||''),
    area:numericValue(form,'area'),roomsCount:numericValue(form,'roomsCount'),windowsCount:numericValue(form,'windowsCount'),ceilingHeight:numericValue(form,'ceilingHeight'),
    rentMonthly:numericValue(form,'rentMonthly'),rentPeriod:fieldValue(form,'rentPeriod')||'month',rentCurrency:fieldValue(form,'rentCurrency')||'RUB',
    status:fieldValue(form,'status'),rejectionReason:fieldValue(form,'rejectionReason'),selectionCriteria:criteria,interestConfirmed:Boolean(form.elements.interestConfirmed&&form.elements.interestConfirmed.checked),
    measurementStatus:fieldValue(form,'measurementStatus'),measurementDate:fieldValue(form,'measurementDate'),measurementComment:fieldValue(form,'measurementComment'),comments:fieldValue(form,'comments')
  };
}
function clusterOptions(selected){const items=clusters.list(),has=items.some(item=>String(item.id)===String(selected));return`<option value="">Кластер не определён</option>${items.map(item=>`<option value="${esc(item.id)}" ${String(item.id)===String(selected)?'selected':''}>${esc(item.name)}</option>`).join('')}${selected&&!has?`<option value="${esc(selected)}" selected>${esc(selected)}</option>`:''}`}
function statusOptions(selected){return S.STATUSES.map(value=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(value)}</option>`).join('')}
function measurementOptions(selected){return S.MEASUREMENT_STATUSES.map(value=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(value)}</option>`).join('')}
function criterionOptions(value){return`<option value="" ${value==null?'selected':''}>Не проверено</option><option value="true" ${value===true?'selected':''}>Подходит</option><option value="false" ${value===false?'selected':''}>Не подходит</option>`}
function fieldWrap(name,label,input,help=''){return`<label class="phase0-field" data-field-wrap="${name}"><span>${label}</span>${input}${help?`<span class="phase0-help">${help}</span>`:''}<span class="phase0-field-error" data-field-error="${name}"></span></label>`}

function cardUiIcon(name){
  const icons={
    pin:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"/><circle cx="12" cy="10" r="2.4"/></svg>',
    area:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5M8 8l-5-5M16 8l5-5M16 16l5 5M8 16l-5 5"/></svg>',
    rent:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h7a5 5 0 0 1 0 10H6m0 0h8M6 3v18M3 17h11"/></svg>',
    sqm:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M8 8h8v8H8z"/><path d="M10 14h4M12 10v4"/></svg>',
    rooms:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h6"/></svg>',
    windows:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M12 4v16M4 12h16"/></svg>',
    height:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M9 7l3-3 3 3M9 17l3 3 3-3M5 4h3M5 20h3"/></svg>',
    plan:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M8 4v6h6V4M14 10v10M3 14h5"/></svg>',
    measure:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15 15 4l5 5L9 20H4v-5Z"/><path d="m12 7 5 5M7 17l2 2"/></svg>',
    decision:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11a2 2 0 0 1 2 2v8M5 3v18h9"/><path d="m14 17 2 2 4-5"/></svg>',
    filter:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6 7v5l-4 2v-7L4 5Z"/></svg>',
    refresh:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg>',
    external:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></svg>'
  };
  return `<span class="phase0-ui-icon phase0-ui-icon-${esc(name)}">${icons[name]||''}</span>`;
}

function editorHtml(project){
  const isEdit=Boolean(project),phase=Object.assign(S.defaultPhase0(),S.clone(project&&project.phase0||{})),geo=S.normalizeGeo(project&&project.geo),metric=project?S.metricForProject(project,competitive):null,criteria=phase.selectionCriteria||{},layout=phase.layout||{},interest=phase.interest||{},measurement=phase.measurement||{};
  const perSqm=S.rentPerSqm(project&&project.area,phase.rent&&phase.rent.amount),average=metric&&S.nullableNumber(metric.averageRentPerSqm),deviation=S.deviationPercent(perSqm,average),source=S.sourceLabel(phase.source),progress=project?readinessProgress(project):{done:0,total:7},percent=Math.round(progress.done/progress.total*100);
  const clusterValue=project&&project.clusterId||project&&project.clusterName||'';
  const listingUrl=phase.listingUrl||'';
  const layoutStatus=layout.received?'Планировка загружена':'Загрузите план помещения или создайте вручную.';
  const measureStatus=measurement.status&&measurement.status!=='Не назначен'?measurement.status:'Укажите размеры и параметры помещения.';
  const decisionStatus=phase.status&&phase.status!==S.STATUS.NO_ANSWER?shortStatus(phase.status):'Зафиксируйте итоговое решение по помещению.';
  return`<form id="phase0-object-form" novalidate>
    <div class="phase0-drawer-head phase0-card-editor-head"><div><h2 id="phase0-drawer-title">${isEdit?'Карточка потенциального помещения':'Добавить потенциальное помещение'}</h2><p>${isEdit?'Просмотр и редактирование данных помещения':'Заполните данные вручную или вставьте ссылку на объявление'}</p></div><button class="phase0-close" type="button" data-action="close-editor" aria-label="Закрыть">×</button></div>
    <div class="phase0-drawer-body phase0-card-editor-body">
      <div class="phase0-form-alert" id="phase0-form-alert" role="alert"></div><div class="phase0-duplicate" id="phase0-duplicate"></div>
      <div class="phase0-editor-section-title"><span>01</span><h3>Основное</h3></div>

      <section class="phase0-card-summary-panel phase0-reference-summary">
        <div class="phase0-card-address-block">
          <div class="phase0-card-address-icon" aria-hidden="true">${cardUiIcon('pin')}</div>
          <div class="phase0-card-address-fields">${fieldWrap('address','Адрес *',`<input name="address" type="text" value="${esc(project&&project.address||'')}" autocomplete="street-address" placeholder="Москва, Волоколамское шоссе, 95"/>`,'Кластер определяется автоматически после ввода адреса.')}</div>
        </div>
        <div class="phase0-card-meta-grid">
          <div class="phase0-card-meta-item phase0-cluster-meta">${fieldWrap('clusterId','Кластер',`<select name="clusterId">${clusterOptions(clusterValue)}</select><input name="clusterName" type="hidden" value="${esc(project&&project.clusterName||'')}"/>`)}</div>
          <div class="phase0-card-meta-item phase0-card-rating-box"><span>Рейтинг</span><strong id="phase0-editor-rating">${metric&&metric.rating!=null?`<i>★</i> ${esc(fmtNumber(metric.rating,0))}`:'—'}</strong><small>из конкурентного анализа</small></div>
          <div class="phase0-card-meta-item phase0-source-meta"><span>Источник</span><strong id="phase0-source-label">${esc(source)}</strong></div>
          <div class="phase0-card-meta-item phase0-listing-meta"><span>Ссылка на объявление</span><div class="phase0-listing-inline"><input name="listingUrl" type="url" value="${esc(listingUrl)}" placeholder="https://www.cian.ru/…" autocomplete="url"/><button class="phase0-icon-btn" type="button" data-action="open-listing" aria-label="Открыть объявление" title="Открыть объявление">${cardUiIcon('external')}</button><button class="phase0-icon-btn" id="phase0-import-button" type="button" data-action="import-listing" aria-label="Обновить данные из объявления" title="Обновить данные из объявления">${cardUiIcon('refresh')}</button></div></div>
          <div class="phase0-card-meta-item phase0-status-meta">${fieldWrap('status','Текущий статус',`<select name="status" class="phase0-status-select ${statusClass(phase.status)}">${statusOptions(phase.status)}</select>`)}</div>
        </div>
        <input type="hidden" name="source" value="${esc(phase.source||'manual')}"/><input name="latitude" type="hidden" value="${geo?esc(geo.lat):''}"/><input name="longitude" type="hidden" value="${geo?esc(geo.lng):''}"/>
        <div class="phase0-reference-notices"><div class="phase0-import-state" id="phase0-import-state">Если данные не загрузятся автоматически, заполните поля вручную.</div><div class="phase0-import-state" id="phase0-cluster-state">${project&&project.clusterName?`Кластер определён: ${esc(project.clusterName)}`:'Введите адрес — кластер определится автоматически.'}</div></div>
      </section>

      <section class="phase0-card-metrics-panel phase0-reference-metrics">
        <div class="phase0-metric-edit">${cardUiIcon('area')}<span>Площадь</span><div class="phase0-metric-input"><input name="area" type="number" min="0" step="0.01" inputmode="decimal" value="${project&&project.area!=null?esc(project.area):''}" placeholder="—"><b>м²</b></div><small>Общая</small><span class="phase0-field-error" data-field-error="area"></span></div>
        <div class="phase0-metric-edit">${cardUiIcon('rent')}<span>Аренда в месяц</span><div class="phase0-metric-input"><input name="rentMonthly" type="number" min="0" step="1" inputmode="decimal" value="${phase.rent&&phase.rent.amount!=null?esc(phase.rent.amount):''}" placeholder="—"><b>₽</b></div><small>в месяц</small><span class="phase0-field-error" data-field-error="rentMonthly"></span></div>
        <div class="phase0-metric-display">${cardUiIcon('sqm')}<span>Аренда за 1 м²</span><strong id="phase0-calc-rent">${perSqm==null?'—':fmtMoney(perSqm)}</strong><small>в месяц</small></div>
        <div class="phase0-metric-edit">${cardUiIcon('rooms')}<span>Кабинеты</span><div class="phase0-metric-input"><input name="roomsCount" type="number" min="0" step="1" inputmode="numeric" value="${phase.roomsCount!=null?esc(phase.roomsCount):''}" placeholder="—"></div><small>заполняются вручную</small><span class="phase0-field-error" data-field-error="roomsCount"></span></div>
        <div class="phase0-metric-edit">${cardUiIcon('windows')}<span>Окна</span><div class="phase0-metric-input"><input name="windowsCount" type="number" min="0" step="1" inputmode="numeric" value="${phase.windowsCount!=null?esc(phase.windowsCount):''}" placeholder="—"></div><small>шт.</small><span class="phase0-field-error" data-field-error="windowsCount"></span></div>
        <div class="phase0-metric-edit">${cardUiIcon('height')}<span>Высота потолков</span><div class="phase0-metric-input"><input name="ceilingHeight" type="number" min="0" step="0.01" inputmode="decimal" value="${project&&project.ceilingHeight!=null?esc(project.ceilingHeight):''}" placeholder="—"><b>м</b></div><small>чистая</small><span class="phase0-field-error" data-field-error="ceilingHeight"></span></div>
        <input name="rentCurrency" type="hidden" value="${esc(phase.rent&&phase.rent.currency||'RUB')}"/><input name="rentPeriod" type="hidden" value="${esc(phase.rent&&phase.rent.period||'month')}"/>
      </section>

      <section class="phase0-card-analysis-strip"><div><span>Среднее по кластеру</span><strong id="phase0-calc-average">${average==null?'Нет данных':`${fmtMoney(average)}/м²/мес.`}</strong></div><div><span>Отклонение объекта</span><strong id="phase0-calc-deviation" class="phase0-deviation ${deviationClass(deviation)}">${esc(deviationText(deviation))}</strong></div><button class="phase0-btn small" type="button" data-action="editor-cluster" ${project&&project.clusterName?'':'disabled'}>Параметры кластера</button></section>

      <div class="phase0-editor-section-title"><span>02</span><h3>Проверка</h3></div>
      <div class="phase0-card-middle-grid phase0-reference-middle">
        <section class="phase0-card-subpanel phase0-reference-check-panel"><div class="phase0-subpanel-title"><h3>Проверка и готовность</h3><span class="phase0-criteria-chip">${cardUiIcon('filter')} Критерии отбора</span></div><div class="phase0-card-checklist">${S.CRITERIA_KEYS.map((key,index)=>`<label class="phase0-card-check-row"><span class="phase0-check-number">${index+1}</span><span class="phase0-check-label">${esc(S.CRITERIA_LABELS[key])}</span><select name="criterion-${key}" aria-label="Критерий ${esc(S.CRITERIA_LABELS[key])}">${criterionOptions(criteria[key])}</select></label>`).join('')}</div></section>
        <section class="phase0-card-subpanel phase0-readiness-visual phase0-reference-readiness"><div class="phase0-subpanel-title"><h3>Готовность к смете</h3><span id="phase0-progress-label">Выполнено: ${progress.done} из ${progress.total}</span></div><div class="phase0-progress-content"><div class="phase0-readiness-meter"><div class="phase0-progress-linear" id="phase0-progress-ring" role="progressbar" aria-label="Готовность к смете" aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${progress.done}" style="--progress:${percent}%"><span aria-hidden="true"></span></div><strong id="phase0-progress-percent">${progress.done} из ${progress.total}</strong></div><div class="phase0-readiness-copy"><div id="phase0-requirements" class="phase0-requirements"></div><button class="phase0-btn phase0-readiness-button" id="phase0-editor-phase1-inline" type="button" data-action="editor-phase1" disabled>Перейти к смете</button></div></div></section>
      </div>

      <div class="phase0-editor-section-title"><span>03</span><h3>Решение</h3></div>
      <div class="phase0-card-bottom-grid phase0-reference-bottom">
        <section class="phase0-card-subpanel phase0-action-card"><div class="phase0-action-card-head">${cardUiIcon('plan')}<div><h3>Планировка</h3><p>${esc(layoutStatus)}</p></div></div><div class="phase0-action-card-controls"><label class="phase0-btn phase0-action-main" for="phase0-layout-file">${layout.received?'Заменить план':'Загрузить план'}</label><input class="phase0-file-input" id="phase0-layout-file" name="layoutFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf,.doc,.docx"/>${isEdit&&layout.received?'<button class="phase0-action-link" type="button" data-action="download-layout">Скачать</button>':''}</div><div class="phase0-layout-copy phase0-action-meta"><strong id="phase0-layout-title">${layout.received?esc(layout.fileName||'Планировка получена'):''}</strong><span id="phase0-layout-meta">${layout.received?esc(fmtDate(layout.updatedAt,true)):''}</span></div></section>
        <section class="phase0-card-subpanel phase0-action-card"><div class="phase0-action-card-head">${cardUiIcon('measure')}<div><h3>Замер</h3><p>${esc(measureStatus)}</p></div></div><details class="phase0-action-details" ${measurement.status&&measurement.status!=='Не назначен'?'open':''}><summary>Заполнить замер</summary><div class="phase0-action-details-body">${fieldWrap('measurementStatus','Статус',`<select name="measurementStatus">${measurementOptions(measurement.status||'Не назначен')}</select>`)}${fieldWrap('measurementDate','Дата замера',`<input name="measurementDate" type="date" value="${esc(measurement.date||'')}"/>`)}${fieldWrap('measurementComment','Комментарий',`<textarea name="measurementComment">${esc(measurement.comment||'')}</textarea>`)}</div></details></section>
        <section class="phase0-card-subpanel phase0-action-card"><div class="phase0-action-card-head">${cardUiIcon('decision')}<div><h3>Решение</h3><p>${esc(decisionStatus)}</p></div></div><details class="phase0-action-details" ${interest.confirmed||phase.comments||phase.status===S.STATUS.REJECTED?'open':''}><summary>Принять решение</summary><div class="phase0-action-details-body"><label class="phase0-inline-check phase0-interest-check"><input name="interestConfirmed" type="checkbox" ${interest.confirmed?'checked':''}/> Интерес зафиксирован</label><label class="phase0-field full" data-field-wrap="rejectionReason" id="phase0-rejection-field" style="${phase.status===S.STATUS.REJECTED?'':'display:none'}"><span>Причина отказа *</span><textarea name="rejectionReason">${esc(phase.rejection&&phase.rejection.reason||'')}</textarea><span class="phase0-field-error" data-field-error="rejectionReason"></span></label>${fieldWrap('comments','Комментарий',`<textarea name="comments">${esc(phase.comments||'')}</textarea>`)}${isEdit?'<button class="phase0-delete-link" type="button" data-action="delete-project">Удалить объект</button>':''}</div></details></section>
      </div>
    </div>
    <div class="phase0-drawer-actions phase0-card-editor-actions"><div class="phase0-drawer-actions-secondary"><button class="phase0-btn" type="button" data-action="close-editor">Отмена</button><button class="phase0-btn" type="button" data-action="editor-cluster" ${project&&project.clusterName?'':'disabled'}>Параметры кластера</button></div><div class="phase0-drawer-actions-main"><button class="phase0-btn" id="phase0-editor-phase1" type="button" data-action="editor-phase1" disabled>Перейти к смете</button><button class="phase0-btn primary" id="phase0-save" type="submit">Сохранить</button></div></div>
  </form>`;
}
function openEditor(id=''){
  const raw=id?rawProjectById(id):null;if(id&&(!raw||!raw.phase0)){toast('Объект поиска не найден.');return}
  state.lastFocused=document.activeElement;state.drawerProjectId=raw?String(raw.id):'';state.drawerRevision=raw?Number(raw.phase0.revision)||0:null;state.drawerDirty=false;state.pendingLayout=null;if(raw)state.selectedId=String(raw.id);
  byId('phase0-object-drawer').innerHTML=editorHtml(raw);const overlay=byId('phase0-object-overlay');overlay.hidden=false;document.body.classList.add('phase0-modal-open');if(raw)setUrlProject(raw.id);bindEditor();updateEditorComputed();updateEditorReadiness();if(raw&&raw.address&&(!raw.geo||!(raw.clusterId||raw.clusterName)))setTimeout(()=>geocodeEditorAddress({silent:true}),120);setTimeout(()=>one('input[name="listingUrl"]',overlay)?.focus(),20);
}
function closeEditor(force=false){
  if(!force&&state.drawerDirty&&!confirm('Закрыть карточку без сохранения изменений?'))return;
  byId('phase0-object-overlay').hidden=true;document.body.classList.remove('phase0-modal-open');state.drawerProjectId='';state.drawerRevision=null;state.pendingLayout=null;state.drawerDirty=false;setUrlProject('');if(state.lastFocused&&document.contains(state.lastFocused))state.lastFocused.focus();
}

function markEditorDirty(){state.drawerDirty=true;updateEditorReadiness()}
function setFieldError(name,message){const wrap=one(`[data-field-wrap="${CSS.escape(name)}"]`,byId('phase0-object-drawer'));if(!wrap)return;wrap.classList.toggle('invalid',Boolean(message));const error=one(`[data-field-error="${CSS.escape(name)}"]`,wrap);if(error)error.textContent=message||''}
function clearFieldErrors(){all('.phase0-field.invalid',byId('phase0-object-drawer')).forEach(node=>node.classList.remove('invalid'));all('[data-field-error]',byId('phase0-object-drawer')).forEach(node=>node.textContent='')}
function showFormAlert(message){const alert=byId('phase0-form-alert');alert.innerHTML=message;alert.classList.add('show');alert.scrollIntoView({behavior:'smooth',block:'center'})}
function hideFormAlert(){const alert=byId('phase0-form-alert');if(alert){alert.classList.remove('show');alert.textContent=''}}

function currentDraftCandidate(){
  const form=byId('phase0-object-form');if(!form)return null;const existing=state.drawerProjectId?rawProjectById(state.drawerProjectId):null,candidate=phaseService.buildCandidate(collectDraft(form),existing);if(state.pendingLayout)candidate.phase0.layout=Object.assign({},candidate.phase0.layout,{received:true,fileName:state.pendingLayout.name});return candidate;
}
function updateEditorComputed(){
  const form=byId('phase0-object-form');if(!form)return;const area=numericValue(form,'area'),rent=numericValue(form,'rentMonthly'),monthly=fieldValue(form,'rentPeriod')==='month',per=monthly?S.rentPerSqm(area,rent):null,clusterId=fieldValue(form,'clusterId'),clusterName=fieldValue(form,'clusterName'),metric=competitive.metricFor(clusterId,clusterName),average=metric&&S.nullableNumber(metric.averageRentPerSqm),dev=S.deviationPercent(per,average);
  byId('phase0-calc-rent').textContent=!monthly?'—':per==null?'—':fmtMoney(per);byId('phase0-calc-average').textContent=average==null?'Нет данных':`${fmtMoney(average)}/м²/мес.`;const deviation=byId('phase0-calc-deviation');deviation.textContent=deviationText(dev);deviation.className=`phase0-deviation ${deviationClass(dev)}`;const rating=byId('phase0-editor-rating');if(rating)rating.textContent=metric&&metric.rating!=null?`★ ${fmtNumber(metric.rating,0)}`:'—';
}
function updateEditorReadiness(){
  const candidate=currentDraftCandidate();if(!candidate)return;const gate=phaseService.readiness(candidate),box=byId('phase0-requirements'),button=byId('phase0-editor-phase1'),unsaved=state.drawerDirty||!state.drawerProjectId,phase=candidate.phase0||{},criteria=phase.selectionCriteria||{},measurement=phase.measurement||{};
  const checks=[['Отметить объект как «Подошло»',phase.status===S.STATUS.SUITABLE],['Заполнить параметры помещения',candidate.area!=null&&phase.roomsCount!=null&&candidate.ceilingHeight!=null&&phase.rent&&phase.rent.period==='month'&&S.rentPerSqm(candidate.area,phase.rent.amount)!=null],['Определить кластер',Boolean(candidate.clusterId||candidate.clusterName)],['Завершить критерии отбора',S.CRITERIA_KEYS.every(key=>criteria[key]===true)],['Получить планировку',Boolean(phase.layout&&phase.layout.received)],['Зафиксировать интерес',Boolean(phase.interest&&phase.interest.confirmed)],['Выполнить замер',measurement.status==='Выполнен'&&Boolean(measurement.date)]];
  const done=checks.filter(([,value])=>value).length,missing=checks.filter(([,value])=>!value).map(([label])=>label),ready=gate.ready&&!unsaved,percent=Math.round(done/checks.length*100);
  const ring=byId('phase0-progress-ring'),pct=byId('phase0-progress-percent'),label=byId('phase0-progress-label');if(ring){ring.style.setProperty('--progress',`${percent}%`);ring.setAttribute('aria-valuenow',String(done));ring.setAttribute('aria-valuemax',String(checks.length));}if(pct)pct.textContent=`${done} из ${checks.length}`;if(label)label.textContent=`Выполнено: ${done} из ${checks.length}`;
  box.classList.toggle('ready',ready);box.innerHTML=ready?`<strong>✓ Объект готов к смете</strong><p>Все условия выполнены.</p>`:`<strong>${missing.length?`Осталось: ${missing.length}`:'Почти готово'}</strong><p>${unsaved?'Сохраните изменения. ':''}Заполните оставшиеся данные и завершите проверку, чтобы перейти к смете.</p>`;
  all('[data-action="editor-phase1"]',byId('phase0-object-form')).forEach(btn=>{btn.disabled=!ready;btn.title=ready?'Перейти к формированию сметы':(unsaved?'Сначала сохраните изменения. ':'')+missing.join('; ');});
}

async function geocodeEditorAddress({silent=false}={}){
  const form=byId('phase0-object-form');if(!form||!geocoder)return null;const address=fieldValue(form,'address').trim(),message=byId('phase0-cluster-state');if(address.length<5)return null;
  const seq=++state.addressGeocodeSeq;if(!silent&&message){message.className='phase0-import-state';message.textContent='Определяем координаты и кластер по адресу…'}
  try{const result=await geocoder.geocode(address);if(seq!==state.addressGeocodeSeq||!result)return null;const set=(name,value)=>{if(form.elements[name]&&value!=null)form.elements[name].value=String(value)};set('latitude',result.geo.lat);set('longitude',result.geo.lng);if(result.address&&result.address!==address&&form.elements.address.dataset.userEdited!=='1')set('address',result.address);let match=result.cluster||clusters.findByCoordinates(result.geo.lat,result.geo.lng)||(clusters.findNearestByCoordinates&&clusters.findNearestByCoordinates(result.geo.lat,result.geo.lng,6000));if(match){form.elements.clusterId.value=match.id;form.elements.clusterName.value=match.name;if(message){message.className='phase0-import-state success';message.textContent=`Кластер определён автоматически: ${match.name}.`}}else if(message){message.className='phase0-import-state partial';message.textContent='Адрес найден, но он находится вне используемой сетки кластеров. При необходимости выберите кластер вручную.'}updateEditorComputed();markEditorDirty();return result}
  catch(error){if(seq!==state.addressGeocodeSeq)return null;console.warn('[СЛОГИ] Геокодирование адреса не выполнено:',error);if(message&&!silent){message.className='phase0-import-state partial';const code=error&&error.code||'';if(code==='GEOCODER_HTTP_ERROR')message.textContent=`Не удалось получить координаты из API Геокодера: ${error.message}.`;else if(code==='GEOCODER_KEY_MISSING')message.textContent='Не указан ключ API Геокодера Яндекс.';else message.textContent='Не удалось получить координаты адреса через API Геокодера. Проверьте ключ/доступ API и повторите попытку.'}return null}
}
function scheduleAddressGeocode(){clearTimeout(state.addressGeocodeTimer);state.addressGeocodeTimer=setTimeout(()=>geocodeEditorAddress(),700)}

function syncClusterFromCoordinates(){
  const form=byId('phase0-object-form');if(!form)return;const lat=numericValue(form,'latitude'),lng=numericValue(form,'longitude'),message=byId('phase0-cluster-state');if(lat==null||lng==null){message.textContent='Введите адрес — кластер определится автоматически.';return}
  const match=clusters.findByCoordinates(lat,lng);if(match){form.elements.clusterId.value=match.id;form.elements.clusterName.value=match.name;message.textContent=`Кластер определён автоматически: ${match.name}.`;message.className='phase0-import-state success'}else{const nearest=clusters.findNearestByCoordinates?clusters.findNearestByCoordinates(lat,lng,6000):null;if(nearest){form.elements.clusterId.value=nearest.id;form.elements.clusterName.value=nearest.name;message.textContent=`Кластер определён автоматически по ближайшей границе: ${nearest.name}.`;message.className='phase0-import-state success'}else{form.elements.clusterId.value='';form.elements.clusterName.value='';message.textContent='Кластер не определён: адрес находится вне используемой сетки кластеров.';message.className='phase0-import-state partial'}}updateEditorComputed();markEditorDirty();return clusters.find(form.elements.clusterId.value)||null;
}
function syncClusterNameFromSelect(){const form=byId('phase0-object-form'),match=clusters.find(form.elements.clusterId.value),message=byId('phase0-cluster-state');form.elements.clusterName.value=match?match.name:form.elements.clusterId.value;if(message){message.className='phase0-import-state';message.textContent=match?`Кластер выбран вручную: ${match.name}.`:'Кластер не определён.'}updateEditorComputed();markEditorDirty()}
function syncListingSource(){const form=byId('phase0-object-form');if(!form)return;const source=S.detectListingSource(fieldValue(form,'listingUrl'))||'manual';form.elements.source.value=source;const label=byId('phase0-source-label');if(label)label.textContent=S.sourceLabel(source)}

function rejectionDialog(previousStatus){
  const form=byId('phase0-object-form'),textarea=form.elements.rejectionReason,layer=document.createElement('div');layer.className='phase0-dialog-layer';layer.innerHTML=`<div class="phase0-dialog" role="dialog" aria-modal="true" aria-labelledby="phase0-rejection-title"><h3 id="phase0-rejection-title">Укажите причину отказа</h3><p>Объект останется в истории и аналитике поиска. Без причины статус «Не подошло» сохранить нельзя.</p><label class="phase0-field"><span>Причина отказа *</span><textarea id="phase0-rejection-dialog-value">${esc(textarea.value||'')}</textarea><span class="phase0-field-error" id="phase0-rejection-dialog-error"></span></label><div class="phase0-dialog-actions"><button class="phase0-btn" type="button" data-rejection-cancel>Отмена</button><button class="phase0-btn primary" type="button" data-rejection-save>Сохранить причину</button></div></div>`;document.body.appendChild(layer);const input=byId('phase0-rejection-dialog-value');input.focus();
  const cancel=()=>{form.elements.status.value=previousStatus;form.elements.status.dataset.previous=previousStatus;byId('phase0-rejection-field').style.display=previousStatus===S.STATUS.REJECTED?'':'none';layer.remove();updateEditorReadiness()};
  one('[data-rejection-cancel]',layer).onclick=cancel;one('[data-rejection-save]',layer).onclick=()=>{const value=input.value.trim();if(!value){const error=byId('phase0-rejection-dialog-error');error.style.display='block';error.textContent='Введите причину отказа.';input.focus();return}textarea.value=value;byId('phase0-rejection-field').style.display='';layer.remove();markEditorDirty()};layer.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();cancel()}});
}

async function importListing(){
  const form=byId('phase0-object-form'),url=fieldValue(form,'listingUrl').trim(),button=byId('phase0-import-button'),message=byId('phase0-import-state');if(!url){setFieldError('listingUrl','Вставьте ссылку ЦИАН.');form.elements.listingUrl.focus();return}
  clearFieldErrors();button.disabled=true;button.innerHTML='<span class="phase0-spinner" aria-hidden="true"></span> Получаем данные';message.className='phase0-import-state';message.textContent='Получаем данные объявления…';
  try{const source=listingService.detect(url);form.elements.source.value=source||'manual';byId('phase0-source-label').textContent=S.sourceLabel(source||'manual');const result=await listingService.import(url),data=result.data;const set=(name,value)=>{if(value!==null&&value!==undefined&&value!==''&&form.elements[name])form.elements[name].value=value};set('address',data.address);set('area',data.area);set('windowsCount',data.windowsCount);set('ceilingHeight',data.ceilingHeight);set('rentMonthly',data.rent&&data.rent.amount);set('rentCurrency',data.rent&&data.rent.currency);set('rentPeriod',data.rent&&data.rent.period);if(data.geo){set('latitude',data.geo.lat);set('longitude',data.geo.lng);syncClusterFromCoordinates()}else if(data.address){await geocodeEditorAddress({silent:true})}const imported=[data.address?'адрес':'',data.area!=null?'площадь':'',data.rent&&data.rent.amount!=null?'аренда':'',data.ceilingHeight!=null?'высота потолков':'',data.windowsCount!=null?'окна':''].filter(Boolean),clusterName=form.elements.clusterName&&form.elements.clusterName.value;message.className=`phase0-import-state ${result.state}`;let text=(result.state==='success'?'Данные объявления получены':'Получена часть данных')+(imported.length?`: ${imported.join(', ')}.`:'.');if(clusterName)text+=` Кластер: ${clusterName}.`;if(data.importWarning)text+=` ${data.importWarning}`;text+=' Проверьте значения перед сохранением.';message.textContent=text;markEditorDirty();updateEditorComputed()}
  catch(error){message.className='phase0-import-state error';message.textContent=error.message||'Не удалось получить данные объявления. Серверный импорт не настроен или источник заблокировал загрузку.';toast('Автоматический импорт не выполнен. Проверьте серверный импорт в Supabase.')}
  finally{button.disabled=false;button.textContent='Получить данные'}
}

function handleLayoutSelection(input){const file=input.files&&input.files[0];if(!file)return;state.pendingLayout=file;byId('phase0-layout-title').textContent='Планировка будет загружена при сохранении';byId('phase0-layout-meta').textContent=`${file.name} · ${fmtNumber(file.size)} байт`;markEditorDirty()}

async function downloadLayout(){if(!state.drawerProjectId)return;try{await files.downloadLayout(state.drawerProjectId);toast('Скачивание планировки началось.')}catch(error){toast(error.message||'Не удалось скачать планировку.')}}

function renderDuplicate(error){const node=byId('phase0-duplicate'),items=error.details&&error.details.duplicates||[];node.classList.add('show');node.innerHTML=`<strong>Похожий объект уже существует</strong><div>Создание копии остановлено. Проверьте найденный объект.</div><div class="phase0-duplicate-list">${items.map(item=>`<div class="phase0-duplicate-item"><span><strong>${esc(item.project.address||'Объект')}</strong><br>${esc(item.reasons.join(', '))}</span><button class="phase0-btn small" type="button" data-open-duplicate="${esc(item.project.id)}">Открыть</button></div>`).join('')}</div>`;all('[data-open-duplicate]',node).forEach(button=>button.onclick=()=>{const id=button.dataset.openDuplicate;closeEditor(true);openEditor(id)})
}
function displayValidation(errors){clearFieldErrors();Object.entries(errors||{}).forEach(([name,message])=>setFieldError(name,message));showFormAlert('Не удалось сохранить объект. Исправьте отмеченные поля.');const first=one('.phase0-field.invalid input,.phase0-field.invalid select,.phase0-field.invalid textarea',byId('phase0-object-drawer'));if(first)first.focus()}

async function saveEditor(event){
  event.preventDefault();const form=byId('phase0-object-form'),button=byId('phase0-save');hideFormAlert();clearFieldErrors();byId('phase0-duplicate').classList.remove('show');button.disabled=true;button.innerHTML='<span class="phase0-spinner" aria-hidden="true"></span> Сохраняем';
  try{const hasAddress=fieldValue(form,'address').trim();if(hasAddress){const hasGeo=numericValue(form,'latitude')!=null&&numericValue(form,'longitude')!=null;const hasCluster=Boolean(fieldValue(form,'clusterId')||fieldValue(form,'clusterName'));if(hasGeo&&!hasCluster)syncClusterFromCoordinates();if(!hasGeo||!Boolean(fieldValue(form,'clusterId')||fieldValue(form,'clusterName')))await geocodeEditorAddress({silent:true});if(numericValue(form,'latitude')!=null&&numericValue(form,'longitude')!=null&&!Boolean(fieldValue(form,'clusterId')||fieldValue(form,'clusterName')))syncClusterFromCoordinates()}const saved=await phaseService.save(collectDraft(form),{projectId:state.drawerProjectId,expectedRevision:state.drawerRevision,layoutFile:state.pendingLayout});state.drawerDirty=false;state.pendingLayout=null;state.drawerProjectId=saved.id;state.drawerRevision=saved.phase0.revision;state.selectedId=String(saved.id);setUrlProject(saved.id);reload();toast('Объект сохранён.');openEditor(saved.id)}
  catch(error){
    if(error.code==='VALIDATION_ERROR')displayValidation(error.details.errors);
    else if(error.code==='POTENTIAL_DUPLICATE')renderDuplicate(error);
    else if(error.code==='REVISION_CONFLICT')showFormAlert('Объект уже изменён в другой вкладке. Закройте карточку, откройте её заново и повторите изменения. Сохранение остановлено, чтобы не перезаписать свежую версию.');
    else if(error.code==='PARTIAL_FILE_SAVE'){toast(error.message);state.drawerDirty=false;reload();if(error.details&&error.details.project)openEditor(error.details.project.id)}
    else showFormAlert(esc(error.message||'Не удалось сохранить объект.'));
  }finally{if(document.contains(button)){button.disabled=false;button.textContent='Сохранить'}}
}

async function deleteCurrentProject(){
  const id=state.drawerProjectId,project=id?rawProjectById(id):null;if(!project)return;
  const ok=confirm(`Удалить объект «${project.address||'без адреса'}»?\n\nОн будет перемещён в корзину и исчезнет из списка и карты.`);if(!ok)return;
  try{repo.softDelete(id);state.drawerDirty=false;closeEditor(true);state.selectedId='';setUrlProject('');reload();if(state.map)state.map.setProjects(state.visible);toast('Объект перемещён в корзину.')}catch(error){toast(error.message||'Не удалось удалить объект.')}
}

function goToPhase1(projectId){
  const project=rawProjectById(projectId);if(!project){toast('Сначала выберите объект.');return}const gate=phaseService.readiness(project);if(!gate.ready){toast(`Переход недоступен: ${gate.missing.slice(0,3).join('; ')}${gate.missing.length>3?'…':''}`);return}
  try{const saved=phaseService.markTransition(projectId);location.href=`source-specification.html?location=${encodeURIComponent(saved.id)}&from=phase0`}catch(error){toast(error.message||'Переход к смете недоступен.')}
}

function bindEditor(){
  const form=byId('phase0-object-form');form.addEventListener('submit',saveEditor);all('[data-action="close-editor"]',form).forEach(button=>button.addEventListener('click',()=>closeEditor()));
  form.addEventListener('input',event=>{if(event.target.name!=='rejectionReason')setFieldError(event.target.name,'');markEditorDirty();if(['area','rentMonthly'].includes(event.target.name))updateEditorComputed();if(['latitude','longitude'].includes(event.target.name))syncClusterFromCoordinates();if(event.target.name==='address'){event.target.dataset.userEdited='1';if(form.elements.latitude)form.elements.latitude.value='';if(form.elements.longitude)form.elements.longitude.value='';if(form.elements.clusterId)form.elements.clusterId.value='';if(form.elements.clusterName)form.elements.clusterName.value='';const clusterState=byId('phase0-cluster-state');if(clusterState){clusterState.className='phase0-import-state';clusterState.textContent='Определяем кластер по адресу…'}scheduleAddressGeocode();}if(event.target.name==='listingUrl')syncListingSource()});form.elements.address?.addEventListener('blur',()=>{clearTimeout(state.addressGeocodeTimer);geocodeEditorAddress()});
  form.addEventListener('change',event=>{
    if(event.target.name==='status'){const previous=event.target.dataset.previous||((rawProjectById(state.drawerProjectId)||{}).phase0||{}).status||S.STATUS.NO_ANSWER;event.target.dataset.previous=event.target.value;if(event.target.value===S.STATUS.REJECTED)rejectionDialog(previous);else{byId('phase0-rejection-field').style.display='none';markEditorDirty()}}
    if(event.target.name==='clusterId')syncClusterNameFromSelect();if(event.target.name==='status'){event.target.className=`phase0-status-select ${statusClass(event.target.value)}`;}if(['latitude','longitude'].includes(event.target.name))syncClusterFromCoordinates();if(event.target.name==='layoutFile')handleLayoutSelection(event.target);updateEditorComputed();updateEditorReadiness();
  });
  const status=form.elements.status;status.dataset.previous=status.value;
  one('[data-action="import-listing"]',form).addEventListener('click',importListing);
  one('[data-action="open-listing"]',form)?.addEventListener('click',()=>{const url=fieldValue(form,'listingUrl').trim();if(!url){toast('Ссылка на объявление не указана.');return}try{window.open(url,'_blank','noopener,noreferrer')}catch(error){toast('Не удалось открыть объявление.')}});
  one('[data-action="delete-project"]',form)?.addEventListener('click',deleteCurrentProject);
  one('[data-action="download-layout"]',form)?.addEventListener('click',downloadLayout);
  all('[data-action="editor-cluster"]',form).forEach(button=>button.addEventListener('click',()=>{const candidate=currentDraftCandidate();openCompetitive(candidate&&candidate.clusterName||candidate&&candidate.clusterId||'')}));
  all('[data-action="editor-phase1"]',form).forEach(button=>button.addEventListener('click',()=>goToPhase1(state.drawerProjectId)));
}

function competitiveStatusHtml(snapshot){
  const sheet=snapshot.sheetName||'Свод',count=Array.isArray(snapshot.rows)?snapshot.rows.length:0;
  let title,text;
  if(state.syncing||snapshot.status==='loading'){title='Читаем Excel';text=`Обрабатываем лист «${sheet}».`}
  else if(snapshot.status==='error'){title='Не удалось прочитать файл';text=snapshot.error}
  else if(snapshot.lastSuccess){title='Файл загружен';text=`${snapshot.fileName||'Конкурентный анализ.xlsx'} · лист «${sheet}» · ${count} кластеров · загружено ${fmtDate(snapshot.lastSuccess,true)}.`}
  else{title='Загрузите конкурентный анализ';text=`Выберите XLSX-файл. Программа прочитает все колонки и все строки листа «${sheet}».`}
  return`<div><strong>${esc(title)}</strong><p>${esc(text)}</p></div><div class="phase0-competitive-status-actions"><label class="phase0-btn small phase0-file-button">${snapshot.lastSuccess?'Заменить файл':'Загрузить XLSX'}<input id="phase0-competitive-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label></div>`;
}
function competitiveTableHtml(rows,snapshot){
  const schema=snapshot&&snapshot.columnSchema,columns=schema&&Array.isArray(schema.columns)?schema.columns:[];
  if(!rows.length)return'<div class="phase0-empty"><div><strong>Данные конкурентного анализа не загружены</strong><p>Загрузите XLSX-файл. Будет прочитан лист «Свод» целиком.</p></div></div>';
  if(!columns.length)return'<div class="phase0-empty"><div><strong>Не удалось определить структуру листа «Свод»</strong><p>Загрузите исходный XLSX-файл повторно.</p></div></div>';
  const topCells=[];let c=schema.startCol;
  const merges=Array.isArray(schema.merges)?schema.merges:[];
  while(c<=schema.endCol){
    const merge=merges.find(m=>m.s.r===schema.headerTopRow&&m.s.c===c);
    const col=columns.find(x=>x.index===c),text=col&&col.top||'';
    if(merge){topCells.push(`<th colspan="${merge.e.c-merge.s.c+1}" rowspan="${merge.e.r-merge.s.r+1}">${esc(text)}</th>`);c=merge.e.c+1;continue}
    const covered=merges.find(m=>m.s.r===schema.headerTopRow&&m.s.c<c&&m.e.c>=c&&m.e.r>=schema.headerTopRow);if(covered){c++;continue}
    topCells.push(`<th>${esc(text)}</th>`);c++;
  }
  const bottomCells=[];
  for(c=schema.startCol;c<=schema.endCol;c++){
    const covered=merges.find(m=>m.s.r===schema.headerTopRow&&m.e.r>=schema.headerBottomRow&&m.s.c<=c&&m.e.c>=c);if(covered)continue;
    const col=columns.find(x=>x.index===c);bottomCells.push(`<th>${esc(col&&col.bottom||'')}</th>`);
  }
  return`<div class="phase0-competitive-table-wrap"><table class="phase0-competitive-table phase0-competitive-source-table"><thead><tr class="phase0-source-head-top">${topCells.join('')}</tr><tr class="phase0-source-head-bottom">${bottomCells.join('')}</tr></thead><tbody>${rows.map(row=>`<tr class="${state.competitiveCluster&&(S.norm(row.clusterName)===S.norm(state.competitiveCluster)||S.norm(row.clusterId)===S.norm(state.competitiveCluster))?'highlight':''}">${columns.map(col=>`<td>${esc(row.raw&&row.raw[col.letter]!=null&&String(row.raw[col.letter]).trim()!==''?row.raw[col.letter]:'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function renderCompetitive(){
  const snapshot=competitive.snapshot(),allRows=snapshot.rows||[],rows=state.competitiveCluster?allRows.filter(row=>S.norm(row.clusterName)===S.norm(state.competitiveCluster)||S.norm(row.clusterId)===S.norm(state.competitiveCluster)):allRows,drawer=byId('phase0-competitive-drawer');
  const names=[...new Set([...clusters.list().map(x=>x.name),...allRows.map(x=>x.clusterName)].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  drawer.innerHTML=`<div class="phase0-drawer-head"><div><h2 id="phase0-competitive-title">Конкурентный анализ</h2><p>Ручная загрузка Excel · лист «${esc(snapshot.sheetName||'Свод')}»</p></div><button class="phase0-close" type="button" data-action="close-competitive" aria-label="Закрыть">×</button></div><div class="phase0-drawer-body"><div class="phase0-competitive-status">${competitiveStatusHtml(snapshot)}</div><div class="phase0-competitive-toolbar"><label class="phase0-field"><span>Фильтр по кластеру</span><select id="phase0-competitive-filter"><option value="">Все кластеры</option>${names.map(name=>`<option value="${esc(name)}" ${S.norm(name)===S.norm(state.competitiveCluster)?'selected':''}>${esc(name)}</option>`).join('')}</select></label><div><strong>${rows.length}</strong> ${rows.length===1?'кластер':'кластеров'}</div></div>${competitiveTableHtml(rows,snapshot)}</div>`;
  one('[data-action="close-competitive"]',drawer).onclick=closeCompetitive;
  const fileInput=byId('phase0-competitive-file');if(fileInput)fileInput.onchange=event=>{const file=event.target.files&&event.target.files[0];if(file)syncCompetitive(file)};
  byId('phase0-competitive-filter').onchange=event=>{state.competitiveCluster=event.target.value;renderCompetitive()};
}
function openCompetitive(cluster=''){state.lastFocused=document.activeElement;state.competitiveCluster=cluster||'';byId('phase0-competitive-overlay').hidden=false;document.body.classList.add('phase0-modal-open');renderCompetitive();setTimeout(()=>one('[data-action="close-competitive"]',byId('phase0-competitive-drawer'))?.focus(),20)}
function closeCompetitive(){byId('phase0-competitive-overlay').hidden=true;if(byId('phase0-object-overlay').hidden)document.body.classList.remove('phase0-modal-open');if(state.lastFocused&&document.contains(state.lastFocused))state.lastFocused.focus()}

async function syncCompetitive(file){
  if(state.syncing||!file)return;state.syncing=true;renderSyncStrip();if(!byId('phase0-competitive-overlay').hidden)renderCompetitive();
  const snapshot=await competitive.importFile(file);state.syncing=false;
  if(snapshot.status==='success'){phaseService.applyCompetitiveRows(snapshot);toast(`Файл «${snapshot.fileName||file.name}» загружен. Показатели объектов пересчитаны.`)}else toast(snapshot.error||'Не удалось прочитать файл конкурентного анализа.');
  reload();if(!byId('phase0-competitive-overlay').hidden)renderCompetitive();
}

function askInlineRejectionReason(project){return new Promise(resolve=>{const layer=document.createElement('div');layer.className='phase0-dialog-layer';const current=project&&project.phase0&&project.phase0.rejection&&project.phase0.rejection.reason||'';layer.innerHTML=`<div class="phase0-dialog" role="dialog" aria-modal="true" aria-labelledby="phase0-inline-rejection-title"><h3 id="phase0-inline-rejection-title">Укажите причину отказа</h3><p>Причина обязательна для статуса «Не подошло».</p><label class="phase0-field"><span>Причина отказа *</span><textarea id="phase0-inline-rejection-value">${esc(current)}</textarea><span class="phase0-field-error" id="phase0-inline-rejection-error"></span></label><div class="phase0-dialog-actions"><button class="phase0-btn" type="button" data-cancel>Отмена</button><button class="phase0-btn primary" type="button" data-save>Сохранить</button></div></div>`;document.body.appendChild(layer);const input=byId('phase0-inline-rejection-value');input.focus();const done=value=>{layer.remove();resolve(value)};one('[data-cancel]',layer).onclick=()=>done(null);one('[data-save]',layer).onclick=()=>{const value=input.value.trim();if(!value){const e=byId('phase0-inline-rejection-error');e.style.display='block';e.textContent='Введите причину отказа.';return}done(value)};layer.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();done(null)}})})}
async function handleInlineStatus(select){const id=select.dataset.projectId,project=rawProjectById(id);if(!project)return;const previous=select.dataset.previous||project.phase0.status,next=select.value;if(next===previous)return;select.disabled=true;try{let reason='';if(next===S.STATUS.REJECTED){reason=await askInlineRejectionReason(project);if(reason==null){select.value=previous;return}}phaseService.updateStatus(id,next,reason);toast(`Статус изменён: ${shortStatus(next)}.`);reload()}catch(error){select.value=previous;toast(error.message||'Не удалось изменить статус.')}finally{if(document.contains(select))select.disabled=false}}

function handleMainClick(event){
  const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;
  if(action==='add-project')openEditor();else if(action==='open-project'){selectProject(button.dataset.projectId,{scroll:false,focusMap:true});openEditor(button.dataset.projectId)}else if(action==='open-cluster')openCompetitive(button.dataset.cluster);else if(action==='focus-map'){selectProject(button.dataset.projectId,{scroll:false,focusMap:true});one('.phase0-mobile-views [data-mobile-view="map"]')?.click()}else if(action==='open-competitive')openCompetitive();
  else if(action==='toggle-filters'){const toolbar=one('.phase0-toolbar'),panel=byId('phase0-extra-filters'),open=!toolbar.classList.contains('filters-open');toolbar.classList.toggle('filters-open',open);panel.hidden=!open;button.setAttribute('aria-expanded',String(open));button.classList.toggle('active',open)}
  else if(action==='toggle-map-expand'){const column=one('.phase0-map-column'),expanded=!column.classList.contains('expanded');column.classList.toggle('expanded',expanded);button.setAttribute('aria-expanded',String(expanded));button.textContent=expanded?'Свернуть карту':'Развернуть карту';setTimeout(()=>state.map&&state.map.invalidate(),30)}
  else if(action==='toggle-list-expand'){state.listExpanded=!state.listExpanded;renderList();requestAnimationFrame(()=>byId('phase0-list-scroll')?.scrollIntoView({behavior:'smooth',block:'nearest'}))}
  else if(action==='quick-filter'){const key=button.dataset.quickFilter||'';state.quickFilter=key==='all'||state.quickFilter===key?'':key;byId('phase0-status-filter').value='';byId('phase0-readiness-filter').value='';renderKpis();renderList()}
  else if(action==='reset-filters'){byId('phase0-search').value='';byId('phase0-cluster-filter').value='';byId('phase0-status-filter').value='';byId('phase0-sort').value='rating-asc';byId('phase0-readiness-filter').value='';state.quickFilter='';one('.phase0-toolbar').classList.remove('filters-open');byId('phase0-extra-filters').hidden=true;byId('phase0-filter-button').setAttribute('aria-expanded','false');byId('phase0-filter-button').classList.remove('active');renderKpis();renderList()}
}
function bindMain(){
  byId('phase0-add').onclick=()=>openEditor();byId('phase0-mobile-add').onclick=()=>openEditor();byId('phase0-open-competitive').onclick=()=>openCompetitive();byId('phase0-main').addEventListener('click',handleMainClick);byId('phase0-main').addEventListener('change',event=>{const select=event.target.closest('.phase0-inline-status');if(select)handleInlineStatus(select)});
  const clusterToggle=byId('phase0-map-clusters-toggle');if(clusterToggle)clusterToggle.addEventListener('click',()=>{const next=!(clusterToggle.getAttribute('aria-pressed')==='true');clusterToggle.setAttribute('aria-pressed',String(next));clusterToggle.classList.toggle('off',!next);const label=clusterToggle.querySelector('span:last-child');if(label)label.textContent=next?'Скрыть кластеры':'Показать кластеры';if(state.map&&state.map.setClustersVisible)state.map.setClustersVisible(next)});
  ['phase0-search','phase0-cluster-filter','phase0-status-filter','phase0-sort','phase0-readiness-filter'].forEach(id=>byId(id).addEventListener(id==='phase0-search'?'input':'change',()=>{if(id!=='phase0-search'){state.quickFilter='';renderKpis()}renderList()}));
  byId('phase0-object-list').addEventListener('mouseover',event=>{const card=event.target.closest('.phase0-card');if(card)setCardHover(card.dataset.projectId)});byId('phase0-object-list').addEventListener('mouseout',event=>{const card=event.target.closest('.phase0-card');if(card&&!card.contains(event.relatedTarget))setCardHover('')});
  byId('phase0-object-list').addEventListener('keydown',event=>{const card=event.target.closest('.phase0-card');if(card&&event.target===card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();openEditor(card.dataset.projectId)}});
  all('.phase0-mobile-views [data-mobile-view]').forEach(button=>button.addEventListener('click',()=>{all('.phase0-mobile-views [data-mobile-view]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active))});const workspace=one('.phase0-workspace');workspace.dataset.mobileView=button.dataset.mobileView;if(button.dataset.mobileView==='map')setTimeout(()=>state.map&&state.map.invalidate(),30)}));
  byId('phase0-object-overlay').addEventListener('click',event=>{if(event.target===event.currentTarget)closeEditor()});byId('phase0-competitive-overlay').addEventListener('click',event=>{if(event.target===event.currentTarget)closeCompetitive()});
  document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(!byId('phase0-competitive-overlay').hidden)closeCompetitive();else if(!byId('phase0-object-overlay').hidden)closeEditor()});
}

async function backfillMissingGeoAndClusters(){
  if(state.backfillRunning||!geocoder)return;state.backfillRunning=true;let changed=false;
  try{
    const raw=repo.listPhase0();
    for(const project of raw){
      const geo=S.normalizeGeo(project.geo),known=clusters.find(project.clusterId||project.clusterName);
      if(known&&(!project.clusterId||!project.clusterName)){repo.mutate(project.id,p=>{p.clusterId=known.id;p.clusterName=known.name;return p},project.phase0&&project.phase0.revision,'phase0-normalize-cluster');changed=true;continue}
      if(geo&&!(project.clusterId||project.clusterName)){
        const match=clusters.findByCoordinates(geo.lat,geo.lng)||(clusters.findNearestByCoordinates&&clusters.findNearestByCoordinates(geo.lat,geo.lng,6000));if(match){repo.mutate(project.id,p=>{p.clusterId=match.id;p.clusterName=match.name;return p},project.phase0&&project.phase0.revision,'phase0-auto-cluster');changed=true}
      }
    }
    const missing=repo.listPhase0().filter(project=>project.address&&!S.normalizeGeo(project.geo));
    for(const project of missing){
      try{const result=await geocoder.geocode(project.address);if(!result)continue;const match=clusters.findByCoordinates(result.geo.lat,result.geo.lng)||(clusters.findNearestByCoordinates&&clusters.findNearestByCoordinates(result.geo.lat,result.geo.lng,6000));const fresh=repo.get(project.id);if(!fresh)continue;repo.mutate(project.id,p=>{p.geo=result.geo;if(match){p.clusterId=match.id;p.clusterName=match.name}return p},fresh.phase0&&fresh.phase0.revision,'phase0-auto-geocode');changed=true}catch(_){/* address remains editable manually */}
    }
  }finally{state.backfillRunning=false;if(changed)reload()}
}

async function initMap(){
  state.map=new S.MapService({containerId:'phase0-map',loadingId:'phase0-map-loading',messageId:'phase0-map-message',onSelect:id=>selectProject(id,{scroll:true}),onHover:setCardHover,onCluster:name=>{byId('phase0-cluster-filter').value=name;renderList();toast(`Показаны объекты кластера «${name}».`)}});
  try{await state.map.init(clusters.features());state.map.setProjects(state.visible);backfillMissingGeoAndClusters()}catch(error){console.warn(error)}
}

function init(){
  bindMain();const cached=competitive.snapshot();if(cached.rows&&cached.rows.length&&cached.lastSuccess)phaseService.applyCompetitiveRows(cached);reload();requestAnimationFrame(initMap);
  const params=new URLSearchParams(location.search),requested=params.get('location')||'';if(requested&&rawProjectById(requested)&&rawProjectById(requested).phase0){state.selectedId=requested;reload();openEditor(requested)}else if(params.get('create')==='1')openEditor();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
window.addEventListener('slogi:locations-updated',event=>{if(event&&event.detail&&String(event.detail.reason||'').startsWith('phase0'))return;reload()});
})();
