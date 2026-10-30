(function repairStageModule(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SlogiRepairStage=api;
})(typeof window!=='undefined'?window:globalThis,function repairStageFactory(){
  'use strict';

  const STAGES=Object.freeze(['documents','repair','handover','completed']);
  const DOCUMENT_KINDS=Object.freeze(['technicalTask','estimate','schedule']);
  const PIPELINE_ALIASES=Object.freeze([
    'repair',
    'repair_documents',
    'repair_process',
    'repair_in_progress',
    'repair_handover',
    'handover',
    'repair_completed'
  ]);
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const text=value=>String(value==null?'':value).trim();

  function normalizeDocument(source={},forcedKind=''){
    const input=source&&typeof source==='object'?source:{};
    const kind=text(forcedKind)||text(input.kind);
    if(!DOCUMENT_KINDS.includes(kind))return null;
    const name=text(input.name||input.fileName),attachmentType=text(input.attachmentType||input.type);
    return Object.assign({},clone(input),{
      kind,
      name,
      attachmentType,
      mimeType:text(input.mimeType||input.mime),
      size:Number.isFinite(Number(input.size))?Number(input.size):null,
      status:text(input.status)||(name&&attachmentType?'ready':''),
      uploadedAt:text(input.uploadedAt)||null,
      uploadedById:text(input.uploadedById)||null
    });
  }
  function normalizeDocuments(source){
    const byKind=new Map();
    (Array.isArray(source)?source:[]).forEach(item=>{
      const document=normalizeDocument(item);
      if(document)byKind.set(document.kind,document);
    });
    return DOCUMENT_KINDS.flatMap(kind=>byKind.has(kind)?[byKind.get(kind)]:[]);
  }

  function workOf(project){
    const card=project&&project.phase0&&project.phase0.spaceCard||{};
    return card.work&&typeof card.work==='object'?card.work:{};
  }
  function inferredStage(work){
    const pipeline=text(work&&work.pipeline&&work.pipeline.status||work&&work.pipelineStatus);
    if(pipeline==='repair_completed')return'completed';
    if(pipeline==='repair_handover'||pipeline==='handover')return'handover';
    if(pipeline==='repair_process'||pipeline==='repair_in_progress')return'repair';
    if(pipeline==='repair'||pipeline==='repair_documents')return'documents';
    return text(work&&work.approval&&work.approval.status)==='agreed'?'documents':'';
  }
  function normalize(source={},fallbackStage=''){
    const input=source&&typeof source==='object'?source:{};
    const stage=STAGES.includes(text(input.stage))?text(input.stage):(STAGES.includes(text(fallbackStage))?text(fallbackStage):'');
    return Object.assign({},clone(input),{
      schemaVersion:1,
      stage,
      documents:normalizeDocuments(input.documents),
      enteredAt:text(input.enteredAt)||null,
      enteredById:text(input.enteredById)||null,
      updatedAt:text(input.updatedAt)||null,
      transitions:Array.isArray(input.transitions)?clone(input.transitions):[]
    });
  }
  function repairOf(project){
    const work=workOf(project);
    return normalize(work.repair,inferredStage(work));
  }
  function documentOf(project,kind){
    const requested=text(kind);
    return repairOf(project).documents.find(document=>document.kind===requested)||null;
  }
  function hasRepair(project){return Boolean(repairOf(project).stage);}
  function stageOf(project){return repairOf(project).stage;}
  function isRepairProject(project){
    if(!project||project.deletedAt)return false;
    const stage=stageOf(project);
    return Boolean(stage&&stage!=='completed');
  }
  function canOpenStage(project,stage){
    const current=stageOf(project),requested=text(stage);
    if(!STAGES.includes(requested)||!current)return false;
    if(requested==='documents')return true;
    if(requested==='repair')return ['repair','handover','completed'].includes(current);
    if(requested==='handover')return ['handover','completed'].includes(current);
    return current==='completed';
  }
  function startDocuments(project,command={},context={}){
    const next=clone(project),card=next&&next.phase0&&next.phase0.spaceCard;
    if(!card)throw new Error('Карточка помещения не найдена.');
    card.work=Object.assign({},card.work||{});
    if(text(card.work.approval&&card.work.approval.status)!=='agreed')throw new Error('Сначала согласуйте помещение.');
    const at=text(context.now)||new Date().toISOString(),current=normalize(card.work.repair,inferredStage(card.work)||'documents');
    card.work.repair=normalize(Object.assign({},current,{
      stage:current.stage||'documents',
      enteredAt:current.enteredAt||at,
      enteredById:current.enteredById||text(command.actorId),
      updatedAt:at
    }),'documents');
    card.work.status='closed';
    card.work.stage='repair';
    card.work.pipeline=Object.assign({},card.work.pipeline||{},{status:'repair',updatedAt:at});
    return next;
  }
  function attachDocument(project,command={},context={}){
    const kind=text(command.kind);
    if(!DOCUMENT_KINDS.includes(kind))throw new Error('Неизвестный тип документа.');
    const name=text(command.name),attachmentType=text(command.attachmentType);
    if(!name||!attachmentType)throw new Error('Укажите файл документа.');
    const next=clone(project),card=next&&next.phase0&&next.phase0.spaceCard;
    if(!card)throw new Error('Карточка помещения не найдена.');
    card.work=Object.assign({},card.work||{});
    const current=normalize(card.work.repair,inferredStage(card.work));
    if(!current.stage)throw new Error('Этап ремонта ещё не начат.');
    const at=text(context.now)||new Date().toISOString();
    const document=normalizeDocument({
      kind,
      name,
      attachmentType,
      mimeType:text(command.mimeType),
      size:command.size,
      status:'ready',
      uploadedAt:at,
      uploadedById:text(command.actorId)
    },kind);
    current.documents=current.documents.filter(item=>item.kind!==kind);
    current.documents.push(document);
    current.updatedAt=at;
    card.work.repair=normalize(current,current.stage);
    return next;
  }
  function removeDocument(project,command={},context={}){
    const kind=text(command.kind),attachmentType=text(command.attachmentType);
    if(!DOCUMENT_KINDS.includes(kind))throw new Error('Неизвестный тип документа.');
    if(!attachmentType)throw new Error('Не указан документ для удаления.');
    const next=clone(project),card=next&&next.phase0&&next.phase0.spaceCard;
    if(!card)throw new Error('Карточка помещения не найдена.');
    card.work=Object.assign({},card.work||{});
    const current=normalize(card.work.repair,inferredStage(card.work));
    if(!current.stage)throw new Error('Этап ремонта ещё не начат.');
    const at=text(context.now)||new Date().toISOString();
    current.documents=current.documents.filter(item=>!(item.kind===kind&&item.attachmentType===attachmentType));
    current.updatedAt=at;
    card.work.repair=normalize(current,current.stage);
    return next;
  }

  return Object.freeze({STAGES,DOCUMENT_KINDS,PIPELINE_ALIASES,normalize,normalizeDocument,repairOf,documentOf,hasRepair,stageOf,isRepairProject,canOpenStage,startDocuments,attachDocument,removeDocument});
});
