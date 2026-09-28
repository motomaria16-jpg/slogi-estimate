import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const modal=read('search-space-card-modal.js');
const css=read('search-space-card-modal.css');
const search=read('cian-workspace.js');
const work=read('in-work-app.js');
const searchPage=read('available-spaces.html');
const workPage=read('in-work.html');

test('every active entry point opens the same canonical card renderer',()=>{
  assert.equal((modal.match(/<dialog\b/g)||[]).length,1);
  for(const page of [searchPage,workPage]){
    assert.equal((page.match(/search-space-card-modal\.js/g)||[]).length,1);
    assert.equal((page.match(/search-space-card-modal\.css/g)||[]).length,1);
  }
  assert.match(search,/function openListing[\s\S]+spaceCardModal\.open\(\{initial:item\._card\|\|cardForListing\(item\)/);
  assert.match(search,/function openManualSpace[\s\S]+spaceCardModal\.open\(\{initial/);
  assert.match(work,/function openManualWorkSpace[\s\S]+spaceCardModal\.open\(\{initial,opener,context:'in-work'/);
  assert.match(work,/function openCanonicalCard[\s\S]+spaceCardModal\.open\(\{initial:canonicalCard\(project\),opener,context:'in-work'/);
  assert.match(work,/onSelect:id=>\{selectProject\(id\);openCanonicalCard/);
  assert.match(work,/openCanonicalCard\(repo\.get\(calendarEvent\.dataset\.eventProject\),calendarEvent\)/);
});

test('the compact card exposes the complete canonical data inventory once',()=>{
  const controls=['address','listingUrl','latitudeManual','longitudeManual','clusterNameManual','centerDetailsManual','clusterRankManual','clusterRatingManual','rentMonthly','area','pricePerSqm','averageRentManual','comparisonPercent','ceilingHeight','repair'];
  for(const name of controls)assert.equal((modal.match(new RegExp(`name="${name}"`,'g'))||[]).length,1,name);
  const radios={clusterStatusManual:2,hasSlogiCenterManual:2,areaConfirmed:2,separateEntrance:2,hasWindows:2,windowsOpen:2,ceilingHeightConfirmed:2};
  for(const [name,count] of Object.entries(radios))assert.equal((modal.match(new RegExp(`choice\\('${name}'`,'g'))||[]).length,count,name);
  for(const field of ['sourceProvider','centerDetails','rating','rank','averageRentPerSqm','comparisonPercentOverride','pricePerSqmOverride','areaConfirmedSource','resolutionSource','work'])assert.match(modal,new RegExp(field));
  assert.match(modal,/data-origin="coordinates"/);
  assert.match(modal,/data-origin="cluster"/);
  assert.match(modal,/data-origin="competitive"/);
});

test('three compact tabs, fixed shell and responsive card keep the approved interaction contract',()=>{
  assert.match(modal,/role="tablist"/);
  for(const tab of ['object','workflow','history']){
    assert.match(modal,new RegExp(`role="tab"[^>]+aria-controls="ss-card-panel-${tab}"[^>]+data-card-tab="${tab}"`));
    assert.match(modal,new RegExp(`role="tabpanel"[^>]+aria-labelledby="ss-card-tab-${tab}"[^>]+data-card-panel="${tab}"`));
  }
  assert.doesNotMatch(modal,/data-card-tab="selection"|>Отбор<|data-selection-detail/);
  assert.match(modal,/\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/);
  assert.match(css,/\.ss-card-form \{[^}]*height: 100%/);
  assert.match(css,/\.ss-card-body \{[^}]*overflow: auto/);
  assert.match(css,/\.ss-card-footer \{[^}]*flex: 0 0 auto/);
  assert.match(css,/\.ss-card-layout \{[^}]*grid-template-columns: minmax\(0,1fr\) 278px/);
  assert.match(css,/\.ss-card-columns \{[^}]*grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.ss-card-context \{[^}]*align-self: start/);
  assert.match(css,/\.ss-card-workflow-content \{[^}]*grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.ss-card-layout\.ss-card-layout-full \{[^}]*grid-template-columns: minmax\(0,1fr\)/);
  assert.match(css,/\.ss-card-workflow-content \.in-work-field[^}]*grid-template-columns: 108px minmax\(0,1fr\)/);
  assert.match(css,/@media \(max-width: 820px\)[\s\S]+\.ss-card-layout \{ grid-template-columns: 1fr/);
  assert.match(css,/:focus-visible/);
});

test('the complete funnel remains wired to the same id and keeps four stable workflow panels',()=>{
  for(const value of ['contactName','contactPhone','contactEmail','startsAt','assignedToId','reminderMinutesBefore','viewingPhoto','viewingVideo','rejectionReason','rejectionComment'])assert.match(work,new RegExp(`name="${value}"`));
  for(const action of ['save-contact','save-visit','cancel-visit','complete-visit','delete-media','confirm-reject','start-proposal'])assert.match(work,new RegExp(`data-action="${action}"`));
  for(const panel of ['contact','viewing','media','decision'])assert.equal((work.match(new RegExp(`data-workflow-panel="${panel}"`,'g'))||[]).length,1,panel);
  assert.match(work,/historyHtml:timelinePanel\(project\)/);
  assert.match(work,/sidebarHtml:''/);
  assert.doesNotMatch(work,/function workflowSidebar|>Следующее действие</);
  assert.match(work,/adapter\.saveMedia\(projectId,viewing\.id,kind,file\)/);
  assert.match(work,/adapter\.complete\(projectId,\{viewingId:viewing\.id,confirmed:true,attachments:counts\.items\}\)/);
  assert.match(work,/adapter\.reject\(projectId,\{reasonCode,comment\}\)/);
  assert.match(work,/const projectId=project\.id;await adapter\.startProposal\(projectId\)/);
  const cardFlow=work.slice(work.indexOf('function openCanonicalCard'),work.indexOf('function currentProject'));
  assert.doesNotMatch(cardFlow,/repo\.create|projectRepository\.create|clone\(/);
});

test('workflow rerenders preserve dirty controls, scroll and focus',()=>{
  assert.match(modal,/function captureWorkflowUi\(\)/);
  assert.match(modal,/function restoreWorkflowUi\(snapshot\)/);
  assert.match(modal,/scrollTop: body \? body\.scrollTop : 0/);
  assert.match(modal,/focus\(\{ preventScroll: true \}\)/);
  const action=modal.slice(modal.indexOf('async function runWorkflowAction'),modal.indexOf('async function runWorkflowFile'));
  assert.doesNotMatch(action,/state\.busy = `workflow-[^\n]+\n\s*render\(\)/);
  assert.match(action,/restoreWorkflowUi\(ui\)/);
});

