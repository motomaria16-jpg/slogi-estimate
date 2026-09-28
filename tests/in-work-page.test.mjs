import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('in-work.html');
const css=read('in-work.css');
const app=read('in-work-app.js');
const calendarDomain=read('work-calendar.js');
const services=read('phase0-services.js');

test('in-work page loads the canonical data stack and keeps the Figma shell last',()=>{
  const card=html.indexOf('search-space-card.js');
  const services=html.indexOf('phase0-services.js');
  const calendar=html.indexOf('work-calendar.js');
  const page=html.indexOf('in-work-app.js');
  const shell=html.indexOf('figma-shell-v76-1-15.js');
  assert.ok(card>0&&card<services);
  assert.ok(services<calendar&&calendar<page&&page<shell);
  const styles=[...html.matchAll(/<link[^>]+href="([^"]+)"[^>]+rel="stylesheet"/g)].map(match=>match[1]);
  assert.match(styles.at(-1),/^figma-shell-v76-1-15\.css/);
});

test('list, map and calendar expose keyboard and ARIA navigation contracts',()=>{
  assert.match(html,/role="tablist"/);
  assert.match(html,/id="in-work-list-panel" role="tabpanel"/);
  assert.match(html,/id="in-work-calendar-panel" role="tabpanel"/);
  assert.match(html,/id="in-work-map" tabindex="0"/);
  assert.match(app,/\['ArrowLeft','ArrowRight'\]/);
  assert.match(app,/\['Enter',' '\]/);
  assert.match(app,/event\.key==='Escape'/);
  assert.match(app,/event\.key!=='Tab'/);
});

test('active list and map use ProjectRepository.listInWork and MapService',()=>{
  assert.match(app,/repo\.listInWork\(\)/);
  assert.match(app,/new S\.MapService\(/);
  assert.match(app,/state\.map\.setProjects\(state\.visible\)/);
  assert.match(services,/phase\.rent&&phase\.rent\.amount!=null/);
  assert.match(app,/premisesCard\.render\(/);
  assert.match(app,/'data-project-id':project\.id/);
  assert.match(app,/resolveSpaceAddress\(draft\.address,project\.id\)/,'cluster refresh must exclude the same canonical project from occupancy checks');
});

test('calendar operations are isolated behind SlogiWorkCalendar service adapter',()=>{
  assert.match(app,/window\.SlogiWorkCalendar/);
  assert.match(app,/api\.createService\(\{projectRepository:repo\}\)/);
  for(const method of ['schedule','reschedule','cancel','complete','reject','startProposal','markContacted'])assert.match(app,new RegExp(`call\\('${method}'`));
  assert.match(app,/operationId:operationId\(method\)/);
  assert.match(app,/reminderMinutesBefore/);
  assert.match(app,/assignedToId/);
});

test('refusal has only the two exact reasons and requires a comment',()=>{
  assert.match(app,/code:'not_suitable_da',label:'Не подходит ДА'/);
  assert.match(app,/code:'not_suitable_tu',label:'Не подходят ТУ'/);
  assert.doesNotMatch(app,/space_unsuitable|landlord_declined/);
  assert.match(app,/if\(!comment\)\{toast\('Комментарий к отказу обязателен\.'/);
  assert.match(app,/adapter\.reject\(project\.id,\{reasonCode:choice\.value,comment\}\)/);
  assert.match(calendarDomain,/REJECTION_REASONS\.includes\(reason\)/);
  assert.match(calendarDomain,/state\.work\.rejection=\{reasonCode:reason,comment,at,actorId:/);
  assert.doesNotMatch(app,/work-rejection-details/);
});

test('visit completion requires persisted photo and video metadata',()=>{
  assert.match(app,/`work-viewing\/\$\{viewingId\}\/\$\{kind\}\/\$\{id\}`/);
  assert.match(app,/W\.saveAttachment\(projectId,type,file,file\.name\)/);
  assert.match(app,/if\(!counts\.photo\|\|!counts\.video\)/);
  assert.match(app,/confirmed:true,attachments:counts\.items/);
  assert.match(app,/accept="image\/\*"/);
  assert.match(app,/accept="video\/\*"/);
  assert.match(app,/work-viewing-media-upload/);
  assert.match(app,/reminderMinutesBefore:reminderMinutes>0\?\[reminderMinutes\]:\[\]/);
  assert.match(app,/notifyDueReminders/);
});

test('proposal handoff keeps the canonical project id and removes terminal cards',()=>{
  assert.match(app,/const projectId=project\.id;await adapter\.startProposal\(projectId\)/);
  assert.match(app,/proposal\.html\?location=\$\{encodeURIComponent\(projectId\)\}&from=in-work/);
  assert.match(app,/work\.status==='in_work'/);
  assert.match(app,/\['proposal_handoff','rejected'\]\.includes\(work\.stage\)/);
  const handoff=app.slice(app.indexOf('async function startProposal(project)'),app.indexOf('function handleAction'));
  assert.doesNotMatch(handoff,/repo\.create|projectRepository\.create|clone\(/);
});

test('canonical card exposes the complete in-work funnel only through the in-work context',()=>{
  assert.match(app,/context:'in-work'/);
  assert.match(app,/renderWorkflow:/);
  assert.match(app,/onWorkflowAction:/);
  assert.match(app,/onWorkflowFile:/);
  assert.match(app,/workflowContent\(project\)/);
  assert.match(app,/contactForm\(project\).*viewingForm\(project\).*mediaPanel\(project\).*proposalPanel\(project\).*rejectionPanel\(project\)/s);
  assert.match(app,/Зафиксировать связь/);
  assert.match(app,/Просмотр назначен и добавлен во внутренний календарь/);
  assert.match(app,/Просмотр завершён\. Помещение готово к КП/);
  assert.match(app,/Не подходит ДА/);
  assert.match(app,/Не подходят ТУ/);
  assert.match(app,/Комментарий к отказу обязателен/);
  assert.match(app,/openCanonicalCard\(repo\.get\(calendarEvent\.dataset\.eventProject\),calendarEvent\)/);
});

test('card funnel writes to the calendar domain and canonical attachment store without copying the project',()=>{
  const workflow=app.slice(app.indexOf('async function performCardWorkflowAction'),app.indexOf('function currentProject'));
  assert.match(workflow,/adapter\.saveContact\(projectId,contact\)/);
  assert.match(workflow,/adapter\.schedule\(projectId,command\)/);
  assert.match(workflow,/adapter\.reschedule\(projectId,command\)/);
  assert.match(workflow,/adapter\.complete\(projectId,\{viewingId:viewing\.id,confirmed:true,attachments:counts\.items\}\)/);
  assert.match(workflow,/adapter\.reject\(projectId,\{reasonCode,comment\}\)/);
  assert.match(workflow,/adapter\.saveMedia\(projectId,viewing\.id,kind,file\)/);
  assert.doesNotMatch(workflow,/repo\.create|projectRepository\.create/);
});

test('responsive calendar uses desktop grids and a mobile agenda',()=>{
  assert.match(css,/\.in-work-calendar-week/);
  assert.match(css,/\.in-work-month/);
  assert.match(css,/\.in-work-agenda\{display:none\}/);
  assert.match(css,/@media\(max-width:900px\)[\s\S]+\.in-work-agenda\{display:block\}/);
  assert.match(css,/\.in-work-workspace\{display:grid/);
});
