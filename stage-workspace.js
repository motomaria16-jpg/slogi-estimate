(function(){
'use strict';
const S=window.SlogiPhase0;if(!S)return;
const byId=id=>document.getElementById(id),esc=S.esc,section=new URLSearchParams(location.search).get('section')==='repair'?'repair':'estimate',selected=new URLSearchParams(location.search).get('location')||'';
const repo=S.projectRepository,service=S.phase0Service,competitive=S.competitiveRepository;
let projects=[];
function shortStatus(value){if(value===S.STATUS.WAITING)return'Ждём информацию';if(value===S.STATUS.ANALYSING)return'Анализируем';return value||'Не отвечает'}
function repairEligible(project){return Number(project.lifecyclePhase)>=2||Number(project.stage)>=4}
function link(file,id){return`${file}?location=${encodeURIComponent(id)}`}
function readinessProgress(project){const phase=project.phase0||{},criteria=phase.selectionCriteria||{},measurement=phase.measurement||{},checks=[phase.status===S.STATUS.SUITABLE,project.area!=null&&phase.roomsCount!=null&&project.ceilingHeight!=null&&phase.rent&&phase.rent.period==='month'&&S.rentPerSqm(project.area,phase.rent.amount)!=null,Boolean(project.clusterId||project.clusterName),S.CRITERIA_KEYS.every(key=>criteria[key]===true),Boolean(phase.layout&&phase.layout.received),Boolean(phase.interest&&phase.interest.confirmed),measurement.status==='Выполнен'&&Boolean(measurement.date)];return{done:checks.filter(Boolean).length,total:checks.length}}
function missingLabel(value){const text=String(value||''),normalized=text.toLowerCase();if(normalized.includes('статус'))return'Статус';if(normalized.includes('кабинет'))return'Кабинеты';if(normalized.includes('высот'))return'Высота';if(normalized.includes('стоимости за 1 м²'))return'Аренда / м²';if(normalized.includes('площад'))return'Площадь';if(normalized.includes('кластер'))return'Кластер';if(normalized.includes('критерий'))return'Критерии';if(normalized.includes('планиров'))return'Планировка';if(normalized.includes('интерес'))return'Интерес';if(normalized.includes('дату'))return'Дата замера';if(normalized.includes('замер'))return'Замер';return text}
function missingSummary(gate){const labels=[...new Set(gate.missing.map(missingLabel))],shown=labels.slice(0,3);return shown.map(esc).join(' · ')+(labels.length>shown.length?` · +${labels.length-shown.length}`:'')}
function estimateCard(project){
  const gate=service.readiness(project),ready=gate.ready,address=project.address||'Адрес не указан',progress=readinessProgress(project),percent=Math.round(progress.done/progress.total*100);
  return`<article class="stage-card ${ready?'ready':'not-ready'} ${String(project.id)===String(selected)?'selected':''}"><div class="stage-card-main"><div class="stage-card-heading"><h3>${esc(address)}</h3><span class="stage-object-status">${esc(shortStatus(project.phase0.status))}</span></div><p>${esc(project.clusterName||'Кластер не определён')} · ${project.area==null?'площадь не указана':`${Number(project.area).toLocaleString('ru-RU',{maximumFractionDigits:2})} м²`}</p><div class="stage-readiness"><div><span>Готовность к смете</span><strong>${progress.done} из ${progress.total}</strong></div><div class="stage-progress" role="progressbar" aria-label="Готовность к смете" aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${progress.done}" style="--stage-progress:${percent}%"><span aria-hidden="true"></span></div></div>${ready?'<div class="stage-ready-note">Объект готов к подготовке сметы</div>':`<div class="stage-blocked"><strong>Нужно заполнить</strong><p>${missingSummary(gate)}</p></div>`}</div><div class="stage-card-actions"><a href="${ready?link('source-specification.html',project.id):link('index.html',project.id)}" class="${ready?'primary':''}">${ready?'Открыть смету':'Продолжить отбор'}</a></div></article>`;
}
function repairCard(project){
  const address=project.address||'Адрес не указан',stage=Number(project.stage)>=5?'Ремонт':'Подготовка к ремонту';
  return`<article class="stage-card ready ${String(project.id)===String(selected)?'selected':''}"><div class="stage-card-main"><div class="stage-card-heading"><h3>${esc(address)}</h3><span class="stage-object-status">${esc(stage)}</span></div><p>${esc(project.clusterName||'Кластер не определён')} · один объект во всех рабочих разделах</p><div class="stage-ready-note">Объект находится на стадии ремонта</div></div><div class="stage-card-actions"><a class="primary" href="${link('passport.html',project.id)}">Открыть объект</a></div></article>`;
}
function render(){
  const query=S.norm(byId('stage-search').value),visible=projects.filter(project=>!query||S.norm([project.address,project.clusterName].join(' ')).includes(query));
  byId('stage-list-summary').textContent=`Показано ${visible.length} из ${projects.length}`;
  byId('stage-list').innerHTML=visible.length?visible.map(section==='repair'?repairCard:estimateCard).join(''):`<div class="stage-empty"><span class="stage-empty-icon" aria-hidden="true">○</span><strong>${projects.length?'Поиск не дал результатов':section==='repair'?'Пока нет объектов на ремонте':'Объектов пока нет'}</strong><p>${projects.length?'Измените поисковый запрос.':section==='repair'?'После перехода объекта на ремонт он появится здесь без создания копии.':'Добавьте помещение и пройдите условия отбора.'}</p>${section==='estimate'&&!projects.length?'<a class="stage-primary-link" href="index.html?create=1">＋ Добавить объект</a>':section==='repair'&&!projects.length?'<a class="stage-primary-link" href="workspace.html?section=estimate">Перейти к сметам</a>':''}</div>`;
}
function init(){
  const all=repo.listPhase0().map(project=>S.viewModel(project,competitive));projects=section==='repair'?all.filter(repairEligible):all;
  const ready=all.filter(project=>service.readiness(project).ready).length;
  if(section==='repair'){
    byId('stage-title').textContent='Ремонт';byId('stage-subtitle').textContent='Объекты, перешедшие к подготовке и выполнению ремонтных работ';byId('stage-list-title').textContent='Объекты на ремонте';
    byId('stage-summary').innerHTML=`<strong>${projects.length}</strong><span>${projects.length===1?'объект':'объектов'} на этом этапе</span>`;
  }else{
    byId('stage-title').textContent='Смета и КП';byId('stage-subtitle').textContent='Подготовка сметы и коммерческого предложения по выбранным объектам';byId('stage-list-title').textContent='Объекты для сметы';
    byId('stage-summary').innerHTML=`<strong>${ready}</strong><span>готовы к смете</span><i>·</i><strong>${Math.max(0,all.length-ready)}</strong><span>ещё проходят отбор</span>`;
  }
  byId('stage-search').addEventListener('input',render);render();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
window.addEventListener('slogi:locations-updated',()=>{const all=repo.listPhase0().map(project=>S.viewModel(project,competitive));projects=section==='repair'?all.filter(repairEligible):all;render()});
})();
