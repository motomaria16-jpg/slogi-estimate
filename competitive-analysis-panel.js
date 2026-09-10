(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SlogiCompetitiveAnalysisPanel=api;
})(typeof window!=='undefined'?window:globalThis,function(window){
  'use strict';

  const state={initialized:false,syncing:false,filter:'',lastFocused:null,overlay:null,drawer:null,options:{},boundTriggers:new WeakSet()};
  const byId=id=>document.getElementById(id);
  const esc=value=>String(value==null?'':value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const normal=value=>String(value==null?'':value).trim().toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ');
  const formatDate=value=>{if(!value)return'Нет данных';const date=new Date(value);return Number.isNaN(date.getTime())?'Нет данных':date.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});};
  const repository=()=>window.SlogiPhase0&&window.SlogiPhase0.competitiveRepository;
  const phaseService=()=>window.SlogiPhase0&&window.SlogiPhase0.phase0Service;
  const clusters=()=>window.SlogiPhase0&&window.SlogiPhase0.clusterService;
  const isOpen=()=>Boolean(state.overlay&&!state.overlay.hidden);

  function ensureDom(){
    let overlay=byId('phase0-competitive-overlay'),drawer=byId('phase0-competitive-drawer');
    if(!overlay){
      overlay=document.createElement('div');
      overlay.className='phase0-overlay competitive-analysis-overlay';
      overlay.id='phase0-competitive-overlay';
      overlay.hidden=true;
      overlay.innerHTML='<aside class="phase0-drawer phase0-competitive-drawer" id="phase0-competitive-drawer" role="dialog" aria-modal="true" aria-labelledby="phase0-competitive-title" aria-describedby="phase0-competitive-description" tabindex="-1"></aside>';
      document.body.appendChild(overlay);
      drawer=byId('phase0-competitive-drawer');
    }
    state.overlay=overlay;state.drawer=drawer;
  }

  function statusHtml(snapshot){
    const sheet=snapshot.sheetName||'Свод',count=Array.isArray(snapshot.rows)?snapshot.rows.length:0;
    let title,text;
    if(state.syncing||snapshot.status==='loading'){title='Читаем Excel';text=`Обрабатываем лист «${sheet}».`}
    else if(snapshot.status==='error'){title='Не удалось прочитать файл';text=snapshot.error||'Загрузите корректный XLSX-файл.'}
    else if(snapshot.lastSuccess){title='Файл загружен';text=`${snapshot.fileName||'Конкурентный анализ.xlsx'} · лист «${sheet}» · ${count} кластеров · загружено ${formatDate(snapshot.lastSuccess)}.`}
    else{title='Загрузите конкурентный анализ';text=`Выберите XLSX-файл. Программа прочитает все колонки и все строки листа «${sheet}».`}
    return`<div><strong>${esc(title)}</strong><p>${esc(text)}</p></div><div class="phase0-competitive-status-actions"><input id="phase0-competitive-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ${state.syncing?'disabled':''} hidden><button class="phase0-btn small phase0-file-button" id="phase0-competitive-file-trigger" type="button" ${state.syncing?'disabled':''}>${snapshot.lastSuccess?'Заменить файл':'Загрузить XLSX'}</button></div>`;
  }

  function tableHtml(rows,snapshot,filter){
    const schema=snapshot&&snapshot.columnSchema,columns=schema&&Array.isArray(schema.columns)?schema.columns:[];
    if(!rows.length)return'<div class="phase0-empty"><div><strong>Данные конкурентного анализа не загружены</strong><p>Загрузите XLSX-файл. Будет прочитан лист «Свод» целиком.</p></div></div>';
    if(!columns.length)return'<div class="phase0-empty"><div><strong>Не удалось определить структуру листа «Свод»</strong><p>Загрузите исходный XLSX-файл повторно.</p></div></div>';
    const topCells=[];let columnIndex=schema.startCol;
    const merges=Array.isArray(schema.merges)?schema.merges:[];
    while(columnIndex<=schema.endCol){
      const merge=merges.find(item=>item.s.r===schema.headerTopRow&&item.s.c===columnIndex),column=columns.find(item=>item.index===columnIndex),text=column&&column.top||'';
      if(merge){topCells.push(`<th colspan="${merge.e.c-merge.s.c+1}" rowspan="${merge.e.r-merge.s.r+1}">${esc(text)}</th>`);columnIndex=merge.e.c+1;continue}
      const covered=merges.find(item=>item.s.r===schema.headerTopRow&&item.s.c<columnIndex&&item.e.c>=columnIndex&&item.e.r>=schema.headerTopRow);if(covered){columnIndex++;continue}
      topCells.push(`<th>${esc(text)}</th>`);columnIndex++;
    }
    const bottomCells=[];
    for(columnIndex=schema.startCol;columnIndex<=schema.endCol;columnIndex++){
      const covered=merges.find(item=>item.s.r===schema.headerTopRow&&item.e.r>=schema.headerBottomRow&&item.s.c<=columnIndex&&item.e.c>=columnIndex);if(covered)continue;
      const column=columns.find(item=>item.index===columnIndex);bottomCells.push(`<th>${esc(column&&column.bottom||'')}</th>`);
    }
    return`<div class="phase0-competitive-table-wrap"><table class="phase0-competitive-table phase0-competitive-source-table"><thead><tr class="phase0-source-head-top">${topCells.join('')}</tr><tr class="phase0-source-head-bottom">${bottomCells.join('')}</tr></thead><tbody>${rows.map(row=>`<tr class="${filter&&(normal(row.clusterName)===normal(filter)||normal(row.clusterId)===normal(filter))?'highlight':''}">${columns.map(column=>`<td>${esc(row.raw&&row.raw[column.letter]!=null&&String(row.raw[column.letter]).trim()!==''?row.raw[column.letter]:'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function render(){
    if(!state.drawer)return;
    const repo=repository();if(!repo)return;
    const snapshot=repo.snapshot(),allRows=Array.isArray(snapshot.rows)?snapshot.rows:[],rows=state.filter?allRows.filter(row=>normal(row.clusterName)===normal(state.filter)||normal(row.clusterId)===normal(state.filter)):allRows;
    const clusterNames=clusters()&&typeof clusters().list==='function'?clusters().list().map(item=>item.name):[];
    const names=[...new Set([...clusterNames,...allRows.map(item=>item.clusterName)].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    state.drawer.setAttribute('aria-busy',String(state.syncing));
    state.drawer.innerHTML=`<div class="phase0-drawer-head"><div><h2 id="phase0-competitive-title">Конкурентный анализ</h2><p id="phase0-competitive-description">Ручная загрузка Excel · лист «${esc(snapshot.sheetName||'Свод')}»</p></div><button class="phase0-close" type="button" data-competitive-close aria-label="Закрыть">×</button></div><div class="phase0-drawer-body"><div class="phase0-competitive-status" role="status" aria-live="polite">${statusHtml(snapshot)}</div><div class="phase0-competitive-toolbar"><label class="phase0-field"><span>Фильтр по кластеру</span><select id="phase0-competitive-filter"><option value="">Все кластеры</option>${names.map(name=>`<option value="${esc(name)}" ${normal(name)===normal(state.filter)?'selected':''}>${esc(name)}</option>`).join('')}</select></label><div><strong>${rows.length}</strong> ${rows.length===1?'кластер':'кластеров'}</div></div>${tableHtml(rows,snapshot,state.filter)}</div>`;
    state.drawer.querySelector('[data-competitive-close]').addEventListener('click',close);
    const input=byId('phase0-competitive-file'),fileTrigger=byId('phase0-competitive-file-trigger');
    if(input)input.addEventListener('change',event=>{const file=event.target.files&&event.target.files[0];if(file)importFile(file);});
    if(input&&fileTrigger)fileTrigger.addEventListener('click',()=>input.click());
    const filter=byId('phase0-competitive-filter');if(filter)filter.addEventListener('change',event=>{state.filter=event.target.value;render();});
  }

  function notify(message,isError=false){
    if(typeof state.options.toast==='function'){state.options.toast(message,isError);return;}
    window.dispatchEvent(new CustomEvent('slogi:competitive-analysis-message',{detail:{message,isError}}));
  }

  function emitUpdated(snapshot,changes){
    window.dispatchEvent(new CustomEvent('slogi:competitive-analysis-updated',{detail:{snapshot,changes:Array.isArray(changes)?changes:[]}}));
    if(typeof state.options.onUpdated==='function')Promise.resolve(state.options.onUpdated(snapshot,changes)).catch(()=>{});
  }

  async function importFile(file){
    const repo=repository(),service=phaseService();if(state.syncing||!file||!repo)return;
    state.syncing=true;render();
    let snapshot;
    try{snapshot=await repo.importFile(file);}
    catch(error){snapshot={status:'error',error:error&&error.message||'Не удалось прочитать файл конкурентного анализа.'};}
    state.syncing=false;
    if(snapshot.status==='success'){
      const changes=service&&typeof service.applyCompetitiveRows==='function'?service.applyCompetitiveRows(snapshot):[];
      render();emitUpdated(snapshot,changes);notify(`Файл «${snapshot.fileName||file.name}» загружен. Показатели помещений пересчитаны.`);
      try{if(window.SlogiCloud&&typeof window.SlogiCloud.sync==='function')await window.SlogiCloud.sync();}
      catch(_error){notify('Файл загружен локально, но синхронизацию общего пространства нужно повторить.',true);}
      if(typeof repo.rehydrate==='function')repo.rehydrate();
    }else notify(snapshot.error||'Не удалось прочитать файл конкурентного анализа.',true);
    render();
  }

  function open(options={}){
    if(typeof options==='string')options={cluster:options};
    init();const repo=repository();if(!repo){notify('Модуль конкурентного анализа недоступен.',true);return;}
    if(typeof repo.rehydrate==='function')repo.rehydrate();
    state.lastFocused=options.opener||document.activeElement;state.filter=String(options.cluster||'');state.overlay.hidden=false;document.body.classList.add('phase0-modal-open');render();
    setTimeout(()=>state.drawer&&state.drawer.querySelector('[data-competitive-close]')?.focus(),20);
  }

  function close(){
    if(!isOpen())return;state.overlay.hidden=true;
    const objectOverlay=byId('phase0-object-overlay'),spaceOverlay=document.querySelector('.search-space-card-overlay:not([hidden])');
    if((!objectOverlay||objectOverlay.hidden)&&!spaceOverlay)document.body.classList.remove('phase0-modal-open');
    const target=state.lastFocused;state.lastFocused=null;if(target&&document.contains(target))target.focus();
  }

  function onKeydown(event){
    if(!isOpen())return;
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key!=='Tab')return;
    const focusable=[...state.drawer.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[href],[tabindex]:not([tabindex="-1"])')].filter(node=>!node.hidden&&node.getClientRects().length);
    if(!focusable.length){event.preventDefault();state.drawer.focus();return;}
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }

  function refreshFromWorkspace(){
    const repo=repository();if(!repo||state.syncing||repo.snapshot().status==='loading')return;
    if(typeof repo.rehydrate==='function')repo.rehydrate();if(isOpen())render();
  }

  function bindTrigger(trigger){
    if(!trigger||state.boundTriggers.has(trigger))return;state.boundTriggers.add(trigger);
    trigger.addEventListener('click',()=>open({opener:trigger}));
  }

  function init(options={}){
    state.options=Object.assign({},state.options,options||{});ensureDom();
    const trigger=state.options.trigger;
    if(typeof trigger==='string')document.querySelectorAll(trigger).forEach(bindTrigger);else if(trigger)bindTrigger(trigger);
    if(!state.initialized){state.initialized=true;state.overlay.addEventListener('click',event=>{if(event.target===state.overlay)close();});document.addEventListener('keydown',onKeydown);window.addEventListener('slogi:locations-updated',refreshFromWorkspace);window.addEventListener('slogi:workspace-updated',refreshFromWorkspace);}
    return api;
  }

  const api={init,open,close,render,importFile,isOpen};
  return api;
});
