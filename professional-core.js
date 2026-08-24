(function(){
'use strict';
const KEY='slogi_professional_state_v2',LOCATIONS_KEY='slogi_locations_v1',VERSION=3;
const now=()=>new Date().toISOString();
const uid=(p='id')=>p+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
const clone=v=>JSON.parse(JSON.stringify(v));
const parse=(v,f)=>{try{return JSON.parse(v)}catch(_){return f}};
function emit(name,detail){try{window.dispatchEvent(new CustomEvent(name,{detail}))}catch(_){}}
function readLocations(){const d=parse(localStorage.getItem(LOCATIONS_KEY)||'[]',[]);return Array.isArray(d)?d:[]}
function writeLocations(items,reason){const value=Array.isArray(items)?items:[];localStorage.setItem(LOCATIONS_KEY,JSON.stringify(value));emit('slogi:locations-updated',{locations:clone(value),reason:reason||'update'});return value}
const defaults=()=>({version:VERSION,organization:{name:'СЛОГИ',workspace:'Управление объектами',currency:'RUB',timezone:'Europe/Moscow'},members:[
{id:'member-maria',name:'Мария Козлова',position:'Руководитель проекта',role:'Администратор',email:'',status:'active'},
{id:'member-estimator',name:'Сметчик',position:'Сметное сопровождение',role:'Сметчик',email:'',status:'active'},
{id:'member-designer',name:'Дизайнер / замерщик',position:'Проектирование и замеры',role:'Проектировщик',email:'',status:'active'},
{id:'member-finance',name:'Финансовый специалист',position:'Оплаты и документы',role:'Финансы',email:'',status:'active'}],
tasks:[],payments:[],approvals:[],documentVersions:[],estimateVersions:[],priceCatalog:[],templates:[
{id:'tpl-standard',type:'Проект',name:'Стандартный объект',description:'6 понятных этапов: от первичной оценки до передачи объекта в эксплуатацию',status:'Активен',createdAt:now()},
{id:'tpl-fast',type:'Проект',name:'Быстрый ремонт',description:'Сокращённый маршрут и контрольные точки',status:'Активен',createdAt:now()},
{id:'tpl-proposal',type:'КП',name:'Корпоративное коммерческое предложение',description:'Основной шаблон КП СЛОГИ',status:'Активен',createdAt:now()}],
contracts:[],contractors:[],comparisons:[],activity:[],notifications:[],risks:[],comments:[],savedListings:[],
settings:{statuses:['Новый','В работе','Ожидает информации','На согласовании','Требует решения','Приостановлен','Просрочен','Завершён','Отказ','Архив'],notifications:{deadlines:true,approvals:true,payments:true,budget:true,staleProjects:true},staleDays:7,defaultReserve:10,twoFactor:false,requireChangeReason:true},trash:{projects:[]},updatedAt:now()});
function normalize(s){const b=defaults(),o=Object.assign({},b,s&&typeof s==='object'?s:{});['members','tasks','payments','approvals','documentVersions','estimateVersions','priceCatalog','templates','contracts','contractors','comparisons','activity','notifications','risks','comments','savedListings'].forEach(k=>{if(!Array.isArray(o[k]))o[k]=[]});o.settings=Object.assign({},b.settings,o.settings||{});o.settings.notifications=Object.assign({},b.settings.notifications,(o.settings||{}).notifications||{});o.organization=Object.assign({},b.organization,o.organization||{});o.trash=Object.assign({projects:[]},o.trash||{});if(!Array.isArray(o.trash.projects))o.trash.projects=[];o.version=VERSION;return o}
function read(){return normalize(parse(localStorage.getItem(KEY)||'null',null)||defaults())}
function write(s,reason){const n=normalize(s);n.updatedAt=now();localStorage.setItem(KEY,JSON.stringify(n));emit('slogi:professional-state',{state:clone(n),reason:reason||'update'});return n}
function actor(){const u=window.SlogiCloud&&window.SlogiCloud.user;return{id:u&&u.id||'shared-workspace-member',name:'Специалист'}}
function projectName(id){const p=readLocations().find(x=>String(x.id)===String(id));return p?p.address:'Объект'}
function activity(projectId,type,text,meta){const s=read(),a=actor();s.activity.unshift({id:uid('act'),projectId:projectId||'',type:type||'update',text:String(text||''),actorId:a.id,actorName:a.name,createdAt:now(),meta:meta||{}});s.activity=s.activity.slice(0,500);write(s,'activity')}
/* Импортирует только реальные данные старого паспорта. Демонстрационные задачи и риски не создаются. */
function enrichProjectState(s,p){if(!p||!p.id)return false;let changed=false;const projectId=String(p.id);
  if(!s.payments.some(x=>String(x.projectId)===projectId)&&Array.isArray(p.paymentSchedule)&&p.paymentSchedule.length){p.paymentSchedule.forEach(row=>s.payments.push({id:uid('pay'),projectId:p.id,category:'Работы',title:row.name||'Платёж по объекту',amount:Number(row.planned)||0,plannedDate:row.planDate||'',status:Number(row.actual)>0?'Оплачен':'Запланирован',paidDate:row.actualDate||'',actualAmount:Number(row.actual)||0,createdAt:now(),updatedAt:now()}));changed=true}
  if(!s.documentVersions.some(x=>String(x.projectId)===projectId)){const imported=[['План',p.planName],['Спецификация',p.specName],['Смета',p.estimateName],['КП',p.proposalName]].filter(x=>x[1]);imported.forEach(([type,name])=>s.documentVersions.push({id:uid('doc'),projectId:p.id,type,name,version:'v1',status:'Актуальный',authorId:'member-maria',createdAt:p.updatedAt||now(),comment:'Импортировано из паспорта объекта'}));if(imported.length)changed=true}
  return changed
}
function ensureProject(p){const s=read();if(enrichProjectState(s,p))write(s,'project-data-import')}
function ensureAllProjects(){const s=read();let changed=false;for(const p of readLocations().filter(x=>x&&x.id&&!x.deletedAt))changed=enrichProjectState(s,p)||changed;if(changed)write(s,'projects-data-import')}
function getProjectMeta(id){const s=read(),p=readLocations().find(x=>String(x.id)===String(id))||{},docs=s.documentVersions.filter(x=>String(x.projectId)===String(id)),present=new Set(docs.map(x=>x.type));if(p.planName)present.add('План');if(p.specName)present.add('Спецификация');if(p.estimateName)present.add('Смета');if(p.proposalName)present.add('КП');return{project:p,status:p.status||p.projectStatus||'Новый',managerId:p.managerId||'member-maria',tasks:s.tasks.filter(x=>String(x.projectId)===String(id)),docs,completeness:Math.round(['План','Спецификация','Смета','КП'].filter(x=>present.has(x)).length/4*100)}}
function upsert(collection,item,reason){const s=read(),list=s[collection];if(!Array.isArray(list))throw new Error('Unknown collection');const n=Object.assign({},item);if(!n.id)n.id=uid(collection.slice(0,4));if(!n.createdAt)n.createdAt=now();n.updatedAt=now();const i=list.findIndex(x=>x.id===n.id);if(i>=0)list[i]=Object.assign({},list[i],n);else list.unshift(n);write(s,reason||collection+'-upsert');return clone(n)}
function remove(collection,id){const s=read();s[collection]=(s[collection]||[]).filter(x=>x.id!==id);write(s,collection+'-remove')}
function updateProject(id,patch,reason){const l=readLocations(),i=l.findIndex(x=>String(x.id)===String(id));if(i<0)return null;const before=l[i],next=Object.assign({},before,patch,{updatedAt:now()});l[i]=next;writeLocations(l,'project-update');const changed=Object.keys(patch).filter(k=>before[k]!==patch[k]);if(changed.length)activity(id,'project',reason||('Изменены параметры объекта: '+changed.join(', ')),{changes:changed});return next}
function softDeleteProject(p){if(!p||!p.id)return;const s=read();if(!s.trash.projects.some(x=>String(x.id)===String(p.id)))s.trash.projects.unshift(Object.assign({},p,{deletedAt:now()}));write(s,'project-soft-delete');activity(p.id,'delete','Объект перемещён в корзину')}
function restoreProject(id){const s=read(),p=s.trash.projects.find(x=>String(x.id)===String(id));if(!p)return false;const copy=Object.assign({},p);delete copy.deletedAt;copy.updatedAt=now();const l=readLocations();if(!l.some(x=>String(x.id)===String(copy.id)))l.unshift(copy);writeLocations(l,'project-restore');s.trash.projects=s.trash.projects.filter(x=>String(x.id)!==String(id));write(s,'project-restore');activity(id,'restore','Объект восстановлен из корзины');return true}
function purgeProjects(ids){
  const requested=new Set((Array.isArray(ids)?ids:[ids]).map(id=>String(id||'')).filter(Boolean));
  if(!requested.size)return 0;
  const s=read(),trashIds=new Set(s.trash.projects.map(x=>String(x&&x.id||'')).filter(Boolean));
  const allowed=new Set([...requested].filter(id=>trashIds.has(id)));
  if(!allowed.size)return 0;
  const locations=readLocations(),remaining=locations.filter(x=>!allowed.has(String(x&&x.id||'')));
  s.trash.projects=s.trash.projects.filter(x=>!allowed.has(String(x&&x.id||'')));
  write(s,'project-purge');
  if(remaining.length!==locations.length)writeLocations(remaining,'project-purge');
  return allowed.size;
}
function purgeProject(id){return purgeProjects([id])===1}
function purgeAllProjects(){return purgeProjects(read().trash.projects.map(x=>x&&x.id))}
function notify(title,text,link,level){const s=read();s.notifications.unshift({id:uid('note'),title,text,link:link||'',level:level||'info',read:false,createdAt:now()});s.notifications=s.notifications.slice(0,100);write(s,'notification')}
const formatMoney=v=>Math.round(Number(v)||0).toLocaleString('ru-RU')+' ₽';
function formatDate(v,withTime){if(!v)return'—';const d=new Date(v);if(Number.isNaN(d.getTime()))return'—';return d.toLocaleDateString('ru-RU',withTime?{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}:{day:'2-digit',month:'2-digit',year:'numeric'})}
function statusClass(v){const s=String(v||'').toLowerCase();if(/заверш|согласован|оплачен|утвержд|актив/.test(s))return'good';if(/просроч|отклон|риск|критич/.test(s))return'bad';if(/работ|согласовани|провер|ожида/.test(s))return'warn';return'neutral'}
function currentRole(){const u=window.SlogiCloud&&window.SlogiCloud.user,m=u&&u.user_metadata||{},explicit=String(m.role||m.access_level||'').trim();if(explicit)return explicit;const email=String(u&&u.email||'').toLowerCase(),member=read().members.find(x=>email&&String(x.email||'').toLowerCase()===email);return member&&member.role||'Администратор'}
function can(area,action){const role=currentRole(),admin=role==='Администратор',pm=role==='Руководитель проекта';if(admin)return true;if(action==='write'&&['Наблюдатель','Внешний пользователь'].includes(role))return false;if(['team.html','settings.html'].includes(area))return false;if(area==='finance.html')return pm||role==='Финансы';if(area==='contractors.html')return pm||['Финансы','Сметчик'].includes(role);if(area==='catalog.html')return pm||['Финансы','Сметчик','Проектировщик'].includes(role);if(area==='analytics.html')return role!=='Внешний пользователь';if(area==='approvals.html')return role!=='Внешний пользователь'||action!=='write';return true}
function exportData(){return{professional:read(),locations:readLocations()}}
function importData(payload){if(payload&&Array.isArray(payload.locations))writeLocations(payload.locations,'import');if(payload&&payload.professional)write(payload.professional,'import');return true}
window.SlogiPro={KEY,read,write,readLocations,writeLocations,ensureProject,ensureAllProjects,getProjectMeta,upsert,remove,updateProject,softDeleteProject,restoreProject,purgeProject,purgeAllProjects,activity,notify,projectName,actor,currentRole,can,uid,now,formatMoney,formatDate,statusClass,exportData,importData};
})();
