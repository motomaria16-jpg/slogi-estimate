import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('proposal.html'),app=read('proposal-app.js'),documentBuilder=read('proposal-document.js'),shell=read('figma-shell-v76-1-15.js'),navigation=read('fast-navigation.js');

test('KP page uses the persistent platform shell and the canonical card',()=>{
  assert.match(html,/id="proposal-main"/);
  assert.match(html,/fast-navigation\.js/);
  assert.match(html,/search-space-card-modal\.js/);
  assert.match(html,/proposal-stage\.js/);
  assert.match(html,/proposal-app\.js/);
  assert.match(shell,/{id:'kp',href:'proposal\.html'/);
  assert.match(navigation,/\['available-spaces\.html','in-work\.html','proposal\.html'\]/);
});

test('KP workflow keeps all requested fields, PDF, lease, email and sent action',()=>{
  assert.match(app,/name="rentFreeDays"/);
  assert.match(app,/name="baseRentRate"/);
  assert.match(app,/name="discountRentRate"/);
  assert.match(app,/name="discountPeriodDays"/);
  assert.match(app,/prepare-proposal/);
  assert.match(app,/proposal-pdf/);
  assert.match(app,/lease-agreement-template\.docx/);
  assert.match(app,/name="emailBody"/);
  assert.match(app,/data-action="mark-sent"/);
  assert.match(app,/24\*60\*60\*1000/);
});

test('lease agreement is a packaged attachment',()=>{
  assert.equal(fs.existsSync(path.join(root,'lease-agreement-template.docx')),true);
  assert.ok(fs.statSync(path.join(root,'lease-agreement-template.docx')).size>100000);
});

test('browser PDF rendering is self-contained and export-safe',()=>{
  assert.match(documentBuilder,/function drawPdfPage\(page\)/);
  assert.match(documentBuilder,/canvasJpeg\(drawPdfPage\(page\)\)/);
  assert.doesNotMatch(documentBuilder,/<foreignObject|drawImage\(/);
});
