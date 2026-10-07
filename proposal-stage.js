(function proposalStageModule(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SlogiProposalStage=api;
})(typeof window!=='undefined'?window:globalThis,function proposalStageFactory(){
  'use strict';

  const STATUSES=Object.freeze(['draft','prepared','sent']);
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const text=value=>String(value==null?'':value).trim();
  function number(value){
    if(value==null||text(value)==='')return null;
    const parsed=Number(String(value).replace(/\s+/g,'').replace(',','.'));
    return Number.isFinite(parsed)?parsed:null;
  }
  function nonNegative(value,integer=false){
    const parsed=number(value);
    if(parsed==null||parsed<0)return null;
    return integer?Math.trunc(parsed):Number(parsed.toFixed(2));
  }
  function proposalOf(project){
    const card=project&&project.phase0&&project.phase0.spaceCard||{};
    const work=card.work&&typeof card.work==='object'?card.work:{};
    return normalize(work.proposal);
  }
  function normalize(source={}){
    const input=source&&typeof source==='object'?source:{};
    const status=STATUSES.includes(text(input.status))?text(input.status):'draft';
    return{
      status,
      rentFreeDays:nonNegative(input.rentFreeDays,true),
      baseRentRate:nonNegative(input.baseRentRate),
      discountRentRate:nonNegative(input.discountRentRate),
      discountPeriodDays:nonNegative(input.discountPeriodDays,true),
      emailSubject:text(input.emailSubject),
      emailBody:String(input.emailBody==null?'':input.emailBody).trim(),
      pdfName:text(input.pdfName),
      pdfAttachmentType:text(input.pdfAttachmentType)||'proposal-pdf',
      leaseName:text(input.leaseName)||'Типовой договор аренды.docx',
      preparedAt:text(input.preparedAt)||null,
      sentAt:text(input.sentAt)||null,
      followUpTaskId:text(input.followUpTaskId)||null,
      followUpDueAt:text(input.followUpDueAt)||null,
      updatedAt:text(input.updatedAt)||null
    };
  }
  function validateTerms(input){
    const terms=normalize(input),errors=[];
    if(terms.rentFreeDays==null)errors.push('Укажите арендные каникулы в днях.');
    if(terms.baseRentRate==null||terms.baseRentRate<=0)errors.push('Укажите базовую арендную ставку.');
    if(terms.discountRentRate==null)errors.push('Укажите ставку на льготный период.');
    if(terms.discountPeriodDays==null)errors.push('Укажите срок льготного периода в днях.');
    if(terms.baseRentRate!=null&&terms.discountRentRate!=null&&terms.discountRentRate>terms.baseRentRate)errors.push('Льготная ставка не должна превышать базовую.');
    return{valid:errors.length===0,errors,terms};
  }
  function isProposalProject(project){
    const card=project&&project.phase0&&project.phase0.spaceCard||{},work=card.work||{},pipeline=work.pipeline||{};
    return !project.deletedAt&&(work.stage==='proposal_handoff'||pipeline.status==='proposal_started'||Boolean(work.proposal&&work.proposal.sentAt));
  }
  function setProposal(project,patch,at){
    const next=clone(project),card=next.phase0&&next.phase0.spaceCard;
    if(!card)throw new Error('Карточка помещения не найдена.');
    card.work=Object.assign({},card.work||{});
    const current=normalize(card.work.proposal),stamp=text(at)||new Date().toISOString();
    card.work.proposal=normalize(Object.assign({},current,patch,{updatedAt:stamp}));
    return next;
  }
  function prepare(project,command={},context={}){
    if(!isProposalProject(project))throw new Error('Помещение ещё не передано на этап КП.');
    const checked=validateTerms(command);
    if(!checked.valid)throw new Error(checked.errors[0]);
    const at=text(context.now)||new Date().toISOString();
    return setProposal(project,Object.assign({},checked.terms,{
      status:'prepared',
      emailSubject:text(command.emailSubject),
      emailBody:text(command.emailBody),
      pdfName:text(command.pdfName),
      pdfAttachmentType:text(command.pdfAttachmentType)||'proposal-pdf',
      leaseName:text(command.leaseName)||'Типовой договор аренды.docx',
      preparedAt:at,
      sentAt:null,
      followUpTaskId:null,
      followUpDueAt:null
    }),at);
  }
  function markSent(project,command={},context={}){
    if(!isProposalProject(project))throw new Error('Помещение ещё не передано на этап КП.');
    const current=proposalOf(project);
    if(current.status!=='prepared'&&current.status!=='sent')throw new Error('Сначала подготовьте КП.');
    const at=text(context.now)||new Date().toISOString(),dueAt=text(command.followUpDueAt)||new Date(new Date(at).getTime()+24*60*60*1000).toISOString();
    return setProposal(project,{status:'sent',sentAt:at,followUpTaskId:text(command.followUpTaskId),followUpDueAt:dueAt},at);
  }
  function emailDraft(project,contact={}){
    const address=text(project&&project.address)||'выбранному помещению';
    const recipient=text(contact.name)||text(contact.organization);
    return{
      subject:`Коммерческое предложение по помещению: ${address}`,
      body:`Здравствуйте${recipient?`, ${recipient}`:''}!\n\nБлагодарим за встречу и возможность рассмотреть помещение по адресу: ${address}.\n\nНаправляем коммерческое предложение с предлагаемыми условиями аренды и типовой проект договора аренды. Будем рады обсудить параметры и ответить на вопросы.\n\nПросим подтвердить получение письма и сообщить удобное время для обратной связи.\n\nС уважением,\nкоманда «СЛОГИ»`
    };
  }
  function followUpTask(project,proposal,taskId){
    const normalized=normalize(proposal),address=text(project&&project.address)||'помещению';
    if(normalized.status!=='sent'||!normalized.followUpDueAt)throw new Error('КП ещё не отправлено.');
    return{
      id:text(taskId)||normalized.followUpTaskId||`kp-follow-up-${text(project&&project.id)}`,
      projectId:text(project&&project.id),
      type:'proposal_follow_up',
      title:`Связаться с арендодателем: ${address}`,
      description:'Уточнить получение коммерческого предложения и типового договора аренды.',
      dueDate:normalized.followUpDueAt,
      startsAt:normalized.followUpDueAt,
      status:'Запланирована',
      source:'proposal'
    };
  }

  return Object.freeze({STATUSES,normalize,proposalOf,validateTerms,isProposalProject,prepare,markSent,emailDraft,followUpTask});
});
