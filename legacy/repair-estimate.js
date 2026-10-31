(function repairEstimateModule(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SlogiRepairEstimate=api;
})(typeof window!=='undefined'?window:globalThis,function repairEstimateFactory(){
  'use strict';

  const SCHEMA_VERSION=1;
  const SUBSECTION_KINDS=Object.freeze(['furniture','equipment','finishing','work']);
  const SUBSECTION_LABELS=Object.freeze({
    furniture:'Мебель',
    equipment:'Оснащение',
    finishing:'Отделка',
    work:'Работа'
  });
  const SECTION_SCOPES=Object.freeze(['fixed','cabinet','restroom']);
  const DOCUMENT_KINDS=Object.freeze([
    'customOrders',
    'repairRoadmap',
    'purchaseSpecification',
    'paymentSchedule',
    'fullEstimate'
  ]);
  const DOCUMENT_TITLES=Object.freeze({
    customOrders:'Список заказных позиций',
    repairRoadmap:'ДК ремонта',
    purchaseSpecification:'Полная спецификация для закупок',
    paymentSchedule:'График и форма платежей',
    fullEstimate:'Полная смета ремонта'
  });
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const text=value=>String(value==null?'':value).trim();

  function number(value){
    if(value==null||text(value)==='')return null;
    const parsed=Number(String(value).replace(/\s+/g,'').replace(',','.'));
    return Number.isFinite(parsed)?parsed:null;
  }
  function nonNegative(value,fallback=0){
    const parsed=number(value);
    return parsed==null||parsed<0?fallback:Number(parsed.toFixed(2));
  }
  function count(value,fallback=0){
    const parsed=number(value);
    return parsed==null||parsed<0?fallback:Math.trunc(parsed);
  }
  function safeUrl(value){
    const raw=text(value);
    if(!raw)return'';
    try{
      const parsed=new URL(raw);
      return ['http:','https:'].includes(parsed.protocol)?parsed.toString():'';
    }catch(_error){return'';}
  }
  function nextId(items,prefix){
    const used=new Set((Array.isArray(items)?items:[]).map(item=>text(item&&item.id)));
    let index=1,id=`${prefix}-${index}`;
    while(used.has(id)){index+=1;id=`${prefix}-${index}`;}
    return id;
  }
  function persistentId(items,prefix){
    const used=new Set((Array.isArray(items)?items:[]).map(item=>text(item&&item.id)));
    const cryptoApi=typeof globalThis==='object'&&globalThis.crypto?globalThis.crypto:null;
    let id='';
    do{
      let token='';
      if(cryptoApi&&typeof cryptoApi.randomUUID==='function')token=cryptoApi.randomUUID();
      else if(cryptoApi&&typeof cryptoApi.getRandomValues==='function'){
        const values=new Uint32Array(4);cryptoApi.getRandomValues(values);
        token=Array.from(values,value=>value.toString(36)).join('-');
      }else token=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
      id=`${prefix}-${token}`;
    }while(used.has(id));
    return id;
  }
  function dateOnly(value){
    const raw=text(value);
    if(!raw)return'';
    if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
    const parsed=new Date(raw);
    return Number.isNaN(parsed.getTime())?'':parsed.toISOString().slice(0,10);
  }
  function addDays(value,days){
    const source=dateOnly(value);
    if(!source)return'';
    const parsed=new Date(`${source}T12:00:00.000Z`);
    parsed.setUTCDate(parsed.getUTCDate()+count(days));
    return parsed.toISOString().slice(0,10);
  }
  function daysBetween(start,end){
    const from=dateOnly(start),to=dateOnly(end);
    if(!from||!to)return 0;
    return Math.max(0,Math.round((new Date(`${to}T12:00:00.000Z`)-new Date(`${from}T12:00:00.000Z`))/86400000));
  }
  function atIso(date){return dateOnly(date)?`${dateOnly(date)}T09:00:00+03:00`:'';}

  function defaultSubsections(sectionId){
    return SUBSECTION_KINDS.map(kind=>({id:`${sectionId}-${kind}`,kind,name:SUBSECTION_LABELS[kind],items:[]}));
  }
  function defaultSettings(){
    const sections=[
      {id:'cabinet',name:'Кабинет {n}',scope:'cabinet'},
      {id:'restroom',name:'Санузел {n}',scope:'restroom'},
      {id:'reception',name:'Ресепшен',scope:'fixed'}
    ].map(section=>Object.assign({},section,{subsections:defaultSubsections(section.id)}));
    return{schemaVersion:SCHEMA_VERSION,sections,updatedAt:null,updatedById:null};
  }
  function subsectionKind(value){
    const raw=text(value).toLowerCase();
    if(SUBSECTION_KINDS.includes(raw))return raw;
    return SUBSECTION_KINDS.find(kind=>SUBSECTION_LABELS[kind].toLowerCase()===raw)||'';
  }
  function normalizeTemplateItem(source={},kind='',fallbackId='item-1'){
    const input=source&&typeof source==='object'?source:{};
    return Object.assign({},clone(input),{
      id:text(input.id)||fallbackId,
      name:text(input.name),
      price:nonNegative(input.price),
      link:safeUrl(input.link||input.url),
      quantity:nonNegative(input.quantity,1),
      unit:text(input.unit)||'шт.',
      customMade:kind==='furniture'&&Boolean(input.customMade!=null?input.customMade:input.madeToOrder)
    });
  }
  function normalizeSubsection(source={},sectionId='',fallbackKind=''){
    const input=source&&typeof source==='object'?source:{};
    const kind=subsectionKind(input.kind||input.name||fallbackKind);
    if(!kind)return null;
    const id=text(input.id)||`${sectionId}-${kind}`;
    const items=(Array.isArray(input.items)?input.items:[]).map((item,index)=>normalizeTemplateItem(item,kind,`${id}-item-${index+1}`));
    return Object.assign({},clone(input),{id,kind,name:text(input.name)||SUBSECTION_LABELS[kind],items});
  }
  function normalizeSection(source={},index=0){
    const input=source&&typeof source==='object'?source:{};
    const id=text(input.id)||`section-${index+1}`;
    const scope=SECTION_SCOPES.includes(text(input.scope))?text(input.scope):'fixed';
    const byKind=new Map();
    (Array.isArray(input.subsections)?input.subsections:[]).forEach(item=>{
      const subsection=normalizeSubsection(item,id);
      if(subsection)byKind.set(subsection.kind,subsection);
    });
    return Object.assign({},clone(input),{
      id,
      name:text(input.name)||'Новый раздел',
      scope,
      subsections:SUBSECTION_KINDS.flatMap(kind=>byKind.has(kind)?[byKind.get(kind)]:[])
    });
  }
  function normalizeSettings(source){
    if(source==null)return defaultSettings();
    const input=source&&typeof source==='object'?source:{};
    return Object.assign({},clone(input),{
      schemaVersion:SCHEMA_VERSION,
      sections:(Array.isArray(input.sections)?input.sections:[]).map(normalizeSection),
      updatedAt:text(input.updatedAt)||null,
      updatedById:text(input.updatedById)||null
    });
  }
  function settingsSignature(source){
    const settings=normalizeSettings(source);
    return JSON.stringify({schemaVersion:settings.schemaVersion,sections:settings.sections});
  }
  function stampSettings(settings,command,context){
    settings.updatedAt=text(context&&context.now)||new Date().toISOString();
    settings.updatedById=text(command&&command.actorId)||settings.updatedById||null;
    return settings;
  }
  function findSection(settings,sectionId){
    const section=settings.sections.find(item=>item.id===text(sectionId));
    if(!section)throw new Error('Раздел сметы не найден.');
    return section;
  }
  function findSubsection(section,subsectionIdOrKind){
    const requested=text(subsectionIdOrKind),kind=subsectionKind(requested);
    const subsection=section.subsections.find(item=>item.id===requested||(kind&&item.kind===kind));
    if(!subsection)throw new Error('Подраздел сметы не найден.');
    return subsection;
  }
  function addSection(source,command={},context={}){
    const settings=normalizeSettings(source),name=text(command.name);
    if(!name)throw new Error('Укажите название раздела.');
    const scope=SECTION_SCOPES.includes(text(command.scope))?text(command.scope):'fixed';
    const id=text(command.id)||persistentId(settings.sections,'section');
    if(settings.sections.some(item=>item.id===id))throw new Error('Раздел с таким идентификатором уже существует.');
    const subsections=Array.isArray(command.subsections)?command.subsections:defaultSubsections(id);
    settings.sections.push(normalizeSection({id,name,scope,subsections},settings.sections.length));
    return stampSettings(settings,command,context);
  }
  function updateSection(source,command={},context={}){
    const settings=normalizeSettings(source),section=findSection(settings,command.sectionId||command.id);
    if(Object.prototype.hasOwnProperty.call(command,'name')){
      const name=text(command.name);if(!name)throw new Error('Укажите название раздела.');section.name=name;
    }
    if(Object.prototype.hasOwnProperty.call(command,'scope')){
      const scope=text(command.scope);if(!SECTION_SCOPES.includes(scope))throw new Error('Неизвестный тип раздела.');section.scope=scope;
    }
    return stampSettings(settings,command,context);
  }
  function removeSection(source,command={},context={}){
    const settings=normalizeSettings(source),id=text(command.sectionId||command.id);
    if(!settings.sections.some(item=>item.id===id))throw new Error('Раздел сметы не найден.');
    settings.sections=settings.sections.filter(item=>item.id!==id);
    return stampSettings(settings,command,context);
  }
  function addSubsection(source,command={},context={}){
    const settings=normalizeSettings(source),section=findSection(settings,command.sectionId),kind=subsectionKind(command.kind||command.name);
    if(!kind)throw new Error('Выберите подраздел: мебель, оснащение, отделка или работа.');
    if(section.subsections.some(item=>item.kind===kind))throw new Error('Такой подраздел уже добавлен.');
    section.subsections.push(normalizeSubsection({id:text(command.id)||persistentId(section.subsections,`${section.id}-${kind}`),kind,name:text(command.name)||SUBSECTION_LABELS[kind],items:command.items},section.id,kind));
    section.subsections.sort((a,b)=>SUBSECTION_KINDS.indexOf(a.kind)-SUBSECTION_KINDS.indexOf(b.kind));
    return stampSettings(settings,command,context);
  }
  function removeSubsection(source,command={},context={}){
    const settings=normalizeSettings(source),section=findSection(settings,command.sectionId),subsection=findSubsection(section,command.subsectionId||command.kind);
    section.subsections=section.subsections.filter(item=>item.id!==subsection.id);
    return stampSettings(settings,command,context);
  }
  function addTemplateItem(source,command={},context={}){
    const settings=normalizeSettings(source),section=findSection(settings,command.sectionId),subsection=findSubsection(section,command.subsectionId||command.kind);
    const row=command.item&&typeof command.item==='object'?command.item:command;
    if(!text(row.name))throw new Error('Укажите название траты.');
    const id=text(row.id)||persistentId(subsection.items,`${subsection.id}-item`);
    if(subsection.items.some(item=>item.id===id))throw new Error('Строка с таким идентификатором уже существует.');
    subsection.items.push(normalizeTemplateItem(Object.assign({},row,{id}),subsection.kind,id));
    return stampSettings(settings,command,context);
  }
  function updateTemplateItem(source,command={},context={}){
    const settings=normalizeSettings(source),section=findSection(settings,command.sectionId),subsection=findSubsection(section,command.subsectionId||command.kind);
    const index=subsection.items.findIndex(item=>item.id===text(command.itemId||command.id));
    if(index<0)throw new Error('Строка сметы не найдена.');
    const patch=command.patch&&typeof command.patch==='object'?command.patch:command;
    const updated=normalizeTemplateItem(Object.assign({},subsection.items[index],clone(patch),{id:subsection.items[index].id}),subsection.kind,subsection.items[index].id);
    if(!updated.name)throw new Error('Укажите название траты.');
    subsection.items[index]=updated;
    return stampSettings(settings,command,context);
  }
  function removeTemplateItem(source,command={},context={}){
    const settings=normalizeSettings(source),section=findSection(settings,command.sectionId),subsection=findSubsection(section,command.subsectionId||command.kind),id=text(command.itemId||command.id);
    if(!subsection.items.some(item=>item.id===id))throw new Error('Строка сметы не найдена.');
    subsection.items=subsection.items.filter(item=>item.id!==id);
    return stampSettings(settings,command,context);
  }

  function workOf(project){
    const card=project&&project.phase0&&project.phase0.spaceCard||{};
    return card.work&&typeof card.work==='object'?card.work:{};
  }
  function metricsOf(project){
    const card=project&&project.phase0&&project.phase0.spaceCard||{},technical=card.technical&&typeof card.technical==='object'?card.technical:{};
    const area=number(card.area!=null?card.area:(project&&project.area));
    const ceilingHeight=number(card.ceilingHeight!=null?card.ceilingHeight:(technical.ceilingHeight!=null?technical.ceilingHeight:(project&&project.ceilingHeight)));
    return{area:area==null?null:nonNegative(area),ceilingHeight:ceilingHeight==null?null:nonNegative(ceilingHeight)};
  }
  function assertProject(project){
    const next=clone(project),card=next&&next.phase0&&next.phase0.spaceCard;
    if(!card)throw new Error('Карточка помещения не найдена.');
    card.work=Object.assign({},card.work||{});
    if(!card.work.approval||text(card.work.approval.status)!=='agreed')throw new Error('Сначала завершите согласование помещения.');
    if(!card.work.repair||typeof card.work.repair!=='object')throw new Error('Этап ремонта ещё не начат.');
    card.work.repair=Object.assign({},card.work.repair);
    if(!card.work.repair.stage)throw new Error('Этап ремонта ещё не начат.');
    return{next,card,work:card.work,repair:card.work.repair};
  }
  function assertDocumentsEditable(state){
    if(state.repair.documentPack&&text(state.repair.documentPack.status)==='agreed')throw new Error('Документы уже согласованы.');
    if(text(state.repair.stage)!=='documents')throw new Error('Подготовка документов для ремонта уже завершена.');
    return state;
  }
  function instanceName(section,index){
    if(section.scope==='fixed')return section.name;
    return section.name.includes('{n}')?section.name.replace(/\{n\}/g,String(index)):`${section.name} ${index}`;
  }
  function templateItemSnapshot(item){
    return{name:item.name,price:item.price,quantity:item.quantity,unit:item.unit,link:item.link,customMade:Boolean(item.customMade)};
  }
  function estimateSections(settings,cabinetsCount,restroomsCount){
    const result=[];
    settings.sections.forEach(section=>{
      const repetitions=section.scope==='cabinet'?cabinetsCount:(section.scope==='restroom'?restroomsCount:1);
      for(let index=1;index<=repetitions;index+=1){
        const instanceId=section.scope==='fixed'?section.id:`${section.id}-${index}`;
        result.push({
          id:instanceId,
          templateSectionId:section.id,
          scope:section.scope,
          index:section.scope==='fixed'?null:index,
          name:instanceName(section,index),
          subsections:section.subsections.map(subsection=>({
            id:`${instanceId}-${subsection.kind}`,
            templateSubsectionId:subsection.id,
            kind:subsection.kind,
            name:subsection.name,
            items:subsection.items.map((item,itemIndex)=>{
              const materialized=normalizeTemplateItem(Object.assign({},item,{
                id:`${instanceId}-${subsection.kind}-${item.id||itemIndex+1}`,
                templateItemId:item.id
              }),subsection.kind,`${instanceId}-${subsection.kind}-item-${itemIndex+1}`);
              materialized.templateSnapshot=templateItemSnapshot(materialized);
              return materialized;
            })
          }))
        });
      }
    });
    return result;
  }
  function normalizeEstimateItem(source={},kind='',fallbackId='item-1'){
    return normalizeTemplateItem(source,kind,fallbackId);
  }
  function normalizeEstimate(source={}){
    const input=source&&typeof source==='object'?source:{};
    const sections=(Array.isArray(input.sections)?input.sections:[]).map((section,sectionIndex)=>{
      const sectionId=text(section&&section.id)||`section-${sectionIndex+1}`;
      return Object.assign({},clone(section),{
        id:sectionId,
        name:text(section&&section.name)||'Раздел',
        scope:SECTION_SCOPES.includes(text(section&&section.scope))?text(section.scope):'fixed',
        subsections:(Array.isArray(section&&section.subsections)?section.subsections:[]).map((subsection,subsectionIndex)=>{
          const kind=subsectionKind(subsection&&subsection.kind||subsection&&subsection.name)||'equipment';
          const subsectionId=text(subsection&&subsection.id)||`${sectionId}-${kind}-${subsectionIndex+1}`;
          return Object.assign({},clone(subsection),{
            id:subsectionId,kind,name:text(subsection&&subsection.name)||SUBSECTION_LABELS[kind],
            items:(Array.isArray(subsection&&subsection.items)?subsection.items:[]).map((item,itemIndex)=>normalizeEstimateItem(item,kind,`${subsectionId}-item-${itemIndex+1}`))
          });
        })
      });
    });
    return Object.assign({},clone(input),{
      schemaVersion:SCHEMA_VERSION,
      status:['draft','agreed'].includes(text(input.status))?text(input.status):'draft',
      cabinetsCount:count(input.cabinetsCount),
      restroomsCount:count(input.restroomsCount),
      area:number(input.area),
      ceilingHeight:number(input.ceilingHeight),
      sections,
      generatedAt:text(input.generatedAt)||null,
      generatedById:text(input.generatedById)||null,
      updatedAt:text(input.updatedAt)||null,
      updatedById:text(input.updatedById)||null
    });
  }
  function estimateOf(project){
    const estimate=workOf(project).repair&&workOf(project).repair.estimate;
    return estimate&&typeof estimate==='object'?normalizeEstimate(estimate):null;
  }
  function calculateEstimate(source){
    const estimate=source&&source.phase0?estimateOf(source):normalizeEstimate(source||{});
    if(!estimate)return{total:0,sections:[],subsections:{}};
    const subsectionTotals=Object.fromEntries(SUBSECTION_KINDS.map(kind=>[kind,0]));
    let total=0;
    const sections=estimate.sections.map(section=>{
      let sectionTotal=0;
      const subsections=section.subsections.map(subsection=>{
        let subsectionTotal=0;
        const items=subsection.items.map(item=>{
          const amount=Number((nonNegative(item.price)*nonNegative(item.quantity,1)).toFixed(2));
          subsectionTotal+=amount;
          return Object.assign({},clone(item),{amount});
        });
        subsectionTotal=Number(subsectionTotal.toFixed(2));
        subsectionTotals[subsection.kind]=Number((subsectionTotals[subsection.kind]+subsectionTotal).toFixed(2));
        sectionTotal+=subsectionTotal;
        return Object.assign({},clone(subsection),{items,total:subsectionTotal});
      });
      sectionTotal=Number(sectionTotal.toFixed(2));total+=sectionTotal;
      return Object.assign({},clone(section),{subsections,total:sectionTotal});
    });
    return{total:Number(total.toFixed(2)),sections,subsections:subsectionTotals};
  }
  function markDocumentsOutdated(repair,at){
    if(repair.documentPack&&typeof repair.documentPack==='object'){
      repair.documentPack=Object.assign({},repair.documentPack,{status:'outdated',updatedAt:at});
    }
  }
  function generateEstimate(project,settingsSource,command={},context={}){
    const settings=normalizeSettings(settingsSource),state=assertDocumentsEditable(assertProject(project)),metrics=metricsOf(project),at=text(context.now)||new Date().toISOString();
    const cabinetsCount=count(command.cabinetsCount),restroomsCount=count(command.restroomsCount);
    state.repair.estimate=normalizeEstimate({
      status:'draft',cabinetsCount,restroomsCount,
      area:metrics.area,ceilingHeight:metrics.ceilingHeight,
      sections:estimateSections(settings,cabinetsCount,restroomsCount),
      templateSignature:settingsSignature(settings),templateUpdatedAt:settings.updatedAt,
      generatedAt:at,generatedById:text(command.actorId)||null,updatedAt:at,updatedById:text(command.actorId)||null
    });
    markDocumentsOutdated(state.repair,at);
    state.repair.updatedAt=at;
    return state.next;
  }
  function estimateLocation(project,command){
    const state=assertDocumentsEditable(assertProject(project)),estimate=normalizeEstimate(state.repair.estimate||{}),section=findSection(estimate,command.sectionId),subsection=findSubsection(section,command.subsectionId||command.kind);
    return Object.assign(state,{estimate,section,subsection});
  }
  function saveEstimateMutation(state,command,context){
    const at=text(context&&context.now)||new Date().toISOString();
    state.estimate.updatedAt=at;state.estimate.updatedById=text(command&&command.actorId)||state.estimate.updatedById||null;
    state.repair.estimate=normalizeEstimate(state.estimate);markDocumentsOutdated(state.repair,at);state.repair.updatedAt=at;
    return state.next;
  }
  function updateEstimate(project,command={},context={}){
    const state=assertDocumentsEditable(assertProject(project)),estimate=normalizeEstimate(state.repair.estimate||{});
    if(!estimate.generatedAt)throw new Error('Сначала сформируйте смету.');
    const patch=command.patch&&typeof command.patch==='object'?command.patch:command;
    if(Object.prototype.hasOwnProperty.call(patch,'cabinetsCount'))estimate.cabinetsCount=count(patch.cabinetsCount);
    if(Object.prototype.hasOwnProperty.call(patch,'restroomsCount'))estimate.restroomsCount=count(patch.restroomsCount);
    if(Object.prototype.hasOwnProperty.call(patch,'area'))estimate.area=number(patch.area);
    if(Object.prototype.hasOwnProperty.call(patch,'ceilingHeight'))estimate.ceilingHeight=number(patch.ceilingHeight);
    return saveEstimateMutation(Object.assign(state,{estimate}),command,context);
  }
  function addEstimateRow(project,command={},context={}){
    const state=estimateLocation(project,command),row=command.row&&typeof command.row==='object'?command.row:command;
    if(!text(row.name))throw new Error('Укажите название траты.');
    const id=text(row.id)||nextId(state.subsection.items,`${state.subsection.id}-item`);
    state.subsection.items.push(normalizeEstimateItem(Object.assign({},row,{id}),state.subsection.kind,id));
    return saveEstimateMutation(state,command,context);
  }
  function updateEstimateRow(project,command={},context={}){
    const state=estimateLocation(project,command),index=state.subsection.items.findIndex(item=>item.id===text(command.itemId||command.id));
    if(index<0)throw new Error('Строка сметы не найдена.');
    const patch=command.patch&&typeof command.patch==='object'?command.patch:command;
    const row=normalizeEstimateItem(Object.assign({},state.subsection.items[index],clone(patch),{id:state.subsection.items[index].id}),state.subsection.kind,state.subsection.items[index].id);
    if(!row.name)throw new Error('Укажите название траты.');
    state.subsection.items[index]=row;
    return saveEstimateMutation(state,command,context);
  }
  function removeEstimateRow(project,command={},context={}){
    const state=estimateLocation(project,command),id=text(command.itemId||command.id);
    const removed=state.subsection.items.find(item=>item.id===id);
    if(!removed)throw new Error('Строка сметы не найдена.');
    if(text(removed.templateItemId))state.subsection.removedTemplateItemIds=Array.from(new Set((Array.isArray(state.subsection.removedTemplateItemIds)?state.subsection.removedTemplateItemIds:[]).concat([text(removed.templateItemId)])));
    state.subsection.items=state.subsection.items.filter(item=>item.id!==id);
    return saveEstimateMutation(state,command,context);
  }
  function flatEstimateRows(estimate){
    return calculateEstimate(estimate).sections.flatMap(section=>section.subsections.flatMap(subsection=>subsection.items.map(item=>({
      id:item.id,sectionId:section.id,sectionName:section.name,subsectionId:subsection.id,subsectionKind:subsection.kind,subsectionName:subsection.name,
      sourceKey:documentSourceKey(section,subsection,item),
      name:item.name,price:item.price,quantity:item.quantity,unit:item.unit,amount:item.amount,link:item.link,customMade:Boolean(item.customMade)
    }))));
  }
  function keyPart(value){return encodeURIComponent(text(value));}
  function documentSourceKey(section={},subsection={},item={}){
    const templateSectionId=text(section.templateSectionId),templateSubsectionId=text(subsection.templateSubsectionId)||text(subsection.kind),templateItemId=text(item.templateItemId);
    if(templateSectionId&&templateSubsectionId&&templateItemId)return`template:${keyPart(templateSectionId)}:${keyPart(templateSubsectionId)}:${keyPart(templateItemId)}`;
    return`estimate:${keyPart(section.id)}:${keyPart(subsection.id)}:${keyPart(item.id)}`;
  }
  function stableRowId(sourceKey){
    const source=text(sourceKey);let hash=2166136261;
    for(let index=0;index<source.length;index+=1){hash^=source.charCodeAt(index);hash=Math.imul(hash,16777619);}
    return`spec-${(hash>>>0).toString(36)}`;
  }
  function aggregateRows(rows){
    const grouped=new Map();
    rows.forEach(row=>{
      const key=text(row.sourceKey)||documentSourceKey({id:row.sectionId},{id:row.subsectionId,kind:row.subsectionKind},{id:row.id});
      if(!grouped.has(key))grouped.set(key,Object.assign({},clone(row),{id:stableRowId(key),sourceKey:key,sections:[row.sectionName]}));
      else{
        const target=grouped.get(key);target.quantity=Number((nonNegative(target.quantity)+nonNegative(row.quantity)).toFixed(2));target.amount=Number((nonNegative(target.amount)+nonNegative(row.amount)).toFixed(2));
        if(!target.sections.includes(row.sectionName))target.sections.push(row.sectionName);
      }
    });
    return Array.from(grouped.values());
  }
  function customFurniture(source){
    const estimate=source&&source.phase0?estimateOf(source):normalizeEstimate(source||{});
    if(!estimate)return[];
    return aggregateRows(flatEstimateRows(estimate).filter(row=>row.subsectionKind==='furniture'&&row.customMade));
  }
  function deriveLeaseStartDate(project,command={}){
    const approval=workOf(project).approval||{},signedLease=approval.documents&&approval.documents.signedLease||{};
    return dateOnly(command.startDate||command.signedLeaseDate||approval.leaseStartDate||approval.signedLeaseDate||signedLease.signedAt||signedLease.leaseStartDate);
  }
  function defaultMilestones(startDate,durationDays){
    const duration=Math.max(1,count(durationDays,60));
    const offsets=[0,.1,.35,.65,.85,1].map(ratio=>Math.min(duration,Math.max(0,Math.round(duration*ratio))));
    for(let index=1;index<offsets.length;index+=1)offsets[index]=Math.max(offsets[index-1],offsets[index]);
    const names=['Начало ремонта','Подготовка и закупка','Черновые работы','Чистовая отделка','Монтаж мебели и оснащения','Приёмка помещения'];
    return names.map((name,index)=>({id:`milestone-${index+1}`,name,date:addDays(startDate,offsets[index]),offsetDays:offsets[index],status:'planned',controlPoint:true}));
  }
  function normalizeDocumentRow(source={},fallbackId='row-1'){
    const input=source&&typeof source==='object'?source:{};
    const row=Object.assign({},clone(input),{id:text(input.id)||fallbackId});
    if(Object.prototype.hasOwnProperty.call(row,'name'))row.name=text(row.name);
    if(Object.prototype.hasOwnProperty.call(row,'link'))row.link=safeUrl(row.link);
    if(Object.prototype.hasOwnProperty.call(row,'price'))row.price=nonNegative(row.price);
    if(Object.prototype.hasOwnProperty.call(row,'quantity'))row.quantity=nonNegative(row.quantity,1);
    if(Object.prototype.hasOwnProperty.call(row,'amount'))row.amount=nonNegative(row.amount);
    if(Object.prototype.hasOwnProperty.call(row,'percent'))row.percent=nonNegative(row.percent);
    if(Object.prototype.hasOwnProperty.call(row,'date'))row.date=dateOnly(row.date);
    if(Object.prototype.hasOwnProperty.call(row,'sourceKey'))row.sourceKey=text(row.sourceKey);
    return row;
  }
  function documentRowSnapshot(source={}){
    const row=normalizeDocumentRow(source);
    const snapshot={};
    ['name','price','quantity','unit','amount','link','customMade','sectionId','sectionName','subsectionId','subsectionKind','subsectionName','sections'].forEach(key=>{
      if(Object.prototype.hasOwnProperty.call(row,key))snapshot[key]=clone(row[key]);
    });
    return snapshot;
  }
  function stampGeneratedRows(rows){
    return(Array.isArray(rows)?rows:[]).map(row=>Object.assign({},row,{sourceSnapshot:documentRowSnapshot(row)}));
  }
  function normalizeGeneratedDocument(source={},kind=''){
    const input=source&&typeof source==='object'?source:{},resolvedKind=DOCUMENT_KINDS.includes(text(kind||input.kind))?text(kind||input.kind):'';
    if(!resolvedKind)return null;
    return Object.assign({},clone(input),{
      kind:resolvedKind,title:text(input.title)||DOCUMENT_TITLES[resolvedKind],
      rows:(Array.isArray(input.rows)?input.rows:[]).map((row,index)=>normalizeDocumentRow(row,`${resolvedKind}-row-${index+1}`)),
      meta:input.meta&&typeof input.meta==='object'?clone(input.meta):{},
      updatedAt:text(input.updatedAt)||null,updatedById:text(input.updatedById)||null
    });
  }
  function normalizeDocumentPack(source={}){
    const input=source&&typeof source==='object'?source:{},documents=input.documents&&typeof input.documents==='object'?input.documents:{};
    const normalized={};
    DOCUMENT_KINDS.forEach(kind=>{
      if(!Object.prototype.hasOwnProperty.call(documents,kind))return;
      const document=normalizeGeneratedDocument(documents[kind],kind);if(document)normalized[kind]=document;
    });
    return Object.assign({},clone(input),{
      schemaVersion:SCHEMA_VERSION,status:['draft','outdated','agreed'].includes(text(input.status))?text(input.status):'draft',
      startDate:dateOnly(input.startDate),documents:normalized,
      generatedAt:text(input.generatedAt)||null,generatedById:text(input.generatedById)||null,
      updatedAt:text(input.updatedAt)||null,updatedById:text(input.updatedById)||null
    });
  }
  function reconcileRoadmapPack(source,command={},context={}){
    const pack=normalizeDocumentPack(source||{}),roadmap=pack.documents.repairRoadmap;
    if(!roadmap)return pack;
    const startDate=dateOnly(pack.startDate),at=text(context.now)||new Date().toISOString(),actorId=text(command.actorId)||pack.updatedById||null;
    roadmap.rows=(Array.isArray(roadmap.rows)?roadmap.rows:[])
      .map((row,index)=>({row:normalizeDocumentRow(row,`repairRoadmap-row-${index+1}`),index}))
      .sort((left,right)=>{
        const leftDate=dateOnly(left.row.date),rightDate=dateOnly(right.row.date);
        if(leftDate&&rightDate&&leftDate!==rightDate)return leftDate.localeCompare(rightDate);
        if(leftDate&&!rightDate)return-1;
        if(!leftDate&&rightDate)return 1;
        return left.index-right.index;
      })
      .map(item=>{
        const row=item.row,rowDate=dateOnly(row.date);
        return Object.assign({},row,rowDate&&startDate?{offsetDays:daysBetween(startDate,rowDate)}:{});
      });
    const datedRows=roadmap.rows.filter(row=>dateOnly(row.date)),endDate=datedRows.length?dateOnly(datedRows[datedRows.length-1].date):startDate;
    roadmap.meta=Object.assign({},roadmap.meta,{
      startDate,
      endDate,
      durationDays:startDate&&endDate?Math.max(0,daysBetween(startDate,endDate)):0
    });
    pack.documents.repairRoadmap=normalizeGeneratedDocument(roadmap,'repairRoadmap');
    const payments=pack.documents.paymentSchedule;
    if(payments){
      const milestones=new Map(roadmap.rows.map(row=>[text(row.id),row]));
      payments.rows=(Array.isArray(payments.rows)?payments.rows:[]).map((sourceRow,index)=>{
        const row=normalizeDocumentRow(sourceRow,`paymentSchedule-row-${index+1}`),milestoneId=text(row.milestoneId),milestone=milestones.get(milestoneId);
        if(milestone)return normalizeDocumentRow(Object.assign({},row,{date:dateOnly(milestone.date)}),row.id);
        return milestoneId?normalizeDocumentRow(Object.assign({},row,{milestoneId:''}),row.id):row;
      });
      if(command.touchLinkedPayments){payments.updatedAt=at;payments.updatedById=actorId;}
      pack.documents.paymentSchedule=normalizeGeneratedDocument(payments,'paymentSchedule');
    }
    return normalizeDocumentPack(pack);
  }
  function documentsOf(project){
    const pack=workOf(project).repair&&workOf(project).repair.documentPack;
    return pack&&typeof pack==='object'?normalizeDocumentPack(pack):null;
  }
  function paymentTerms(command,milestones){
    const source=Array.isArray(command.paymentTerms)&&command.paymentTerms.length?command.paymentTerms:[
      {name:'Аванс',percent:30,milestoneId:'milestone-1'},
      {name:'После выполнения черновых работ',percent:40,milestoneId:'milestone-3'},
      {name:'После чистовой отделки',percent:20,milestoneId:'milestone-4'},
      {name:'После приёмки помещения',percent:10,milestoneId:'milestone-6'}
    ];
    const terms=source.map((item,index)=>({
      id:text(item.id)||`payment-${index+1}`,name:text(item.name)||`Платёж ${index+1}`,
      percent:nonNegative(item.percent),milestoneId:text(item.milestoneId),date:dateOnly(item.date),paymentForm:text(item.paymentForm||command.paymentForm)||'Безналичный расчёт',status:text(item.status)||'planned'
    }));
    const percentTotal=Number(terms.reduce((sum,item)=>sum+item.percent,0).toFixed(2));
    if(Math.abs(percentTotal-100)>.01)throw new Error('Сумма долей платежей должна составлять 100%.');
    return terms.map(item=>Object.assign({},item,{date:item.date||((milestones.find(milestone=>milestone.id===item.milestoneId)||{}).date||'')}));
  }
  function generateDocuments(project,command={},context={}){
    const state=assertDocumentsEditable(assertProject(project)),estimate=estimateOf(project);
    if(!estimate||!estimate.generatedAt)throw new Error('Сначала сформируйте смету ремонта.');
    const startDate=deriveLeaseStartDate(project,command);
    if(!startDate)throw new Error('Укажите дату подписания договора аренды.');
    const at=text(context.now)||new Date().toISOString(),actorId=text(command.actorId)||null,summary=calculateEstimate(estimate),rows=flatEstimateRows(estimate),specification=aggregateRows(rows),ordered=customFurniture(estimate);
    const milestones=Array.isArray(command.milestones)&&command.milestones.length?command.milestones.map((item,index)=>normalizeDocumentRow(Object.assign({id:`milestone-${index+1}`,status:'planned',controlPoint:true},item),`milestone-${index+1}`)):defaultMilestones(startDate,command.repairDurationDays);
    const terms=paymentTerms(command,milestones);let allocated=0;
    const payments=terms.map((term,index)=>{
      const amount=index===terms.length-1?Number((summary.total-allocated).toFixed(2)):Number((summary.total*term.percent/100).toFixed(2));allocated+=amount;
      return Object.assign({},term,{amount});
    });
    const commonMeta={area:estimate.area,ceilingHeight:estimate.ceilingHeight,cabinetsCount:estimate.cabinetsCount,restroomsCount:estimate.restroomsCount,total:summary.total};
    const documents={
      customOrders:{kind:'customOrders',title:DOCUMENT_TITLES.customOrders,rows:stampGeneratedRows(ordered),meta:Object.assign({},commonMeta,{total:Number(ordered.reduce((sum,item)=>sum+item.amount,0).toFixed(2))})},
      repairRoadmap:{kind:'repairRoadmap',title:DOCUMENT_TITLES.repairRoadmap,rows:milestones,meta:Object.assign({},commonMeta,{startDate,endDate:milestones.length?milestones[milestones.length-1].date:startDate,durationDays:count(command.repairDurationDays,60)})},
      purchaseSpecification:{kind:'purchaseSpecification',title:DOCUMENT_TITLES.purchaseSpecification,rows:stampGeneratedRows(specification),meta:commonMeta},
      paymentSchedule:{kind:'paymentSchedule',title:DOCUMENT_TITLES.paymentSchedule,rows:payments,meta:Object.assign({},commonMeta,{paymentForm:text(command.paymentForm)||'Безналичный расчёт'})},
      fullEstimate:{kind:'fullEstimate',title:DOCUMENT_TITLES.fullEstimate,rows:stampGeneratedRows(rows),meta:Object.assign({},commonMeta,{sectionTotals:summary.sections.map(section=>({id:section.id,name:section.name,total:section.total})),subsectionTotals:summary.subsections})}
    };
    DOCUMENT_KINDS.forEach(kind=>{documents[kind]=normalizeGeneratedDocument(Object.assign({},documents[kind],{updatedAt:at,updatedById:actorId}),kind);});
    state.repair.documentPack=reconcileRoadmapPack({status:'draft',startDate,documents,generatedAt:at,generatedById:actorId,updatedAt:at,updatedById:actorId},{actorId},{now:at});
    state.repair.updatedAt=at;
    return state.next;
  }
  function generateAll(project,settings,command={},context={}){
    return generateDocuments(generateEstimate(project,settings,command,context),command,context);
  }
  function documentState(project,command){
    const state=assertProject(project),pack=normalizeDocumentPack(state.repair.documentPack||{}),kind=text(command.kind),document=pack.documents[kind];
    if(!DOCUMENT_KINDS.includes(kind)||!document)throw new Error('Документ не найден.');
    if(pack.status==='agreed')throw new Error('Документы уже согласованы.');
    assertDocumentsEditable(state);
    return Object.assign(state,{pack,kind,document});
  }
  function saveDocumentMutation(state,command,context){
    const at=text(context&&context.now)||new Date().toISOString(),actorId=text(command&&command.actorId)||state.pack.updatedById||null;
    state.document.updatedAt=at;state.document.updatedById=actorId;state.pack.documents[state.kind]=normalizeGeneratedDocument(state.document,state.kind);
    state.pack.status='draft';state.pack.updatedAt=at;state.pack.updatedById=actorId;state.repair.documentPack=normalizeDocumentPack(state.pack);state.repair.updatedAt=at;
    return state.next;
  }
  function updateDocument(project,command={},context={}){
    const state=documentState(project,command),patch=command.patch&&typeof command.patch==='object'?clone(command.patch):{};
    delete patch.kind;delete patch.rows;
    state.document=Object.assign({},state.document,patch,{kind:state.kind});
    return saveDocumentMutation(state,command,context);
  }
  function addDocumentRow(project,command={},context={}){
    const state=documentState(project,command),row=command.row&&typeof command.row==='object'?command.row:command,id=text(row.id)||nextId(state.document.rows,`${state.kind}-row`);
    state.document.rows.push(normalizeDocumentRow(Object.assign({},row,{id}),id));
    if(state.kind==='repairRoadmap'){
      state.pack.documents.repairRoadmap=state.document;
      state.pack=reconcileRoadmapPack(state.pack,Object.assign({},command,{touchLinkedPayments:true}),context);
      state.document=state.pack.documents.repairRoadmap;
    }
    return saveDocumentMutation(state,command,context);
  }
  function updateDocumentRow(project,command={},context={}){
    const state=documentState(project,command),index=state.document.rows.findIndex(row=>row.id===text(command.rowId||command.id));
    if(index<0)throw new Error('Строка документа не найдена.');
    const patch=command.patch&&typeof command.patch==='object'?command.patch:command;
    const currentRow=state.document.rows[index],nextPatch=clone(patch);
    if(state.kind==='repairRoadmap'&&Object.prototype.hasOwnProperty.call(nextPatch,'offsetDays')&&!Object.prototype.hasOwnProperty.call(nextPatch,'date'))nextPatch.date=addDays(state.pack.startDate,nextPatch.offsetDays);
    if(state.kind==='repairRoadmap'&&Object.prototype.hasOwnProperty.call(nextPatch,'date')&&!Object.prototype.hasOwnProperty.call(nextPatch,'offsetDays'))nextPatch.offsetDays=daysBetween(state.pack.startDate,nextPatch.date);
    state.document.rows[index]=normalizeDocumentRow(Object.assign({},currentRow,nextPatch,{id:currentRow.id}),currentRow.id);
    if(currentRow.sourceSnapshot&&typeof currentRow.sourceSnapshot==='object'){
      const ignored=new Set(['id','kind','actorId','rowId','sourceSnapshot','manualOverrides']);
      const overrides=new Set(Array.isArray(currentRow.manualOverrides)?currentRow.manualOverrides:[]);
      Object.keys(nextPatch).filter(key=>!ignored.has(key)).forEach(key=>overrides.add(key));
      state.document.rows[index].manualOverrides=Array.from(overrides);
    }
    if(['customOrders','purchaseSpecification','fullEstimate'].includes(state.kind)&&(Object.prototype.hasOwnProperty.call(nextPatch,'price')||Object.prototype.hasOwnProperty.call(nextPatch,'quantity'))&&!Object.prototype.hasOwnProperty.call(nextPatch,'amount'))state.document.rows[index].amount=Number((nonNegative(state.document.rows[index].price)*nonNegative(state.document.rows[index].quantity,1)).toFixed(2));
    if(state.kind==='paymentSchedule'&&Object.prototype.hasOwnProperty.call(nextPatch,'paymentForm'))state.document.meta=Object.assign({},state.document.meta,{paymentForm:text(nextPatch.paymentForm)});
    if(state.kind==='paymentSchedule'&&Object.prototype.hasOwnProperty.call(nextPatch,'date')&&!Object.prototype.hasOwnProperty.call(nextPatch,'milestoneId')&&text(currentRow.milestoneId)){
      state.document.rows[index].milestoneId='';
    }
    if(state.kind==='repairRoadmap'){
      state.pack.documents.repairRoadmap=state.document;
      state.pack=reconcileRoadmapPack(state.pack,Object.assign({},command,{touchLinkedPayments:true}),context);
      state.document=state.pack.documents.repairRoadmap;
    }
    return saveDocumentMutation(state,command,context);
  }
  function removeDocumentRow(project,command={},context={}){
    const state=documentState(project,command),id=text(command.rowId||command.id);
    const removed=state.document.rows.find(row=>row.id===id);
    if(!removed)throw new Error('Строка документа не найдена.');
    if(removed.sourceSnapshot&&typeof removed.sourceSnapshot==='object'){
      const meta=state.document.meta&&typeof state.document.meta==='object'?state.document.meta:{};
      const patch={removedGeneratedRowIds:Array.from(new Set((Array.isArray(meta.removedGeneratedRowIds)?meta.removedGeneratedRowIds:[]).concat([id])))};
      if(text(removed.sourceKey))patch.removedGeneratedRowKeys=Array.from(new Set((Array.isArray(meta.removedGeneratedRowKeys)?meta.removedGeneratedRowKeys:[]).concat([text(removed.sourceKey)])));
      state.document.meta=Object.assign({},meta,patch);
    }
    state.document.rows=state.document.rows.filter(row=>row.id!==id);
    if(state.kind==='repairRoadmap'){
      state.pack.documents.repairRoadmap=state.document;
      state.pack=reconcileRoadmapPack(state.pack,Object.assign({},command,{touchLinkedPayments:true}),context);
      state.document=state.pack.documents.repairRoadmap;
    }
    return saveDocumentMutation(state,command,context);
  }
  function canAgreeDocuments(project){
    const work=workOf(project),pack=documentsOf(project),repair=work.repair||{};
    if(text(work.approval&&work.approval.status)!=='agreed'||!pack||pack.status!=='draft'||repair.stage!=='documents'||!DOCUMENT_KINDS.every(kind=>pack.documents[kind]))return false;
    const fullEstimate=pack.documents.fullEstimate,purchaseSpecification=pack.documents.purchaseSpecification;
    if(!(fullEstimate.rows||[]).length||!(purchaseSpecification.rows||[]).length||nonNegative(fullEstimate.meta&&fullEstimate.meta.total)<=0)return false;
    const roadmap=pack.documents.repairRoadmap.rows||[],payments=pack.documents.paymentSchedule.rows||[];
    if(!roadmap.length||roadmap.some(row=>!text(row.name)||!dateOnly(row.date))||dateOnly(roadmap[0].date)!==dateOnly(pack.startDate))return false;
    const roadmapDates=roadmap.map(row=>dateOnly(row.date));
    if(roadmapDates.some((date,index)=>index>0&&date<roadmapDates[index-1]))return false;
    const roadmapMeta=pack.documents.repairRoadmap.meta||{},expectedDuration=Math.max(0,daysBetween(pack.startDate,roadmapDates[roadmapDates.length-1]));
    if(dateOnly(roadmapMeta.startDate)!==dateOnly(pack.startDate)||dateOnly(roadmapMeta.endDate)!==roadmapDates[roadmapDates.length-1]||count(roadmapMeta.durationDays)!==expectedDuration)return false;
    if(!payments.length||payments.some(row=>!text(row.name)||!dateOnly(row.date)))return false;
    const milestones=new Map(roadmap.map(row=>[text(row.id),row]));
    if(payments.some(row=>text(row.milestoneId)&&(!milestones.has(text(row.milestoneId))||dateOnly(row.date)!==dateOnly(milestones.get(text(row.milestoneId)).date))))return false;
    const percentTotal=Number(payments.reduce((sum,row)=>sum+nonNegative(row.percent),0).toFixed(2));
    const paymentTotal=Number(payments.reduce((sum,row)=>sum+nonNegative(row.amount),0).toFixed(2));
    const estimateTotal=Number(nonNegative(pack.documents.fullEstimate.meta&&pack.documents.fullEstimate.meta.total).toFixed(2));
    return Math.abs(percentTotal-100)<=.01&&Math.abs(paymentTotal-estimateTotal)<=.01;
  }
  function agreeDocuments(project,command={},context={}){
    if(!canAgreeDocuments(project))throw new Error('Сформируйте актуальный комплект документов для ремонта.');
    const state=assertProject(project),pack=normalizeDocumentPack(state.repair.documentPack),at=text(context.now)||new Date().toISOString(),actorId=text(command.actorId)||null;
    pack.status='agreed';pack.agreedAt=at;pack.agreedById=actorId;pack.updatedAt=at;pack.updatedById=actorId;
    const roadmap=pack.documents.repairRoadmap.rows;
    state.repair.documentPack=pack;
    state.repair.estimate=Object.assign({},normalizeEstimate(state.repair.estimate),{status:'agreed',updatedAt:at,updatedById:actorId});
    state.repair.stage='repair';state.repair.documentsAgreedAt=at;state.repair.documentsAgreedById=actorId;state.repair.updatedAt=at;
    state.repair.transitions=(Array.isArray(state.repair.transitions)?state.repair.transitions:[]).concat([{from:'documents',to:'repair',at,actorId,reason:'documents_agreed'}]);
    const address=text(state.next&&state.next.address)||text(state.card.address)||'Помещение';
    state.repair.calendarEvents=roadmap.filter(row=>row.controlPoint!==false&&dateOnly(row.date)).map((row,index)=>({
      id:`repair-control-${text(state.next&&state.next.id)||text(state.card.id)||'project'}-${row.id||index+1}`,
      projectId:text(state.next&&state.next.id)||text(state.card.id),source:'repair-control-point',type:'Контроль ремонта',
      title:text(row.name)||`Контрольная точка ${index+1}`,description:address,date:dateOnly(row.date),at:atIso(row.date),startsAt:atIso(row.date),
      responsible:text(command.responsible)||'Ответственный по ремонту',reminderMinutesBefore:count(command.reminderMinutesBefore,1440),status:'planned'
    }));
    state.work.status='closed';state.work.stage='repair';state.work.pipeline=Object.assign({},state.work.pipeline||{},{status:'repair_process',updatedAt:at,repairDocumentsAgreedAt:at,repairDocumentsAgreedById:actorId});
    return state.next;
  }

  return Object.freeze({
    SCHEMA_VERSION,SUBSECTION_KINDS,SUBSECTION_LABELS,SECTION_SCOPES,DOCUMENT_KINDS,DOCUMENT_TITLES,
    defaultSettings,normalizeSettings,settingsSignature,normalizeSection,normalizeSubsection,normalizeTemplateItem,
    addSection,updateSection,removeSection,addSubsection,removeSubsection,addTemplateItem,updateTemplateItem,removeTemplateItem,
    normalizeEstimate,estimateOf,generateEstimate,generateAll,updateEstimate,addEstimateRow,updateEstimateRow,removeEstimateRow,calculateEstimate,customFurniture,
    deriveLeaseStartDate,normalizeGeneratedDocument,normalizeDocumentPack,documentsOf,generateDocuments,updateDocument,addDocumentRow,updateDocumentRow,removeDocumentRow,
    canAgreeDocuments,agreeDocuments
  });
});
