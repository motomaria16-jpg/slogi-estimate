'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const stage=require('../proposal-stage.js');

const project=()=>({id:'space-1',address:'Москва, Тверская улица, 1',phase0:{revision:4,spaceCard:{id:'space-1',work:{status:'closed',stage:'proposal_handoff',pipeline:{status:'proposal_started',proposalStartedAt:'2026-10-07T09:00:00.000Z'},landlordContact:{name:'Иван'}}}}});
const terms={rentFreeDays:45,baseRentRate:5000,discountRentRate:3500,discountPeriodDays:120,emailSubject:'Тема',emailBody:'Письмо',pdfName:'КП.pdf'};

test('proposal stage recognizes the canonical card without copying it',()=>{
  const source=project();
  assert.equal(stage.isProposalProject(source),true);
  assert.equal(stage.proposalOf(source).status,'draft');
});

test('all four commercial terms are validated',()=>{
  assert.equal(stage.validateTerms(terms).valid,true);
  assert.match(stage.validateTerms({...terms,rentFreeDays:''}).errors[0],/каникулы/);
  assert.match(stage.validateTerms({...terms,discountRentRate:6000}).errors[0],/не должна превышать/);
});

test('prepared proposal becomes sent and produces a 24-hour follow-up task',()=>{
  const prepared=stage.prepare(project(),terms,{now:'2026-10-07T10:00:00.000Z'}),sent=stage.markSent(prepared,{followUpTaskId:'task-1'},{now:'2026-10-07T11:00:00.000Z'}),proposal=stage.proposalOf(sent),task=stage.followUpTask(sent,proposal);
  assert.equal(proposal.status,'sent');
  assert.equal(proposal.followUpDueAt,'2026-10-08T11:00:00.000Z');
  assert.equal(task.id,'task-1');
  assert.equal(task.projectId,'space-1');
  assert.equal(task.type,'proposal_follow_up');
});

test('email draft identifies the selected premises',()=>{
  const draft=stage.emailDraft(project(),{name:'Иван'});
  assert.match(draft.subject,/Тверская/);
  assert.match(draft.body,/Здравствуйте, Иван/);
  assert.match(draft.body,/типовой проект договора аренды/);
});
