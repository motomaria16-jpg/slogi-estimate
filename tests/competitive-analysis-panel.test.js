'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');

test('search page owns the visible competitive-analysis entry and loads the existing XLSX workflow before services',()=>{
  const search=read('available-spaces.html'),premises=read('index.html');
  assert.match(search,/id="available-open-competitive"[^>]*>Конкурентный анализ</);
  const pako=search.indexOf('pako-inflate.min.js'),xlsx=search.indexOf('xlsx-workflow.js'),services=search.indexOf('phase0-services.js'),panel=search.indexOf('competitive-analysis-panel.js'),workspace=search.indexOf('cian-workspace.js');
  assert.ok(pako>=0&&xlsx>pako&&services>xlsx&&panel>services&&workspace>panel);
  assert.doesNotMatch(premises,/id="phase0-open-competitive"|id="phase0-sync-strip"/);
  assert.match(premises,/competitive-analysis-panel\.js/);
});

test('shared panel uses only the canonical repository and recalculates cards before cloud synchronization',()=>{
  const source=read('competitive-analysis-panel.js'),workspace=read('cian-workspace.js'),phaseApp=read('phase0-app.js');
  assert.match(source,/repo\.importFile\(file\)/);
  assert.match(source,/service\.applyCompetitiveRows\(snapshot\)/);
  const apply=source.indexOf('service.applyCompetitiveRows(snapshot)'),emit=source.indexOf('emitUpdated(snapshot,changes)',apply),sync=source.indexOf("await window.SlogiCloud.sync()",apply);
  assert.ok(apply>=0&&emit>apply&&sync>emit,'local recalculation and UI event must precede cloud sync');
  assert.match(source,/slogi:competitive-analysis-updated/);
  assert.match(workspace,/competitivePanel\.init\(\{trigger:'#available-open-competitive',onUpdated:\(\)=>render\(\),toast\}\)/);
  assert.match(phaseApp,/panel\.open\(\{cluster,opener:document\.activeElement\}\)/);
  assert.doesNotMatch(phaseApp,/function competitiveTableHtml|function syncCompetitive|competitive\.importFile/);
});

test('panel retains dialog accessibility, dismiss paths, filter and complete source table',()=>{
  const source=read('competitive-analysis-panel.js');
  assert.match(source,/role="dialog" aria-modal="true" aria-labelledby="phase0-competitive-title" aria-describedby="phase0-competitive-description"/);
  assert.match(source,/if\(event\.key==='Escape'\)[\s\S]*close\(\)/);
  assert.match(source,/event\.target===state\.overlay/);
  assert.match(source,/state\.lastFocused[\s\S]*target\.focus\(\)/);
  assert.match(source,/id="phase0-competitive-filter"/);
  assert.match(source,/<button class="phase0-btn small phase0-file-button" id="phase0-competitive-file-trigger" type="button"/);
  assert.match(source,/fileTrigger\.addEventListener\('click',\(\)=>input\.click\(\)\)/);
  assert.doesNotMatch(source,/<label class="phase0-btn small phase0-file-button"/);
  assert.match(source,/phase0-competitive-source-table/);
  assert.match(source,/columns\.map\(column=>/);
});

test('competitive repository rehydrates a remote workspace cache but preserves an active import',()=>{
  const shared={settings:{phase0CompetitiveAnalysis:{cacheSchemaVersion:1,rows:[{clusterId:'a',clusterName:'А'}],columns:['A'],columnSchema:null,lastSuccess:'2026-09-01T10:00:00.000Z',version:'1',source:'manualXlsx',sheetName:'Свод',fileName:'first.xlsx'}}};
  const window={
    SlogiPro:{read:()=>shared,write:()=>{},readLocations:()=>[],writeLocations:()=>{},actor:()=>({id:'test'}),uid:prefix=>prefix+'-1',activity:()=>{}},
    SlogiWorkflow:{},SLOGI_PHASE0_CONFIG:{competitiveAnalysis:{provider:'none',cacheSchemaVersion:1}},SLOGI_CLUSTERS_GEOJSON:{type:'FeatureCollection',features:[]}
  };
  vm.runInNewContext(read('phase0-services.js'),{window,URL,AbortController,setTimeout,clearTimeout,console},{filename:'phase0-services.js'});
  const repository=window.SlogiPhase0.competitiveRepository;
  assert.equal(repository.snapshot().rows[0].clusterId,'a');
  shared.settings.phase0CompetitiveAnalysis.rows=[{clusterId:'b',clusterName:'Б'}];shared.settings.phase0CompetitiveAnalysis.fileName='remote.xlsx';
  assert.equal(repository.rehydrate().rows[0].clusterId,'b');assert.equal(repository.snapshot().fileName,'remote.xlsx');
  repository.state={status:'loading',rows:[{clusterId:'local'}],lastSuccess:'',columns:[],columnSchema:null,error:'',source:'',sheetName:'Свод',sourceUrl:'',fileName:''};
  shared.settings.phase0CompetitiveAnalysis.rows=[{clusterId:'remote-during-import'}];
  assert.equal(repository.rehydrate().rows[0].clusterId,'local');assert.equal(repository.snapshot().status,'loading');
});
