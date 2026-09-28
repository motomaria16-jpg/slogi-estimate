(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SlogiWorkCalendar=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const TIME_ZONE='Europe/Moscow';
  const DEFAULT_DURATION_MINUTES=60;
  const DEFAULT_REMINDER_MINUTES=Object.freeze([1440,60]);
  const PIPELINE_STATUSES=Object.freeze([
    'contact_pending','contacted','viewing_scheduled','viewing_completed','proposal_started','rejected'
  ]);
  const TERMINAL_STATUSES=Object.freeze(['proposal_started','rejected']);
  const VIEWING_STATUSES=Object.freeze(['scheduled','cancelled','completed']);
  const REJECTION_REASONS=Object.freeze(['not_suitable_da','not_suitable_tu']);

  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const text=value=>String(value==null?'':value).trim();
  const nowIso=value=>new Date(value==null?Date.now():value).toISOString();
  const terminal=status=>TERMINAL_STATUSES.includes(status);

  class WorkCalendarError extends Error{
    constructor(message,code='WORK_CALENDAR_ERROR',details={}){
      super(message);this.name='WorkCalendarError';this.code=code;this.details=details;
    }
  }

  function explicitIso(value,field){
    const raw=text(value);
    if(!raw||!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw))throw new WorkCalendarError(`${field} must include a UTC offset.`, 'INVALID_TIME',{field,value});
    const date=new Date(raw);
    if(Number.isNaN(date.getTime()))throw new WorkCalendarError(`${field} is invalid.`, 'INVALID_TIME',{field,value});
    return date.toISOString();
  }

  function moscowLocalToIso(value){
    const raw=text(value);
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(raw))throw new WorkCalendarError('Moscow local time must use YYYY-MM-DDTHH:mm.', 'INVALID_LOCAL_TIME',{value});
    return new Date(`${raw}+03:00`).toISOString();
  }

  function formatInMoscow(value,options={}){
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return'';
    return new Intl.DateTimeFormat('ru-RU',Object.assign({timeZone:TIME_ZONE,dateStyle:'medium',timeStyle:'short'},options)).format(date);
  }

  function pipelineFrom(work){
    const nested=work&&work.pipeline&&work.pipeline.status;
    const flat=work&&work.pipelineStatus;
    const legacy=work&&work.status;
    if(PIPELINE_STATUSES.includes(nested))return nested;
    if(PIPELINE_STATUSES.includes(flat))return flat;
    if(PIPELINE_STATUSES.includes(legacy))return legacy;
    if(work&&work.stage==='proposal_handoff')return'proposal_started';
    if(work&&work.stage==='rejected')return'rejected';
    if(legacy==='in_work')return'contact_pending';
    return null;
  }

  function normalizeAttachment(input,index=0){
    const source=input&&typeof input==='object'?input:{};
    const type=text(source.type),mimeType=text(source.mimeType||source.mime||(type.includes('/')?type:''));
    let kind=text(source.kind||source.mediaType||(!type.includes('/')?type:'')).toLowerCase();
    if(['image','picture'].includes(kind)||mimeType.toLowerCase().startsWith('image/'))kind='photo';
    if(kind==='movie'||mimeType.toLowerCase().startsWith('video/'))kind='video';
    const status=source.status==='uploaded'||source.uploadStatus==='uploaded'||source.uploaded===true?'uploaded':text(source.status||source.uploadStatus)||'pending';
    return Object.assign({},clone(source),{
      id:text(source.id)||`attachment-${index+1}`,
      kind,
      status,
      mimeType
    });
  }

  function reminderOffsets(value){
    const source=Array.isArray(value)?value:DEFAULT_REMINDER_MINUTES;
    return Array.from(new Set(source.map(Number).filter(number=>Number.isFinite(number)&&number>=0))).sort((a,b)=>b-a);
  }

  function buildReminders(viewingId,startsAt,offsets,previous=[]){
    const prior=new Map((Array.isArray(previous)?previous:[]).map(item=>[Number(item.minutesBefore),item]));
    return reminderOffsets(offsets).map(minutesBefore=>{
      const old=prior.get(minutesBefore)||{};
      return Object.assign({},clone(old),{
        id:text(old.id)||`${viewingId}:reminder:${minutesBefore}`,
        minutesBefore,
        remindAt:new Date(new Date(startsAt).getTime()-minutesBefore*60000).toISOString(),
        status:['acknowledged','cancelled'].includes(old.status)?old.status:'pending'
      });
    });
  }

  function normalizeViewing(input,index=0,spaceCardId=''){
    const source=input&&typeof input==='object'?input:{};
    let startsAt='';let endsAt='';
    try{if(source.startsAt)startsAt=explicitIso(source.startsAt,'startsAt');}catch(_error){startsAt='';}
    try{if(source.endsAt)endsAt=explicitIso(source.endsAt,'endsAt');}catch(_error){endsAt='';}
    const status=VIEWING_STATUSES.includes(source.status)?source.status:'scheduled';
    const id=text(source.id)||`viewing-${index+1}`;
    return Object.assign({},clone(source),{
      id,
      spaceCardId:text(spaceCardId||source.spaceCardId),
      assignedToId:text(source.assignedToId),
      startsAt,
      endsAt,
      timeZone:TIME_ZONE,
      status,
      attachments:(Array.isArray(source.attachments)?source.attachments:[]).map(normalizeAttachment),
      reminders:startsAt?buildReminders(id,startsAt,(source.reminders||[]).map(item=>item&&item.minutesBefore),source.reminders):[]
    });
  }

  function normalizeWork(input={},spaceCardId=''){
    const source=input&&typeof input==='object'?input:{};
    const status=pipelineFrom(source);
    const viewings=(Array.isArray(source.viewings)?source.viewings:[]).map((viewing,index)=>normalizeViewing(viewing,index,spaceCardId));
    const active=text(source.activeViewingId);
    const activeViewing=viewings.find(viewing=>viewing.id===active&&viewing.status==='scheduled');
    const normalized=Object.assign({},clone(source),{
      viewings,
      activeViewingId:activeViewing?activeViewing.id:null,
      operations:Array.isArray(source.operations)?source.operations.map(clone):[]
    });
    if(status){
      normalized.status=terminal(status)?'closed':'in_work';
      normalized.stage=status==='proposal_started'?'proposal_handoff':status;
      normalized.pipeline=Object.assign({},clone(source.pipeline||{}),{status});
      delete normalized.pipelineStatus;
    }
    return normalized;
  }

  function normalizeProject(input={}){
    const project=clone(input)||{};
    const id=text(project.id);
    if(!id)throw new WorkCalendarError('Project id is required.','PROJECT_ID_REQUIRED');
    project.phase0=project.phase0&&typeof project.phase0==='object'?project.phase0:{};
    const card=project.phase0.spaceCard&&typeof project.phase0.spaceCard==='object'?project.phase0.spaceCard:{};
    project.phase0.spaceCard=Object.assign({},card,{id,work:normalizeWork(card.work,id)});
    return project;
  }

  function pipelineStatus(project){
    const card=project&&project.phase0&&project.phase0.spaceCard;
    return pipelineFrom(card&&card.work);
  }

  function isInWork(project){
    const card=project&&project.phase0&&project.phase0.spaceCard,work=card&&card.work,status=pipelineFrom(work);
    if(!work)return false;
    if(work.status==='closed'||['proposal_handoff','rejected'].includes(work.stage))return false;
    if(status)return!terminal(status)&&(work.status==='in_work'||PIPELINE_STATUSES.includes(work.status)||Boolean(work.pipeline));
    return work.status==='in_work';
  }

  function listInWork(projects){return(Array.isArray(projects)?projects:[]).filter(isInWork);}

  function operationId(command){
    const id=text(command&&command.operationId);
    if(!id)throw new WorkCalendarError('operationId is required.','OPERATION_ID_REQUIRED');
    return id;
  }

  function hasOperation(project,id){
    const card=project&&project.phase0&&project.phase0.spaceCard,operations=card&&card.work&&card.work.operations;
    return Boolean(id&&Array.isArray(operations)&&operations.some(item=>item&&item.id===id));
  }

  function prepare(project,command){
    const id=operationId(command),next=normalizeProject(project),work=next.phase0.spaceCard.work,status=pipelineFrom(work);
    if(hasOperation(next,id))return{project:next,work,status,operation:id,replayed:true};
    if(!status||!isInWork(next))throw new WorkCalendarError('Project is not in work.','PROJECT_NOT_IN_WORK',{projectId:next.id});
    return{project:next,work,status,operation:id,replayed:false};
  }

  function record(context,type,at,resultId=''){
    context.work.operations.push({id:context.operation,type,at,resultId:text(resultId)});
    context.work.pipeline.updatedAt=at;
    context.project.phase0.spaceCard.work=context.work;
    return context.project;
  }

  function setPipeline(context,status,at,extra={}){
    context.work.pipeline=Object.assign({},context.work.pipeline||{},clone(extra),{status,updatedAt:at});
    context.work.status=terminal(status)?'closed':'in_work';
    context.work.stage=status==='proposal_started'?'proposal_handoff':status;
  }

  function viewingInterval(command,base={}){
    const startsAt=explicitIso(command.startsAt||base.startsAt,'startsAt');
    const startMs=new Date(startsAt).getTime();
    let endsAt;
    if(command.endsAt)endsAt=explicitIso(command.endsAt,'endsAt');
    else if(base.endsAt&&!command.durationMinutes&&command.durationMinutes!==0){
      const oldDuration=new Date(base.endsAt).getTime()-new Date(base.startsAt).getTime();
      endsAt=new Date(startMs+(oldDuration>0?oldDuration:DEFAULT_DURATION_MINUTES*60000)).toISOString();
    }else{
      const duration=command.durationMinutes==null?DEFAULT_DURATION_MINUTES:Number(command.durationMinutes);
      if(!Number.isFinite(duration)||duration<=0)throw new WorkCalendarError('durationMinutes must be positive.','INVALID_DURATION');
      endsAt=new Date(startMs+duration*60000).toISOString();
    }
    if(new Date(endsAt).getTime()<=startMs)throw new WorkCalendarError('endsAt must be after startsAt.','INVALID_INTERVAL');
    return{startsAt,endsAt};
  }

  function overlaps(a,b){
    return new Date(a.startsAt).getTime()<new Date(b.endsAt).getTime()&&new Date(b.startsAt).getTime()<new Date(a.endsAt).getTime();
  }

  function findOverlaps(projects,candidate,options={}){
    const assignedToId=text(candidate&&candidate.assignedToId);
    if(!assignedToId)return[];
    const interval=viewingInterval(candidate,candidate),excludeProjectId=text(options.excludeProjectId),excludeViewingId=text(options.excludeViewingId);
    const conflicts=[];
    (Array.isArray(projects)?projects:[]).forEach(source=>{
      let project;try{project=normalizeProject(source);}catch(_error){return;}
      const card=project.phase0.spaceCard;
      card.work.viewings.forEach(viewing=>{
        if(viewing.status!=='scheduled'||viewing.assignedToId!==assignedToId||!viewing.startsAt||!viewing.endsAt)return;
        if(project.id===excludeProjectId&&viewing.id===excludeViewingId)return;
        if(overlaps(interval,viewing))conflicts.push({projectId:project.id,spaceCardId:card.id,viewingId:viewing.id,assignedToId,startsAt:viewing.startsAt,endsAt:viewing.endsAt});
      });
    });
    return conflicts;
  }

  function assertNoOverlap(projects,candidate,options){
    const conflicts=findOverlaps(projects,candidate,options);
    if(conflicts.length)throw new WorkCalendarError('Assigned employee already has a viewing at this time.','VIEWING_OVERLAP',{conflicts});
  }

  function schedule(project,command={},context={}){
    const state=prepare(project,command);if(state.replayed)return state.project;
    if(terminal(state.status))throw new WorkCalendarError('Closed project cannot be scheduled.','PIPELINE_CLOSED',{status:state.status});
    if(state.work.activeViewingId)throw new WorkCalendarError('Project already has an active viewing.','ACTIVE_VIEWING_EXISTS',{viewingId:state.work.activeViewingId});
    const assignedToId=text(command.assignedToId);
    if(!assignedToId)throw new WorkCalendarError('assignedToId is required.','ASSIGNEE_REQUIRED');
    const interval=viewingInterval(command),at=nowIso(context.now),id=text(command.viewingId)||`viewing-${state.operation}`;
    if(state.work.viewings.some(viewing=>viewing.id===id))throw new WorkCalendarError('Viewing id already exists.','DUPLICATE_VIEWING_ID',{viewingId:id});
    const viewing={
      id,spaceCardId:state.project.id,assignedToId,startsAt:interval.startsAt,endsAt:interval.endsAt,timeZone:TIME_ZONE,status:'scheduled',
      address:text(command.address||state.project.address||state.project.phase0.spaceCard.address),notes:text(command.notes),attachments:[],
      createdAt:at,createdById:text(command.actorId),updatedAt:at,updatedById:text(command.actorId)
    };
    viewing.reminders=buildReminders(id,viewing.startsAt,command.reminderMinutesBefore);
    assertNoOverlap(context.projects,viewing,{excludeProjectId:state.project.id,excludeViewingId:id});
    state.work.viewings.push(viewing);state.work.activeViewingId=id;setPipeline(state,'viewing_scheduled',at,{viewingId:id});
    return record(state,'schedule',at,id);
  }

  function activeViewing(state,command,allowed=['scheduled']){
    const id=text(command.viewingId||state.work.activeViewingId),viewing=state.work.viewings.find(item=>item.id===id);
    if(!viewing)throw new WorkCalendarError('Viewing was not found.','VIEWING_NOT_FOUND',{viewingId:id});
    if(!allowed.includes(viewing.status))throw new WorkCalendarError('Viewing is not in the required state.','INVALID_VIEWING_STATUS',{viewingId:id,status:viewing.status});
    return viewing;
  }

  function reschedule(project,command={},context={}){
    const state=prepare(project,command);if(state.replayed)return state.project;
    if(terminal(state.status))throw new WorkCalendarError('Closed project cannot be rescheduled.','PIPELINE_CLOSED',{status:state.status});
    const viewing=activeViewing(state,command),assignedToId=text(command.assignedToId||viewing.assignedToId);
    if(!assignedToId)throw new WorkCalendarError('assignedToId is required.','ASSIGNEE_REQUIRED');
    const interval=viewingInterval(command,viewing),at=nowIso(context.now),candidate=Object.assign({},viewing,interval,{assignedToId});
    assertNoOverlap(context.projects,candidate,{excludeProjectId:state.project.id,excludeViewingId:viewing.id});
    viewing.assignedToId=assignedToId;viewing.startsAt=interval.startsAt;viewing.endsAt=interval.endsAt;viewing.updatedAt=at;viewing.updatedById=text(command.actorId);
    if(Object.prototype.hasOwnProperty.call(command,'notes'))viewing.notes=text(command.notes);
    viewing.reminders=buildReminders(viewing.id,viewing.startsAt,command.reminderMinutesBefore||viewing.reminders.map(item=>item.minutesBefore));
    state.work.activeViewingId=viewing.id;setPipeline(state,'viewing_scheduled',at,{viewingId:viewing.id});
    return record(state,'reschedule',at,viewing.id);
  }

  function cancel(project,command={},context={}){
    const state=prepare(project,command);if(state.replayed)return state.project;
    const viewing=activeViewing(state,command),at=nowIso(context.now);
    viewing.status='cancelled';viewing.cancelledAt=at;viewing.cancelledById=text(command.actorId);viewing.cancellationReason=text(command.reason);viewing.updatedAt=at;
    viewing.reminders=viewing.reminders.map(item=>Object.assign({},item,{status:'cancelled'}));
    state.work.activeViewingId=null;setPipeline(state,'contacted',at,{viewingId:null});
    return record(state,'cancel',at,viewing.id);
  }

  function reject(project,command={},context={}){
    const state=prepare(project,command);if(state.replayed)return state.project;
    const reason=text(command.reason||command.reasonCode),comment=text(command.comment);
    if(!REJECTION_REASONS.includes(reason))throw new WorkCalendarError('Rejection reason is invalid.','REJECTION_REASON_REQUIRED');
    if(!comment)throw new WorkCalendarError('Rejection comment is required.','REJECTION_COMMENT_REQUIRED');
    const at=nowIso(context.now);
    if(state.work.activeViewingId){
      const viewing=state.work.viewings.find(item=>item.id===state.work.activeViewingId&&item.status==='scheduled');
      if(viewing){viewing.status='cancelled';viewing.cancelledAt=at;viewing.cancellationReason='project_rejected';viewing.reminders=viewing.reminders.map(item=>Object.assign({},item,{status:'cancelled'}));}
    }
    state.work.activeViewingId=null;
    state.work.rejection={reasonCode:reason,comment,at,actorId:text(command.actorId)};
    setPipeline(state,'rejected',at,{reason,rejectionComment:comment,rejectedAt:at,rejectedById:text(command.actorId),viewingId:null});
    return record(state,'reject',at);
  }

  function complete(project,command={},context={}){
    const state=prepare(project,command);if(state.replayed)return state.project;
    if(command.confirmed!==true)throw new WorkCalendarError('Explicit completion confirmation is required.','COMPLETION_CONFIRMATION_REQUIRED');
    const viewing=activeViewing(state,command),at=nowIso(context.now);
    if(new Date(at).getTime()<new Date(viewing.startsAt).getTime())throw new WorkCalendarError('Viewing cannot be completed before it starts.','VIEWING_NOT_STARTED',{startsAt:viewing.startsAt,now:at});
    const combined=[...viewing.attachments,...(Array.isArray(command.attachments)?command.attachments:[])].map(normalizeAttachment);
    const unique=[];const ids=new Set();combined.forEach(item=>{const identity=item.id||`${item.kind}:${item.url||unique.length}`;if(!ids.has(identity)){ids.add(identity);unique.push(item);}});
    const uploaded=unique.filter(item=>item.status==='uploaded'),hasPhoto=uploaded.some(item=>item.kind==='photo'),hasVideo=uploaded.some(item=>item.kind==='video');
    if(!hasPhoto||!hasVideo)throw new WorkCalendarError('At least one uploaded photo and one uploaded video are required.','VIEWING_MEDIA_REQUIRED',{hasPhoto,hasVideo});
    viewing.attachments=unique;viewing.status='completed';viewing.completedAt=at;viewing.completedById=text(command.actorId);viewing.completionNote=text(command.note);viewing.updatedAt=at;
    viewing.reminders=viewing.reminders.map(item=>Object.assign({},item,{status:item.status==='acknowledged'?'acknowledged':'cancelled'}));
    state.work.activeViewingId=null;setPipeline(state,'viewing_completed',at,{viewingId:viewing.id});
    return record(state,'complete',at,viewing.id);
  }

  function removeAttachment(project,command={},context={}){
    const state=prepare(project,command);if(state.replayed)return state.project;
    const viewingId=text(command.viewingId),attachmentId=text(command.attachmentId);
    if(!viewingId)throw new WorkCalendarError('viewingId is required.','VIEWING_ID_REQUIRED');
    if(!attachmentId)throw new WorkCalendarError('attachmentId is required.','ATTACHMENT_ID_REQUIRED');
    const viewing=state.work.viewings.find(item=>item.id===viewingId);
    if(!viewing)throw new WorkCalendarError('Viewing was not found.','VIEWING_NOT_FOUND',{viewingId});
    const attachments=Array.isArray(viewing.attachments)?viewing.attachments:[];
    const attachment=attachments.find(item=>item&&item.id===attachmentId)||null,at=nowIso(context.now);
    if(attachment&&attachment.status!=='removed')Object.assign(attachment,{status:'removed',removedAt:at,removedById:text(command.actorId)});
    viewing.updatedAt=at;viewing.updatedById=text(command.actorId);
    return record(state,'removeAttachment',at,attachmentId);
  }

  function startProposal(project,command={},context={}){
    const state=prepare(project,command);if(state.replayed)return state.project;
    if(state.status!=='viewing_completed')throw new WorkCalendarError('Proposal can start only after a completed viewing.','VIEWING_NOT_COMPLETED',{status:state.status});
    const completedViewing=state.work.viewings.find(item=>item.id===text(state.work.pipeline&&state.work.pipeline.viewingId))||state.work.viewings.slice().reverse().find(item=>item.status==='completed');
    const uploaded=completedViewing&&Array.isArray(completedViewing.attachments)?completedViewing.attachments.filter(item=>item&&item.status==='uploaded'):[];
    const hasPhoto=uploaded.some(item=>item.kind==='photo'),hasVideo=uploaded.some(item=>item.kind==='video');
    if(!hasPhoto||!hasVideo)throw new WorkCalendarError('At least one uploaded photo and one uploaded video are required.','VIEWING_MEDIA_REQUIRED',{hasPhoto,hasVideo});
    const at=nowIso(context.now);state.work.activeViewingId=null;
    setPipeline(state,'proposal_started',at,{proposalId:text(command.proposalId),proposalStartedAt:at,proposalStartedById:text(command.actorId),viewingId:state.work.pipeline.viewingId||null});
    return record(state,'startProposal',at,text(command.proposalId));
  }

  function markContacted(project,command={},context={}){
    const state=prepare(project,command);if(state.replayed)return state.project;
    if(terminal(state.status))throw new WorkCalendarError('Closed project cannot be contacted.','PIPELINE_CLOSED',{status:state.status});
    const at=nowIso(context.now),contact=command.contact&&typeof command.contact==='object'?clone(command.contact):null;
    if(contact)state.work.landlordContact=Object.assign({},state.work.landlordContact||{},contact,{contactedAt:at});
    const nextStatus=['viewing_scheduled','viewing_completed'].includes(state.status)?state.status:'contacted';
    setPipeline(state,nextStatus,at,{contactedAt:at,contactedById:text(command.actorId)});
    return record(state,'markContacted',at);
  }

  function getInAppReminders(projects,at=Date.now()){
    const point=new Date(at).getTime();if(Number.isNaN(point))throw new WorkCalendarError('Reminder time is invalid.','INVALID_TIME');
    const due=[];
    listInWork(projects).forEach(source=>{
      const project=normalizeProject(source),card=project.phase0.spaceCard;
      card.work.viewings.filter(viewing=>viewing.status==='scheduled').forEach(viewing=>{
        if(new Date(viewing.startsAt).getTime()<=point)return;
        viewing.reminders.filter(reminder=>reminder.status==='pending'&&new Date(reminder.remindAt).getTime()<=point).forEach(reminder=>due.push({
          id:reminder.id,projectId:project.id,spaceCardId:card.id,viewingId:viewing.id,assignedToId:viewing.assignedToId,startsAt:viewing.startsAt,remindAt:reminder.remindAt,minutesBefore:reminder.minutesBefore,address:viewing.address||card.address||project.address||''
        }));
      });
    });
    return due.sort((a,b)=>a.remindAt.localeCompare(b.remindAt));
  }

  function acknowledgeReminder(project,command={},context={}){
    const state=prepare(project,command);if(state.replayed)return state.project;
    const id=text(command.reminderId);if(!id)throw new WorkCalendarError('reminderId is required.','REMINDER_ID_REQUIRED');
    let target=null;state.work.viewings.some(viewing=>viewing.reminders.some(reminder=>{if(reminder.id===id){target=reminder;return true;}return false;}));
    if(!target)throw new WorkCalendarError('Reminder was not found.','REMINDER_NOT_FOUND',{reminderId:id});
    const at=nowIso(context.now);target.status='acknowledged';target.acknowledgedAt=at;target.acknowledgedById=text(command.actorId);
    return record(state,'acknowledgeReminder',at,id);
  }

  class WorkCalendarService{
    constructor({projectRepository,now,idFactory}={}){
      if(!projectRepository||typeof projectRepository.get!=='function'||typeof projectRepository.mutate!=='function')throw new WorkCalendarError('ProjectRepository with get/mutate is required.','REPOSITORY_REQUIRED');
      this.projects=projectRepository;this.clock=typeof now==='function'?now:()=>new Date().toISOString();this.idFactory=typeof idFactory==='function'?idFactory:null;
    }
    current(id){const project=this.projects.get(id);if(!project)throw new WorkCalendarError('Project was not found.','PROJECT_NOT_FOUND',{projectId:id});return project;}
    apply(projectId,type,fn,command={}){
      const id=operationId(command),current=this.current(projectId);if(hasOperation(current,id))return normalizeProject(current);
      const cmd=Object.assign({},command);if(type==='schedule'&&!cmd.viewingId&&this.idFactory)cmd.viewingId=this.idFactory('viewing');
      const expected=cmd.expectedRevision==null?current.phase0&&current.phase0.revision:cmd.expectedRevision;
      return this.projects.mutate(projectId,project=>fn(project,cmd,{now:this.clock(),projects:this.projects.listAll?this.projects.listAll():[project]}),expected,`work-calendar-${type}`);
    }
    schedule(id,command){return this.apply(id,'schedule',schedule,command);}
    reschedule(id,command){return this.apply(id,'reschedule',reschedule,command);}
    cancel(id,command){return this.apply(id,'cancel',cancel,command);}
    reject(id,command){return this.apply(id,'reject',reject,command);}
    complete(id,command){return this.apply(id,'complete',complete,command);}
    removeAttachment(id,command){return this.apply(id,'remove-attachment',removeAttachment,command);}
    startProposal(id,command){return this.apply(id,'start-proposal',startProposal,command);}
    markContacted(id,command){return this.apply(id,'mark-contacted',markContacted,command);}
    acknowledgeReminder(id,command){return this.apply(id,'acknowledge-reminder',acknowledgeReminder,command);}
    reminders(at){return getInAppReminders(this.projects.listAll?this.projects.listAll():[],at==null?this.clock():at);}
  }

  function createService(options){return new WorkCalendarService(options);}

  return{
    TIME_ZONE,DEFAULT_DURATION_MINUTES,DEFAULT_REMINDER_MINUTES,PIPELINE_STATUSES,TERMINAL_STATUSES,VIEWING_STATUSES,REJECTION_REASONS,
    WorkCalendarError,WorkCalendarService,createService,moscowLocalToIso,formatInMoscow,normalizeWork,normalizeProject,pipelineStatus,isInWork,listInWork,
    hasOperation,findOverlaps,getInAppReminders,acknowledgeReminder,markContacted,schedule,reschedule,cancel,reject,complete,removeAttachment,startProposal
  };
});
