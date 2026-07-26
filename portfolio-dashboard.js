(function(){
  'use strict';

  const P = window.SlogiPro;
  if(!P) return;

  const $ = selector => document.querySelector(selector);
  const esc = value => String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const today = () => new Date().toISOString().slice(0,10);
  const doneTask = status => ['Готово','Завершена','Завершён','Отменена','Отменено'].includes(String(status || ''));
  const paidPayment = status => ['Оплачен','Оплачено'].includes(String(status || ''));
  const safeDate = value => value && /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? String(value).slice(0,10) : '';

  let activeView = localStorage.getItem('slogi_portfolio_view_v2') || 'table';
  if(localStorage.getItem('slogi_dashboard_layout_v3')!=='1'){activeView='table';localStorage.setItem('slogi_portfolio_view_v2','table');localStorage.setItem('slogi_dashboard_layout_v3','1');}
  if(!['table','cards','kanban','map'].includes(activeView)) activeView = 'table';
  let snapshot = null;
  let renderTimer = null;
  let mapInstance = null;
  let mapCollection = null;
  let mapLoading = false;

  function buildSnapshot(){
    const workspace = P.read();
    const projects = P.readLocations().filter(item => item && item.id && item.address && !item.deletedAt);
    const members = new Map((workspace.members || []).map(member => [String(member.id), member]));
    const docsByProject = new Map();
    (workspace.documentVersions || []).forEach(doc => {
      const key = String(doc.projectId || '');
      if(!docsByProject.has(key)) docsByProject.set(key, new Set());
      docsByProject.get(key).add(String(doc.type || ''));
    });
    return {workspace, projects, members, docsByProject};
  }

  function projectStatus(project){ return project.status || project.projectStatus || 'Новый'; }
  function projectManager(project){
    const id = String(project.managerId || 'member-maria');
    return snapshot.members.get(id)?.name || 'Не назначен';
  }
  function completeness(project){
    const present = new Set(snapshot.docsByProject.get(String(project.id)) || []);
    if(project.planName) present.add('План');
    if(project.specName || (project.excelLabel && !/демо/i.test(project.excelLabel))) present.add('Спецификация');
    if(project.estimateName || Number(project.total) > 0) present.add('Смета');
    if(project.proposalName) present.add('КП');
    return Math.round(['План','Спецификация','Смета','КП'].filter(type => present.has(type)).length / 4 * 100);
  }
  function statusClass(status){ return P.statusClass ? P.statusClass(status) : 'neutral'; }
  function money(value){ return P.formatMoney ? P.formatMoney(value) : Math.round(Number(value)||0).toLocaleString('ru-RU') + ' ₽'; }
  function date(value){ return P.formatDate ? P.formatDate(value) : (value || '—'); }
  function projectName(id){
    const project = snapshot.projects.find(item => String(item.id) === String(id));
    return project ? project.address : 'Объект';
  }

  function renderKpis(){
    const t = today();
    const active = snapshot.projects.filter(project => !['Завершён','Архив'].includes(projectStatus(project))).length;
    const pendingApprovals = (snapshot.workspace.approvals || []).filter(item => ['На согласовании','Возвращено'].includes(item.status)).length;
    const overdue = (snapshot.workspace.tasks || []).filter(item => safeDate(item.dueDate) && safeDate(item.dueDate) < t && !doneTask(item.status)).length;
    const budget = snapshot.projects.reduce((sum, project) => sum + Number(project.total || 0), 0);
    $('#kpi-grid').innerHTML = `
      <article class="kpi-card">
        <div class="kpi-label">Активные объекты</div><div class="kpi-value">${active}</div><div class="kpi-note">Всего в портфеле: ${snapshot.projects.length}</div>
      </article>
      <article class="kpi-card warn">
        <div class="kpi-label">На согласовании</div><div class="kpi-value">${pendingApprovals}</div><div class="kpi-note">Документы ожидают решения</div>
      </article>
      <article class="kpi-card ${overdue ? 'bad' : 'good'}">
        <div class="kpi-label">Просроченные задачи</div><div class="kpi-value">${overdue}</div><div class="kpi-note">${overdue ? 'Необходимо проверить сроки' : 'Критичных просрочек нет'}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Бюджет портфеля</div><div class="kpi-value money">${money(budget)}</div><div class="kpi-note">По сохранённым сметам</div>
      </article>`;
  }

  function collectAttention(){
    const t = today();
    const result = [];
    (snapshot.workspace.tasks || []).forEach(item => {
      const due = safeDate(item.dueDate);
      if(due && due < t && !doneTask(item.status)) result.push({
        level:'bad', order:due, title:item.title || 'Просроченная задача',
        sub:`${projectName(item.projectId)} · срок ${date(due)}`, href:'tasks.html?filter=overdue'
      });
    });
    (snapshot.workspace.approvals || []).forEach(item => {
      if(['На согласовании','Возвращено'].includes(item.status)) result.push({
        level:'warn', order:safeDate(item.dueDate) || '9999-12-31', title:item.title || 'Согласование',
        sub:`${projectName(item.projectId)} · ${item.status}`, href:'approvals.html'
      });
    });
    (snapshot.workspace.payments || []).forEach(item => {
      const due = safeDate(item.plannedDate);
      if(due && due <= t && !paidPayment(item.status)) result.push({
        level:due < t ? 'bad' : 'warn', order:due, title:item.title || 'Платёж по объекту',
        sub:`${projectName(item.projectId)} · ${money(item.amount)} · ${date(due)}`, href:'finance.html'
      });
    });
    (snapshot.workspace.risks || []).forEach(item => {
      if(item.status === 'Открыт' && (/высок/i.test(item.probability || '') || /высок/i.test(item.impact || ''))) result.push({
        level:'warn', order:'9999-12-30', title:item.title || 'Открытый риск',
        sub:`${projectName(item.projectId)} · ${item.probability || 'риск'}`, href:`passport.html?location=${encodeURIComponent(item.projectId || '')}`
      });
    });
    return result.sort((a,b) => String(a.order).localeCompare(String(b.order))).slice(0,5);
  }

  function renderAttention(){
    const items = collectAttention();
    $('#attention-list').innerHTML = items.length ? items.map(item => `
      <a class="attention-item" href="${esc(item.href)}">
        <span class="attention-dot ${esc(item.level)}"></span>
        <span><span class="attention-title">${esc(item.title)}</span><span class="attention-sub">${esc(item.sub)}</span></span>
        <span class="attention-arrow">›</span>
      </a>`).join('') : '<div class="empty-compact">Критичных событий нет. Сроки и платежи находятся под контролем.</div>';
  }

  function populateFilters(){
    const cluster = $('#portfolio-cluster');
    const status = $('#portfolio-status');
    const selectedCluster = cluster.value;
    const selectedStatus = status.value;
    const clusters = [...new Set(snapshot.projects.map(project => String(project.clusterName || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ru'));
    const configured = snapshot.workspace.settings?.statuses || [];
    const actual = snapshot.projects.map(projectStatus);
    const statuses = [...new Set([...configured,...actual].filter(Boolean))];
    cluster.innerHTML = '<option value="">Все кластеры</option>' + clusters.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
    status.innerHTML = '<option value="">Все статусы</option>' + statuses.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
    if(clusters.includes(selectedCluster)) cluster.value = selectedCluster;
    if(statuses.includes(selectedStatus)) status.value = selectedStatus;
  }

  function filteredProjects(){
    const query = String($('#portfolio-search').value || '').trim().toLowerCase();
    const cluster = $('#portfolio-cluster').value;
    const status = $('#portfolio-status').value;
    return snapshot.projects.filter(project => {
      const haystack = [project.address, project.clusterName, project.landlord, project.legalEntity, projectManager(project)].join(' ').toLowerCase();
      return (!query || haystack.includes(query)) && (!cluster || project.clusterName === cluster) && (!status || projectStatus(project) === status);
    });
  }

  function renderSummary(items){
    const total = items.reduce((sum, project) => sum + Number(project.total || 0), 0);
    $('#portfolio-summary').textContent = `Показано: ${items.length} из ${snapshot.projects.length} · Сумма смет в выборке: ${money(total)}`;
  }

  function tableRows(items){
    return items.map(project => {
      const percent = completeness(project);
      return `<tr data-open-project="${esc(project.id)}">
        <td class="object-main-cell"><strong>${esc(project.address)}</strong><span>${esc(project.clusterName || 'Кластер не указан')}</span></td>
        <td><span class="status-pill ${statusClass(projectStatus(project))}">${esc(projectStatus(project))}</span></td>
        <td>${esc(projectManager(project))}</td>
        <td><span class="completeness"><span class="progress-track"><span style="width:${percent}%"></span></span><strong>${percent}%</strong></span></td>
        <td>${date(project.plannedOpening)}</td>
        <td><strong>${money(project.total)}</strong></td>
        <td><div class="table-actions"><a class="icon-button" href="passport.html?location=${encodeURIComponent(project.id)}" title="Открыть паспорт">Открыть</a><button class="icon-button danger" type="button" data-delete-project="${esc(project.id)}" title="Переместить в корзину">×</button></div></td>
      </tr>`;
    }).join('');
  }

  function cardItems(items, mobileClass='cards-grid'){
    return `<div class="${mobileClass}">${items.map(project => {
      const percent = completeness(project);
      return `<article class="object-card">
        <div class="object-card-top"><h3>${esc(project.address)}</h3><span class="status-pill ${statusClass(projectStatus(project))}">${esc(projectStatus(project))}</span></div>
        <div class="object-card-meta">
          <div><span>Ответственный</span><strong>${esc(projectManager(project))}</strong></div>
          <div><span>Смета</span><strong>${money(project.total)}</strong></div>
          <div><span>Кластер</span><strong>${esc(project.clusterName || '—')}</strong></div>
          <div><span>Открытие</span><strong>${date(project.plannedOpening)}</strong></div>
        </div>
        <div class="object-card-footer"><span class="completeness"><span class="progress-track"><span style="width:${percent}%"></span></span><strong>${percent}%</strong></span><a class="secondary-action" href="passport.html?location=${encodeURIComponent(project.id)}">Открыть</a></div>
      </article>`;
    }).join('')}</div>`;
  }

  function renderTable(items){
    if(!items.length) return renderEmpty();
    $('#portfolio-view').innerHTML = `
      <div class="portfolio-table-wrap"><table class="portfolio-table"><thead><tr><th>Объект</th><th>Статус</th><th>Ответственный</th><th>Комплектность</th><th>Дата открытия</th><th>Смета</th><th></th></tr></thead><tbody>${tableRows(items)}</tbody></table></div>
      ${cardItems(items,'mobile-object-list cards-grid')}`;
  }

  function renderCards(items){
    if(!items.length) return renderEmpty();
    $('#portfolio-view').innerHTML = cardItems(items);
  }

  function renderKanban(items){
    if(!items.length) return renderEmpty();
    const order = snapshot.workspace.settings?.statuses || [];
    const present = [...new Set(items.map(projectStatus))];
    const statuses = [...order.filter(status => present.includes(status)), ...present.filter(status => !order.includes(status))];
    $('#portfolio-view').innerHTML = `<div class="kanban-board">${statuses.map(status => {
      const projects = items.filter(project => projectStatus(project) === status);
      return `<section class="kanban-column"><div class="kanban-head"><span>${esc(status)}</span><span class="kanban-count">${projects.length}</span></div>${projects.map(project => `<a class="kanban-item" href="passport.html?location=${encodeURIComponent(project.id)}"><strong>${esc(project.address)}</strong><span>${esc(projectManager(project))} · ${money(project.total)}</span></a>`).join('')}</section>`;
    }).join('')}</div>`;
  }

  function renderMapPlaceholder(items){
    const cached = items.filter(project => validCoordinates(project)).length;
    $('#portfolio-view').innerHTML = `<div class="map-panel"><div class="map-placeholder"><div class="map-placeholder-inner"><h3>Карта загружается только по запросу</h3><p>Так главная страница открывается быстро и не зависает. Координаты уже сохранены для ${cached} из ${items.length} объектов.</p><button class="primary-action" type="button" id="load-map-button">Загрузить Яндекс Карты</button></div></div></div>`;
    $('#load-map-button').addEventListener('click', () => loadMap(items));
  }

  function renderEmpty(){
    $('#portfolio-view').innerHTML = `<div class="dashboard-empty"><h3>${snapshot.projects.length ? 'Объекты не найдены' : 'Объектов пока нет'}</h3><div>${snapshot.projects.length ? 'Измените параметры поиска или фильтры.' : 'Создайте первый объект, чтобы начать работу с портфелем.'}</div>${snapshot.projects.length ? '' : '<a class="primary-action" style="margin-top:16px" href="passport.html">＋ Создать объект</a>'}</div>`;
  }

  function renderPortfolio(){
    const items = filteredProjects();
    renderSummary(items);
    document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === activeView));
    if(activeView === 'cards') renderCards(items);
    else if(activeView === 'kanban') renderKanban(items);
    else if(activeView === 'map') renderMapPlaceholder(items);
    else renderTable(items);
  }

  function renderAll(){
    try{
      snapshot = buildSnapshot();
      renderKpis();
      renderAttention();
      populateFilters();
      renderPortfolio();
      showError('');
    }catch(error){
      console.error('SLOGI dashboard:', error);
      showError('Не удалось обновить главную страницу. Обновите страницу сочетанием Ctrl+F5.');
    }
  }

  function showError(text){
    const element = $('#dashboard-error');
    if(!element) return;
    element.textContent = text || '';
    element.classList.toggle('show', Boolean(text));
  }

  function scheduleRender(){
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderAll, 60);
  }

  function validCoordinates(project){
    const lat = Number(project?.geo?.lat), lng = Number(project?.geo?.lng);
    if(!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if(project.geo.address && String(project.geo.address).trim() !== String(project.address || '').trim()) return null;
    return [lat,lng];
  }

  function loadScript(src,id){
    return new Promise((resolve,reject) => {
      if(id && document.getElementById(id)){
        const existing = document.getElementById(id);
        if(existing.dataset.loaded === '1') return resolve();
        existing.addEventListener('load',resolve,{once:true}); existing.addEventListener('error',reject,{once:true}); return;
      }
      const script = document.createElement('script');
      if(id) script.id = id;
      script.src = src; script.async = true;
      script.onload = () => {script.dataset.loaded='1';resolve();};
      script.onerror = () => reject(new Error('Не удалось загрузить внешний скрипт.'));
      document.head.appendChild(script);
    });
  }

  async function ensureYmaps(){
    if(window.ymaps) return window.ymaps;
    const key = String(window.SLOGI_CONFIG?.yandexMapsApiKey || '').trim();
    if(!key) throw new Error('Ключ Яндекс Карт не указан.');
    await loadScript(`https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(key)}&lang=ru_RU`,'portfolio-yandex-api');
    return new Promise((resolve,reject) => {
      if(!window.ymaps) return reject(new Error('Яндекс Карты не ответили.'));
      window.ymaps.ready(() => resolve(window.ymaps));
    });
  }

  async function loadMap(items){
    if(mapLoading) return;
    mapLoading = true;
    $('#portfolio-view').innerHTML = '<div class="map-panel"><div class="map-placeholder"><div class="map-placeholder-inner"><div class="loading-spinner" style="margin:0 auto 14px"></div><h3>Загружаю карту</h3><p>Остальная часть сайта продолжает работать.</p></div></div></div>';
    try{
      const ymaps = await ensureYmaps();
      $('#portfolio-view').innerHTML = '<div class="map-panel"><div class="map-toolbar"><span id="map-info"></span><button class="secondary-action" type="button" id="geocode-button">Определить отсутствующие координаты</button></div><div id="portfolio-map"></div></div>';
      mapInstance = new ymaps.Map('portfolio-map',{center:[55.75,37.62],zoom:9,controls:['zoomControl','fullscreenControl','typeSelector']},{minZoom:5,maxZoom:19,suppressMapOpenBlock:true});
      mapCollection = new ymaps.GeoObjectCollection();
      mapInstance.geoObjects.add(mapCollection);
      drawMarkers(items);
      $('#geocode-button').addEventListener('click', () => geocodeMissing(items));
    }catch(error){
      $('#portfolio-view').innerHTML = `<div class="map-panel"><div class="map-placeholder"><div class="map-placeholder-inner"><h3>Карта не загрузилась</h3><p>${esc(error.message || 'Проверьте ключ и ограничения домена в кабинете Яндекс Карт.')}</p><button class="secondary-action" type="button" id="map-retry">Повторить</button></div></div></div>`;
      $('#map-retry')?.addEventListener('click', () => loadMap(items));
    }finally{ mapLoading = false; }
  }

  function drawMarkers(items){
    if(!mapInstance || !mapCollection || !window.ymaps) return;
    mapCollection.removeAll();
    const points = [];
    let missing = 0;
    items.forEach(project => {
      const coords = validCoordinates(project);
      if(!coords){missing++;return;}
      points.push(coords);
      const body = `<div style="max-width:280px"><strong style="color:#36565b">${esc(project.address)}</strong><div style="margin-top:6px;color:#75878b">${esc(projectStatus(project))} · ${money(project.total)}</div><a style="display:inline-block;margin-top:9px;color:#36565b;font-weight:800" href="passport.html?location=${encodeURIComponent(project.id)}">Открыть паспорт</a></div>`;
      mapCollection.add(new window.ymaps.Placemark(coords,{hintContent:project.address,balloonContentBody:body},{preset:'islands#darkGreenCircleDotIcon'}));
    });
    if(points.length){
      const bounds = window.ymaps.util.bounds.fromPoints(points);
      if(bounds) mapInstance.setBounds(bounds,{checkZoomRange:true,zoomMargin:70});
    }
    const info = $('#map-info');
    if(info) info.textContent = `На карте: ${points.length} · без координат: ${missing}`;
    const button = $('#geocode-button');
    if(button) button.style.display = missing ? '' : 'none';
  }

  async function geocodeMissing(items){
    const button = $('#geocode-button');
    if(!button || !window.ymaps) return;
    const missing = items.filter(project => !validCoordinates(project));
    if(!missing.length) return;
    button.disabled = true;
    const original = button.textContent;
    const locations = P.readLocations();
    let changed = false;
    try{
      for(let index=0; index<missing.length; index++){
        const project = missing[index];
        button.textContent = `Адрес ${index+1} из ${missing.length}…`;
        try{
          const result = await window.ymaps.geocode(project.address,{results:1});
          const first = result.geoObjects.get(0);
          if(first){
            const coords = first.geometry.getCoordinates();
            const target = locations.find(item => String(item.id) === String(project.id));
            if(target){target.geo={lat:Number(coords[0]),lng:Number(coords[1]),provider:'yandex',address:String(target.address || '').trim(),updatedAt:new Date().toISOString()};changed=true;}
          }
        }catch(error){ console.warn('Не удалось определить адрес:',project.address,error); }
        await new Promise(resolve => setTimeout(resolve,120));
      }
      if(changed) P.writeLocations(locations);
      snapshot = buildSnapshot();
      drawMarkers(filteredProjects());
    }finally{
      button.disabled = false;
      button.textContent = original;
    }
  }

  function deleteProject(id){
    const project = snapshot.projects.find(item => String(item.id) === String(id));
    if(!project) return;
    if(!window.confirm(`Переместить объект «${project.address}» в корзину? Его можно будет восстановить в настройках.`)) return;
    P.softDeleteProject(project);
    P.writeLocations(P.readLocations().filter(item => String(item.id) !== String(id)));
    scheduleRender();
  }

  function bindEvents(){
    $('#portfolio-search').addEventListener('input',scheduleRender);
    $('#portfolio-cluster').addEventListener('change',renderPortfolio);
    $('#portfolio-status').addEventListener('change',renderPortfolio);
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click',() => {
      activeView = button.dataset.view;
      localStorage.setItem('slogi_portfolio_view_v2',activeView);
      renderPortfolio();
    }));
    $('#portfolio-view').addEventListener('click',event => {
      const deleteButton = event.target.closest('[data-delete-project]');
      if(deleteButton){event.preventDefault();event.stopPropagation();deleteProject(deleteButton.dataset.deleteProject);return;}
      const row = event.target.closest('[data-open-project]');
      if(row && !event.target.closest('a,button')) location.href = `passport.html?location=${encodeURIComponent(row.dataset.openProject)}`;
    });
    window.addEventListener('slogi:professional-state',scheduleRender);
    window.addEventListener('slogi:locations-updated',scheduleRender);
    window.addEventListener('slogi:workspace-updated',scheduleRender);
    window.addEventListener('slogi:cloud-ready',scheduleRender);
    window.addEventListener('storage',event => {if(['slogi_locations_v1','slogi_professional_state_v2'].includes(event.key))scheduleRender();});
  }

  function init(){
    bindEvents();
    renderAll();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
