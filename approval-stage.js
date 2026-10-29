(function approvalStageModule(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SlogiApprovalStage=api;
})(typeof window!=='undefined'?window:globalThis,function approvalStageFactory(){
  'use strict';

  const STATUSES=Object.freeze(['pending','agreed','rejected']);
  const DOCUMENT_KINDS=Object.freeze(['protocol','signedLease','ownershipProof']);
  const REJECTION_REASONS=Object.freeze([
    'rent_rate',
    'rent_holidays',
    'contract_terms',
    'other'
  ]);
  const REJECTION_LABELS=Object.freeze({
    rent_rate:'Не сошлись по ставке',
    rent_holidays:'Не сошлись по арендным каникулам',
    contract_terms:'Не сошлись по условиям договора',
    other:'Иная причина'
  });
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const text=value=>String(value==null?'':value).trim();

  function workOf(project){
    const card=project&&project.phase0&&project.phase0.spaceCard||{};
    return card.work&&typeof card.work==='object'?card.work:{};
  }
  function normalizeDocument(source,kind){
    const input=source&&typeof source==='object'?source:{};
    return{
      kind,
      name:text(input.name),
      attachmentType:text(input.attachmentType)||`approval-${kind}`,
      mimeType:text(input.mimeType),
      size:Number.isFinite(Number(input.size))?Number(input.size):null,
      uploadedAt:text(input.uploadedAt)||null,
      uploadedById:text(input.uploadedById)||null
    };
  }
  function normalize(source={}){
    const input=source&&typeof source==='object'?source:{};
    const status=STATUSES.includes(text(input.status))?text(input.status):'pending';
    const documents=input.documents&&typeof input.documents==='object'?input.documents:{};
    return{
      status,
      enteredAt:text(input.enteredAt)||null,
      enteredById:text(input.enteredById)||null,
      documents:{
        protocol:normalizeDocument(documents.protocol,'protocol'),
        signedLease:normalizeDocument(documents.signedLease,'signedLease'),
        ownershipProofs:(Array.isArray(documents.ownershipProofs)?documents.ownershipProofs:(documents.ownershipProof&&documents.ownershipProof.name?[documents.ownershipProof]:[])).map(item=>normalizeDocument(item,'ownershipProof'))
      },
      rejectionReason:REJECTION_REASONS.includes(text(input.rejectionReason))?text(input.rejectionReason):'',
      rejectionComment:text(input.rejectionComment),
      decidedAt:text(input.decidedAt)||null,
      decidedById:text(input.decidedById)||null,
      updatedAt:text(input.updatedAt)||null
    };
  }
  function approvalOf(project){return normalize(workOf(project).approval);}
  function hasApproval(project){return Boolean(workOf(project).approval);}
  function isApprovalProject(project){
    if(!project||project.deletedAt)return false;
    const work=workOf(project);
    return hasApproval(project)?approvalOf(project).status==='pending':text(work.proposal&&work.proposal.status)==='sent';
  }
  function assertCard(project){
    const next=clone(project),card=next&&next.phase0&&next.phase0.spaceCard;
    if(!card)throw new Error('Карточка помещения не найдена.');
    card.work=Object.assign({},card.work||{});
    return{next,work:card.work};
  }
  function setPipeline(work,status,stage,at,extra={}){
    work.status='closed';
    work.stage=stage;
    work.pipeline=Object.assign({},work.pipeline||{},clone(extra),{status,updatedAt:at});
  }
  function start(project,command={},context={}){
    const proposal=workOf(project).proposal||{};
    if(text(proposal.status)!=='sent'||!text(proposal.sentAt))throw new Error('Сначала зафиксируйте отправку КП.');
    const {next,work}=assertCard(project),at=text(context.now)||new Date().toISOString();
    const current=normalize(work.approval);
    work.approval=normalize(Object.assign({},current,{
      status:'pending',
      enteredAt:current.enteredAt||at,
      enteredById:current.enteredById||text(command.actorId),
      updatedAt:at
    }));
    setPipeline(work,'approval_pending','approval',at,{approvalStartedAt:work.approval.enteredAt,approvalStartedById:work.approval.enteredById});
    return next;
  }
  function attachDocument(project,command={},context={}){
    const kind=text(command.kind);
    if(!DOCUMENT_KINDS.includes(kind))throw new Error('Неизвестный тип документа.');
    const {next,work}=assertCard(project),approval=normalize(work.approval),at=text(context.now)||new Date().toISOString();
    if(approval.status!=='pending')throw new Error('Согласование уже завершено.');
    const name=text(command.name);
    if(!name)throw new Error('Укажите файл документа.');
    const document=normalizeDocument({
      name,
      attachmentType:text(command.attachmentType)||`approval-${kind}`,
      mimeType:text(command.mimeType),
      size:command.size,
      uploadedAt:at,
      uploadedById:text(command.actorId)
    },kind);
    if(kind==='ownershipProof'){
      approval.documents.ownershipProofs=approval.documents.ownershipProofs.filter(item=>item.attachmentType!==document.attachmentType);
      approval.documents.ownershipProofs.push(document);
    }else approval.documents[kind]=document;
    approval.updatedAt=at;
    work.approval=approval;
    return next;
  }
  function removeDocument(project,command={},context={}){
    const kind=text(command.kind);
    if(!DOCUMENT_KINDS.includes(kind))throw new Error('Неизвестный тип документа.');
    const {next,work}=assertCard(project),approval=normalize(work.approval),at=text(context.now)||new Date().toISOString();
    if(approval.status!=='pending')throw new Error('Согласование уже завершено.');
    if(kind==='ownershipProof'){
      const attachmentType=text(command.attachmentType);
      if(!attachmentType)throw new Error('Не указан документ для удаления.');
      approval.documents.ownershipProofs=approval.documents.ownershipProofs.filter(item=>item.attachmentType!==attachmentType);
    }else{
      const current=approval.documents[kind];
      const attachmentType=text(command.attachmentType);
      if(attachmentType&&current.attachmentType!==attachmentType)return next;
      approval.documents[kind]=normalizeDocument({},kind);
    }
    approval.updatedAt=at;
    work.approval=approval;
    return next;
  }
  function requiredDocuments(approval){
    const normalized=normalize(approval);
    return{
      signedLease:Boolean(normalized.documents.signedLease.name),
      ownershipProof:normalized.documents.ownershipProofs.some(document=>Boolean(document.name))
    };
  }
  function canAgree(project){
    const approval=approvalOf(project),required=requiredDocuments(approval);
    return approval.status==='pending'&&required.signedLease&&required.ownershipProof;
  }
  function agree(project,command={},context={}){
    const {next,work}=assertCard(project),approval=normalize(work.approval),required=requiredDocuments(approval),at=text(context.now)||new Date().toISOString();
    if(approval.status!=='pending')throw new Error('Согласование уже завершено.');
    if(!required.signedLease)throw new Error('Прикрепите подписанный договор аренды.');
    if(!required.ownershipProof)throw new Error('Прикрепите документ о собственности или праве сдачи помещения в аренду.');
    const actorId=text(command.actorId);
    work.approval=normalize(Object.assign({},approval,{status:'agreed',decidedAt:at,decidedById:actorId,updatedAt:at}));
    work.repair={
      schemaVersion:1,
      stage:'documents',
      enteredAt:at,
      enteredById:actorId||null,
      updatedAt:at,
      transitions:[]
    };
    setPipeline(work,'repair','repair',at,{approvalDecision:'agreed',approvalDecidedAt:at,approvalDecidedById:actorId});
    return next;
  }
  function reject(project,command={},context={}){
    const {next,work}=assertCard(project),approval=normalize(work.approval),reason=text(command.reason),comment=text(command.comment),at=text(context.now)||new Date().toISOString();
    if(approval.status!=='pending')throw new Error('Согласование уже завершено.');
    if(!REJECTION_REASONS.includes(reason))throw new Error('Выберите причину отказа.');
    if(reason==='other'&&!comment)throw new Error('Для иной причины добавьте комментарий.');
    work.approval=normalize(Object.assign({},approval,{status:'rejected',rejectionReason:reason,rejectionComment:comment,decidedAt:at,decidedById:text(command.actorId),updatedAt:at}));
    setPipeline(work,'archived','archived',at,{approvalDecision:'rejected',approvalRejectionReason:reason,approvalRejectionComment:comment,approvalDecidedAt:at,approvalDecidedById:text(command.actorId)});
    return next;
  }

  return Object.freeze({
    STATUSES,DOCUMENT_KINDS,REJECTION_REASONS,REJECTION_LABELS,
    normalize,approvalOf,hasApproval,isApprovalProject,start,attachDocument,removeDocument,requiredDocuments,canAgree,agree,reject
  });
});
