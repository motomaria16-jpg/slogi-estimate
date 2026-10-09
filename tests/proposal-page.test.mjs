import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('proposal.html'),app=read('proposal-app.js'),documentBuilder=read('proposal-document.js'),shell=read('figma-shell-v76-1-15.js'),navigation=read('fast-navigation.js');
const require=createRequire(import.meta.url),documentApi=require(path.join(root,'proposal-document.js'));

test('KP page uses the persistent platform shell and the canonical card',()=>{
  assert.match(html,/id="proposal-main"/);
  assert.match(html,/fast-navigation\.js/);
  assert.match(html,/search-space-card-modal\.js/);
  assert.match(html,/work-calendar\.js/);
  assert.match(html,/in-work-app\.js/);
  assert.match(html,/proposal-stage\.js/);
  assert.match(html,/proposal-app\.js/);
  assert.match(shell,/{id:'kp',href:'proposal\.html'/);
  assert.match(navigation,/\['available-spaces\.html','in-work\.html','proposal\.html'\]/);
  assert.match(app,/context:'proposal',initialTab:'proposal',renderWorkflow:/);
  assert.match(app,/renderCardWorkflow\(current\)/);
  assert.match(app,/onWorkflowAction:/);
  assert.match(app,/onWorkflowAction:[^\n]+preserveProposalStage:true/);
  assert.match(app,/onWorkflowFile:/);
  assert.match(app,/renderProposal:/);
  assert.match(app,/onProposalAction:/);
  assert.doesNotMatch(app,/initialTab:'workflow'/);
});

test('KP workflow keeps all requested fields, source-quality Word document, lease, email and sent action',()=>{
  assert.match(app,/name="rentFreeDays"/);
  assert.match(app,/name="baseRentRate"/);
  assert.match(app,/name="discountRentRate"/);
  assert.match(app,/name="discountPeriodDays"/);
  assert.match(app,/Базовая арендная ставка, ₽\/м²\/мес\./);
  assert.match(app,/Ставка на льготный период, ₽\/м²\/мес\./);
  assert.match(app,/Срок льготного периода, дней/);
  assert.match(app,/prepare-proposal/);
  assert.match(app,/proposal-docx/);
  assert.match(app,/download-docx/);
  assert.match(app,/KP_Slogi_template\.docx/);
  assert.doesNotMatch(app,/download-pdf|proposal-pdf/);
  assert.match(app,/lease-agreement-template\.docx/);
  assert.match(app,/name="emailBody"/);
  assert.match(app,/data-action="mark-sent"/);
  assert.match(app,/24\*60\*60\*1000/);
});

test('the original DOCX template and browser ZIP runtime are packaged',()=>{
  assert.equal(fs.existsSync(path.join(root,'KP_Slogi_template.docx')),true);
  assert.ok(fs.statSync(path.join(root,'KP_Slogi_template.docx')).size>20000);
  assert.match(html,/pako-inflate\.min\.js/);
  assert.match(html,/office-zip\.js/);
  assert.match(documentBuilder,/word\/document\.xml/);
  assert.match(documentBuilder,/function docxBlob/);
});

test('lease agreement is a packaged attachment',()=>{
  assert.equal(fs.existsSync(path.join(root,'lease-agreement-template.docx')),true);
  assert.ok(fs.statSync(path.join(root,'lease-agreement-template.docx')).size>100000);
});

test('Word template filling escapes values and replaces every expected marker exactly once',()=>{
  const paragraphs=Array.from({length:55},(_,index)=>index===9?'Москва & область <объект>':`Значение ${index}`);
  const xml=`<w:document>${paragraphs.map((_value,index)=>`<w:p><w:r><w:t>[[SLOGI_P_${index}]]</w:t></w:r></w:p>`).join('')}</w:document>`;
  const filled=documentApi.fillTemplateXml(xml,paragraphs);
  assert.match(filled,/Москва &amp; область &lt;объект&gt;/);
  assert.doesNotMatch(filled,/\[\[SLOGI_P_/);
  assert.throws(()=>documentApi.fillTemplateXml(xml.replace('[[SLOGI_P_54]]',''),paragraphs),/SLOGI_P_54/);
});
