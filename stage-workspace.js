(function(){
'use strict';
const S=window.SlogiPhase0;if(!S)return;
const byId=id=>document.getElementById(id),esc=S.esc,section=new URLSearchParams(location.search).get('section')==='repair'?'repair':'estimate',selected=new URLSearchParams(location.search).get('location')||'';
const repo=S.projectRepository,service=S.phase0Service,competitive=S.competitiveRepository;
let projects=[];
function shortStatus(value){if(value===S.STATUS.WAITING)return'Ждём информацию';if(value===S.STATUS.ANALYSING)return'Анализируем';return value||'Не отвечает'}
function repairEligible(project){return Number(project.lifecyclePhase)>=2||Number(project.stage)>=4}
function link(file,id){return`${file}?location=${encodeURIComponent(id)}`}
function reasonList(gate){return gate.missing.slice(0,4).map(item=>`<li>${esc(item)}</li>`).join('')+(gate.missing.length>4?`<li>Ещё ${gate.missing.length-4}</li>`:'')}
function estimateCard(project){
  const gate=service.readiness(project),ready=gate.ready,address=project.address||'Адрес не указан';
  return`<article class="stage-card ${ready?'ready':'not-ready'} ${String(project.id)===String(selected)?'selected':''}"><div class="stage-card-main"><div class="stage-card-heading"><h3>${esc(address)}</h3><span class="stage-object-status">${esc(shortStatus(project.phase0.status))}</span></div><p>${esc(project.clusterName||'Кластер не определён')} · ${project.area==null?'площадь не указана':`${Number(project.area).toLocaleString('ru-RU',{maximumFractionDigits:2})} м²`}</p>${ready?'<div class="stage-ready-note">Объект готов к подготовке сметы</div>':`<div class="stage-blocked"><strong>Не готов к переходу</strong><ul>${reasonList(gate)}</ul></div>`}</div><div class="stage-card-actions"><a href="${ready?link('source-specification.html',project.id):link('index.html',project.id)}" class="${ready?'primary':''}">${ready?'Открыть смету':'Продолжить отбор'}</a></div></article>`;
}
function repairCard(project){
  const address=project.address||'Адрес не указан',stage=Number(project.stage)>=5?'Ремонт':'Подготовка к ремонту';
  return`<article class="stage-card ready ${String(project.id)===String(selected)?'selected':''}"><div class="stage-card-main"><div class="stage-card-heading"><h3>${esc(address)}</h3><span class="stage-object-status">${esc(stage)}</span></div><p>${esc(project.clusterName||'Кластер не определён')} · один объект во всех рабочих разделах</p><div class="stage-ready-note">Объект находится на стадии ремонта</div></div><div class="stage-card-actions"><a class="primary" href="${link('passport.html',project.id)}">Открыть объект</a></div></article>`;
}
function render(){
  const query=S.norm(byId('stage-search').value),visible=projects.filter(project=>!query||S.norm([project.address,project.clusterName].join(' ')).includes(query));
  byId('stage-list-summary').textContent=`Показано ${visible.length} из ${projects.length}`;
  byId('stage-list').innerHTML=visible.length?visible.map(section==='repair'?repairCard:estimateCard).join(''):`<div class="stage-empty"><strong>${projects.length?'Поиск не дал результатов':section==='repair'?'Объектов на стадии ремонта пока нет':'Объектов пока нет'}</strong><p>${projects.length?'Измените поисковый запрос.':section==='repair'?'После перехода объекта на ремонт он появится здесь без создания копии.':'Добавьте помещение и пройдите условия отбора.'}</p>${section==='estimate'&&!projects.length?'<a class="stage-primary-link" href="index.html?create=1">＋ Добавить объект</a>':''}</div>`;
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
