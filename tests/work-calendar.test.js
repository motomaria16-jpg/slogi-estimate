'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const calendar=require('../work-calendar.js');
const cardModel=require('../search-space-card.js');

const ROOT=path.join(__dirname,'..');
const AT='2026-09-27T10:00:00.000Z';
const START='2026-09-27T12:00:00.000Z';

function project(id='space-1',work={status:'in_work',takenAt:'2026-09-20T10:00:00.000Z'}){
  return{id,address:'Москва, Тверская улица, 1',phase0:{revision:3,spaceCard:{id,work}}};
}

function command(operationId,overrides={}){
  return{operationId,actorId:'employee-1',...overrides};
}

function schedule(source=project(),overrides={}){
  return calendar.schedule(source,command('op-schedule',{assignedToId:'employee-1',startsAt:START,durationMinutes:60,...overrides}),{now:AT,projects:[source]});
}

test('browser/CommonJS API exposes the pure domain and repository adapter contract',()=>{
  assert.equal(globalThis.SlogiWorkCalendar,calendar);
  ['normalizeProject','pipelineStatus','isInWork','findOverlaps','getInAppReminders','schedule','reschedule','cancel','reject','complete','startProposal','createService'].forEach(name=>assert.equal(typeof calendar[name],'function',name));
  assert.equal(calendar.TIME_ZONE,'Europe/Moscow');
  assert.deepEqual(calendar.PIPELINE_STATUSES,['contact_pending','contacted','viewing_scheduled','viewing_completed','proposal_started','rejected']);
  assert.equal(calendar.moscowLocalToIso('2026-09-27T15:00'),'2026-09-27T12:00:00.000Z');
});

test('legacy in_work cards migrate without copying the canonical card or changing its id',()=>{
  const legacy=project('stable-id');
  legacy.phase0.spaceCard.id='stale-id';
  const normalized=calendar.normalizeProject(legacy);
  assert.equal(normalized.id,'stable-id');
  assert.equal(normalized.phase0.spaceCard.id,'stable-id');
  assert.equal(normalized.phase0.spaceCard.work.status,'in_work');
  assert.equal(normalized.phase0.spaceCard.work.stage,'contact_pending');
  assert.equal(normalized.phase0.spaceCard.work.pipeline.status,'contact_pending');
  assert.deepEqual(normalized.phase0.spaceCard.work.viewings,[]);
  assert.equal(normalized.phase0.spaceCard.work.activeViewingId,null);
  assert.equal(legacy.phase0.spaceCard.id,'stale-id','normalization is pure');
});

test('schedule creates one active Moscow viewing and deterministic in-app reminders',()=>{
  const saved=schedule();
  const work=saved.phase0.spaceCard.work,viewing=work.viewings[0];
  assert.equal(work.pipeline.status,'viewing_scheduled');
  assert.equal(work.stage,'viewing_scheduled');
  assert.equal(work.activeViewingId,'viewing-op-schedule');
  assert.deepEqual({spaceCardId:viewing.spaceCardId,assignedToId:viewing.assignedToId,timeZone:viewing.timeZone,status:viewing.status},{spaceCardId:'space-1',assignedToId:'employee-1',timeZone:'Europe/Moscow',status:'scheduled'});
  assert.equal(viewing.endsAt,'2026-09-27T13:00:00.000Z');
  assert.deepEqual(viewing.reminders.map(item=>[item.minutesBefore,item.remindAt]),[[1440,'2026-09-26T12:00:00.000Z'],[60,'2026-09-27T11:00:00.000Z']]);
  assert.throws(()=>calendar.schedule(saved,command('second',{assignedToId:'employee-1',startsAt:'2026-09-28T12:00:00Z'})),error=>error.code==='ACTIVE_VIEWING_EXISTS');
});

test('overlap is blocked only for the same employee and touching intervals are allowed',()=>{
  const existing=schedule();
  const candidate=project('space-2');
  assert.throws(()=>calendar.schedule(candidate,command('conflict',{assignedToId:'employee-1',startsAt:'2026-09-27T12:30:00Z',endsAt:'2026-09-27T13:30:00Z'}),{now:AT,projects:[existing,candidate]}),error=>error.code==='VIEWING_OVERLAP'&&error.details.conflicts[0].projectId==='space-1');
  const otherEmployee=calendar.schedule(candidate,command('other',{assignedToId:'employee-2',startsAt:'2026-09-27T12:30:00Z',endsAt:'2026-09-27T13:30:00Z'}),{now:AT,projects:[existing,candidate]});
  assert.equal(otherEmployee.phase0.spaceCard.work.activeViewingId,'viewing-other');
  const touching=project('space-3');
  assert.doesNotThrow(()=>calendar.schedule(touching,command('touching',{assignedToId:'employee-1',startsAt:'2026-09-27T13:00:00Z',endsAt:'2026-09-27T14:00:00Z'}),{now:AT,projects:[existing,touching]}));
});

test('reschedule preserves the viewing id, checks conflicts, and cancel clears the only active id',()=>{
  const initial=schedule();
  const moved=calendar.reschedule(initial,command('op-move',{startsAt:'2026-09-28T09:00:00+03:00',durationMinutes:30}),{now:'2026-09-27T10:05:00Z',projects:[initial]});
  assert.equal(moved.phase0.spaceCard.work.activeViewingId,'viewing-op-schedule');
  assert.equal(moved.phase0.spaceCard.work.viewings[0].startsAt,'2026-09-28T06:00:00.000Z');
  assert.equal(moved.phase0.spaceCard.work.viewings[0].endsAt,'2026-09-28T06:30:00.000Z');
  const cancelled=calendar.cancel(moved,command('op-cancel',{reason:'Арендодатель перенёс показ'}),{now:'2026-09-27T10:10:00Z'});
  assert.equal(cancelled.phase0.spaceCard.work.activeViewingId,null);
  assert.equal(cancelled.phase0.spaceCard.work.pipeline.status,'contacted');
  assert.equal(cancelled.phase0.spaceCard.work.viewings[0].status,'cancelled');
});

test('completion is explicit, after startsAt, and requires uploaded photo plus uploaded video',()=>{
  const scheduled=schedule();
  const media=[
    {id:'photo-1',kind:'photo',status:'uploaded',mimeType:'image/jpeg'},
    {id:'video-1',kind:'video',status:'uploaded',mimeType:'video/mp4'}
  ];
  assert.throws(()=>calendar.complete(scheduled,command('too-early',{confirmed:true,attachments:media}),{now:'2026-09-27T11:59:59Z'}),error=>error.code==='VIEWING_NOT_STARTED');
  assert.throws(()=>calendar.complete(scheduled,command('not-explicit',{attachments:media}),{now:'2026-09-27T12:01:00Z'}),error=>error.code==='COMPLETION_CONFIRMATION_REQUIRED');
  assert.throws(()=>calendar.complete(scheduled,command('photo-only',{confirmed:true,attachments:[media[0]]}),{now:'2026-09-27T12:01:00Z'}),error=>error.code==='VIEWING_MEDIA_REQUIRED'&&error.details.hasPhoto&&!error.details.hasVideo);
  const completed=calendar.complete(scheduled,command('complete',{confirmed:true,attachments:media}),{now:'2026-09-27T12:01:00Z'});
  assert.equal(completed.phase0.spaceCard.work.pipeline.status,'viewing_completed');
  assert.equal(completed.phase0.spaceCard.work.activeViewingId,null);
  assert.equal(completed.phase0.spaceCard.work.viewings[0].status,'completed');
  assert.equal(completed.phase0.spaceCard.work.viewings[0].attachments.filter(item=>item.status==='uploaded').length,2);
  assert.throws(()=>calendar.schedule(completed,command('second-viewing',{assignedToId:'employee-1',startsAt:'2026-09-28T12:00:00Z'}),{now:'2026-09-27T12:02:00Z',projects:[completed]}),error=>error.code==='VIEWING_ALREADY_COMPLETED');
});

test('proposal handoff and rejection close work without changing or deleting the project id',()=>{
  const scheduled=schedule();
  const completed=calendar.complete(scheduled,command('complete-terminal',{confirmed:true,attachments:[{id:'p',mimeType:'image/jpeg',status:'uploaded'},{id:'v',mimeType:'video/mp4',status:'uploaded'}]}),{now:'2026-09-27T12:10:00Z'});
  const proposal=calendar.startProposal(completed,command('proposal',{proposalId:'kp-42'}),{now:'2026-09-27T12:11:00Z'});
  assert.equal(proposal.id,'space-1');assert.equal(proposal.phase0.spaceCard.id,'space-1');
  assert.equal(proposal.phase0.spaceCard.work.status,'closed');
  assert.equal(proposal.phase0.spaceCard.work.stage,'proposal_handoff');
  assert.equal(proposal.phase0.spaceCard.work.pipeline.status,'proposal_started');
  assert.equal(calendar.isInWork(proposal),false);

  const rejected=calendar.reject(project('space-rejected'),command('reject',{reason:'not_suitable_da',comment:'Не подходит по конкурентному анализу'}),{now:AT});
  assert.equal(rejected.id,'space-rejected');assert.equal(rejected.phase0.spaceCard.id,'space-rejected');
  assert.equal(rejected.phase0.spaceCard.work.status,'closed');assert.equal(rejected.phase0.spaceCard.work.stage,'rejected');
  assert.deepEqual(rejected.phase0.spaceCard.work.rejection,{reasonCode:'not_suitable_da',comment:'Не подходит по конкурентному анализу',at:AT,actorId:'employee-1'});
  assert.deepEqual(calendar.listInWork([proposal,rejected]),[]);
});

test('landlord contact and contacted state are saved in one canonical work object',()=>{
  const contacted=calendar.markContacted(project(),command('contact',{contact:{name:'Иван Петров',phone:'+7 999 000-00-00'}}),{now:AT});
  assert.equal(contacted.phase0.spaceCard.work.pipeline.status,'contacted');
  assert.deepEqual(contacted.phase0.spaceCard.work.landlordContact,{name:'Иван Петров',phone:'+7 999 000-00-00',contactedAt:AT});
  assert.equal(contacted.phase0.spaceCard.work.operations.filter(item=>item.id==='contact').length,1);

  const scheduled=schedule(contacted);
  const updated=calendar.markContacted(scheduled,command('contact-update',{contact:{email:'owner@example.test'}}),{now:'2026-09-27T10:30:00.000Z'});
  assert.equal(updated.phase0.spaceCard.work.pipeline.status,'viewing_scheduled');
  assert.equal(updated.phase0.spaceCard.work.activeViewingId,scheduled.phase0.spaceCard.work.activeViewingId);
  assert.equal(updated.phase0.spaceCard.work.landlordContact.email,'owner@example.test');
});

test('every command is idempotent by operationId',()=>{
  const first=schedule();
  const replay=calendar.schedule(first,command('op-schedule',{assignedToId:'someone-else',startsAt:'2027-01-01T10:00:00Z'}),{now:'2027-01-01T00:00:00Z',projects:[first]});
  assert.deepEqual(replay,first);
  assert.equal(replay.phase0.spaceCard.work.viewings.length,1);
  assert.equal(replay.phase0.spaceCard.work.operations.filter(item=>item.id==='op-schedule').length,1);
});

test('due reminders are in-app records linked to the same project and can be acknowledged',()=>{
  const saved=schedule(project(),{reminderMinutesBefore:[60]});
  assert.deepEqual(calendar.getInAppReminders([saved],'2026-09-27T10:59:59Z'),[]);
  const due=calendar.getInAppReminders([saved],'2026-09-27T11:00:00Z');
  assert.equal(due.length,1);assert.equal(due[0].projectId,'space-1');assert.equal(due[0].spaceCardId,'space-1');
  const acknowledged=calendar.acknowledgeReminder(saved,command('ack',{reminderId:due[0].id}),{now:'2026-09-27T11:01:00Z'});
  assert.deepEqual(calendar.getInAppReminders([acknowledged],'2026-09-27T11:02:00Z'),[]);
});

test('service adapter writes through ProjectRepository.mutate once and skips replay writes',()=>{
  let stored=project(),writes=0;
  const repository={
    get:id=>String(id)===stored.id?structuredClone(stored):null,
    listAll:()=>[structuredClone(stored)],
    mutate:(id,mutator,expected,reason)=>{
      assert.equal(id,stored.id);assert.equal(expected,3);assert.equal(reason,'work-calendar-schedule');writes++;
      stored=mutator(structuredClone(stored));stored.phase0.revision++;return structuredClone(stored);
    }
  };
  const service=calendar.createService({projectRepository:repository,now:()=>AT,idFactory:()=> 'viewing-service'});
  const cmd=command('service-op',{assignedToId:'employee-1',startsAt:START});
  const first=service.schedule('space-1',cmd),replay=service.schedule('space-1',cmd);
  assert.equal(writes,1);assert.equal(first.phase0.spaceCard.work.activeViewingId,'viewing-service');assert.deepEqual(replay,first);
});

test('closed and terminal cards cannot be selected again and takeSpaceIntoWork has a terminal guard',()=>{
  const closed=project('closed',{status:'closed',stage:'proposal_handoff',takenAt:'2026-09-20T10:00:00Z',pipeline:{status:'proposal_started'}});
  const rejected=project('rejected',{status:'closed',stage:'rejected',takenAt:'2026-09-20T10:00:00Z',pipeline:{status:'rejected'}});
  assert.equal(cardModel.evaluate({address:'x',work:closed.phase0.spaceCard.work}).reasons.includes('already_in_work'),true);
  assert.equal(cardModel.evaluate({address:'x',work:rejected.phase0.spaceCard.work}).reasons.includes('already_in_work'),true);
  assert.deepEqual(calendar.listInWork([closed,rejected]),[]);
  const source=fs.readFileSync(path.join(ROOT,'phase0-services.js'),'utf8');
  const start=source.indexOf('  takeSpaceIntoWork(projectId)');
  const end=source.indexOf('\n  readiness(project)',start);
  const body=source.slice(start,end);
  assert.match(body,/existingWork\.takenAt/);
  assert.match(body,/\['in_work','closed'\]\.includes\(existingWork\.status\)/);
  assert.match(body,/\['proposal_handoff','rejected'\]\.includes\(existingWork\.stage\)/);
  assert.match(body,/\['proposal_started','rejected'\]\.includes\(existingPipeline\)/);
});

test('calendar domain never reuses the unrelated measurement model',()=>{
  const source=fs.readFileSync(path.join(ROOT,'work-calendar.js'),'utf8');
  assert.doesNotMatch(source,/measurement/i);
});
