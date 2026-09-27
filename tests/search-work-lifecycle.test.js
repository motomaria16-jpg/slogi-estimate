'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const servicesSource=read('phase0-services.js');
const workspaceSource=read('cian-workspace.js');
const cardModel=require(path.join(ROOT,'search-space-card.js'));

function readyProject(){
  return{
    id:'space-stable-1',address:'Москва, Тестовая улица, 1',area:120,ceilingHeight:3.4,
    clusterId:'cluster-1',clusterName:'Кластер 1',geo:{lat:55.75,lng:37.61},
    phase0:{revision:1,source:'manual',listingUrl:'https://example.test/listing/1',rent:{amount:360000,period:'month',currency:'RUB'},spaceCard:{
      id:'space-stable-1',source:'manual',listingUrl:'https://example.test/listing/1',address:'Москва, Тестовая улица, 1',geo:{lat:55.75,lng:37.61,resolutionSource:'manual'},
      cluster:{id:'cluster-1',name:'Кластер 1',status:'inside',matched:true,hasSlogiCenter:false,resolutionSource:'manual'},
      competitive:{rating:12,rank:12,isTop30:true,isTop35:true,averageRentPerSqm:3000,resolutionSource:'manual'},
      rentMonthly:360000,area:120,areaConfirmed:true,separateEntrance:true,hasWindows:true,windowsOpen:true,ceilingHeight:3.4,ceilingHeightConfirmed:true,repair:'finished',work:{}
    }}
  };
}

function harness(projects){
  let locations=JSON.parse(JSON.stringify(projects));
  const sharedState={settings:{}};
  const window={
    SlogiPro:{readLocations:()=>JSON.parse(JSON.stringify(locations)),writeLocations:items=>{locations=JSON.parse(JSON.stringify(items));},read:()=>sharedState,write:()=>{},actor:()=> 'lifecycle-test',uid:prefix=>`${prefix}-test`,activity:()=>{}},
    SlogiWorkflow:{},SlogiSearchSpaceCard:cardModel,SLOGI_PHASE0_CONFIG:{competitiveAnalysis:{provider:'none',cacheSchemaVersion:1}},SLOGI_CLUSTERS_GEOJSON:{type:'FeatureCollection',features:[]}
  };
  vm.runInNewContext(servicesSource,{window,URL,AbortController,setTimeout,clearTimeout,console},{filename:'phase0-services.js'});
  return{api:window.SlogiPhase0,locations:()=>JSON.parse(JSON.stringify(locations))};
}

test('one canonical project moves from search to active work without copying or changing its id',()=>{
  const initial=readyProject(),h=harness([initial]),repo=h.api.projectRepository;
  assert.deepEqual(repo.listSearchCandidates().map(item=>item.id),['space-stable-1']);
  assert.deepEqual(repo.listInWork().map(item=>item.id),[]);

  const moved=h.api.phase0Service.takeSpaceIntoWork(initial.id);

  assert.equal(moved.id,initial.id);
  assert.equal(moved.phase0.spaceCard.id,initial.id);
  assert.equal(moved.address,initial.address);
  assert.equal(moved.phase0.listingUrl,initial.phase0.listingUrl);
  assert.equal(moved.phase0.spaceCard.work.status,'in_work');
  assert.deepEqual(repo.listSearchCandidates().map(item=>item.id),[]);
  assert.deepEqual(repo.listInWork().map(item=>item.id),['space-stable-1']);
  assert.equal(h.locations().length,1,'transition must mutate the canonical project instead of creating a copy');
});

test('terminal work states never leak back into search or the active work list',()=>{
  const rejected=readyProject();rejected.id='rejected-1';rejected.phase0.spaceCard.id=rejected.id;rejected.phase0.spaceCard.work={status:'closed',stage:'rejected',takenAt:'2026-09-20T10:00:00.000Z',pipeline:{status:'rejected'}};
  const proposal=readyProject();proposal.id='proposal-1';proposal.phase0.spaceCard.id=proposal.id;proposal.phase0.spaceCard.work={status:'closed',stage:'proposal_handoff',takenAt:'2026-09-20T10:00:00.000Z',pipeline:{status:'proposal_started'}};
  const h=harness([rejected,proposal]);
  assert.deepEqual(h.api.projectRepository.listSearchCandidates(),[]);
  assert.deepEqual(h.api.projectRepository.listInWork(),[]);
  assert.equal(h.api.spaceLifecycle.hasLeftSearch(rejected),true);
  assert.equal(h.api.spaceLifecycle.hasLeftSearch(proposal),true);
});

test('search list, map and background geocoding share the search-candidate selector and rerender on storage events',()=>{
  assert.match(workspaceSource,/function searchableFeedListings\(\)/);
  assert.match(workspaceSource,/collectProjectGeocodeTargets\(searchableFeedListings\(\),storedProjects\(\)/);
  assert.match(workspaceSource,/if\(isSearchCandidateProject\(project\)\)items\.push\(projectToItem\(project,listing\)\)/);
  assert.match(workspaceSource,/function render\(\)[\s\S]*updateMap\(items\)/);
  assert.match(workspaceSource,/takeSpaceIntoWork\(saved\.id\)[\s\S]*render\(\)/);
  assert.match(workspaceSource,/addEventListener\('slogi:locations-updated',[^\n]+render\(\)/);
  assert.doesNotMatch(workspaceSource,/location\.reload\s*\(/);
});
