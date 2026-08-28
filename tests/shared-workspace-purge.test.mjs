import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const coreSource=await readFile(join(root,'professional-core.js'),'utf8');
const sharedSource=await readFile(join(root,'shared-workspace.js'),'utf8');
const SESSION_KEY='slogi_anonymous_session_v1';
const GRANT_KEY='slogi_device_grant_v1';
const LOCATIONS_KEY='slogi_locations_v1';
const WORKFLOW_KEY='slogi_professional_state_v2';
const CONFLICT_KEY='slogi_shared_workspace_conflict_v1';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const jsonResponse=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});

function storageClass(){
  return class MemoryStorage{
    constructor(seed={}){this.values=new Map(Object.entries(seed).map(([key,value])=>[key,String(value)]));}
    getItem(key){return this.values.has(String(key))?this.values.get(String(key)):null;}
    setItem(key,value){this.values.set(String(key),String(value));}
    removeItem(key){this.values.delete(String(key));}
    clear(){this.values.clear();}
  };
}

function workflowState(trash=[]){return{trash:{projects:trash},activity:[],notifications:[]};}
function project(id,{deleted=true,source='cian'}={}){
  return{id,address:`Synthetic ${id}`,createdAt:'2026-08-24T19:00:00.000Z',...(deleted?{deletedAt:'2026-08-24T19:01:00.000Z'}:{}),phase0:{source,externalId:`external-${id}`}};
}

function coreHarness({locations=[],workspace=workflowState()}={}){
  const Storage=storageClass();
  const localStorage=new Storage({[LOCATIONS_KEY]:JSON.stringify(locations),[WORKFLOW_KEY]:JSON.stringify(workspace)});
  const events=[];
  const window={dispatchEvent:event=>events.push(event),SlogiCloud:null};
  const context=vm.createContext({window,localStorage,Storage,CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},Date,Math,JSON,Set,String,Number,Array,Object,Boolean,RegExp});
  vm.runInContext(coreSource,context,{filename:'professional-core.js'});
  return{P:window.SlogiPro,localStorage,events};
}

function fakeDocument(){
  const nodes=new Map();
  let domReady=null;
  const makeNode=tag=>({tagName:String(tag).toUpperCase(),id:'',className:'',textContent:'',dataset:{},style:{},setAttribute(){},appendChild(child){if(child&&child.id)nodes.set(child.id,child);return child;},querySelector(){return null;}});
  const head=makeNode('head'),body=makeNode('body');
  head.appendChild=body.appendChild=function(child){if(child&&child.id)nodes.set(child.id,child);return child;};
  return{
    document:{readyState:'loading',documentElement:{setAttribute(){}},head,body,getElementById:id=>nodes.get(String(id))||null,createElement:makeNode,addEventListener(type,handler){if(type==='DOMContentLoaded')domReady=handler;}},
    fireReady(){if(!domReady)throw new Error('DOMContentLoaded handler missing');domReady();},
  };
}

async function sharedHarness({remoteState,revision=7,rpc='ok',winnerState={locations:[],workspace:workflowState()}}){
  const Storage=storageClass();
  const session={access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'fixture-user',is_anonymous:true}};
  const grant={grant:'fixture-device-grant',expiresAt:new Date(Date.now()+86400000).toISOString(),version:1};
  const localStorage=new Storage({[SESSION_KEY]:JSON.stringify(session),[GRANT_KEY]:JSON.stringify(grant),[LOCATIONS_KEY]:'[]',[WORKFLOW_KEY]:JSON.stringify(workflowState())});
  const events=[];
  const documentHarness=fakeDocument();
  let stateReads=0,rpcCalls=0,capturedState=null;
  const fetch=async(input,init={})=>{
    const url=String(input);
    if(url.endsWith('/auth/v1/user'))return jsonResponse({id:'fixture-user',is_anonymous:true});
    if(url.endsWith('/functions/v1/password-gate'))return jsonResponse({status:'granted',expiresAt:grant.expiresAt,version:1});
    if(url.includes('/slogi_shared_workspace_members?'))return jsonResponse([{workspace_id:'fixture-workspace'}]);
    if(url.includes('/slogi_shared_workspace_state?')){
      const state=stateReads++===0?remoteState:winnerState;
      return jsonResponse([{state,revision:stateReads===1?revision:revision+1,updated_at:'2026-08-24T19:02:00.000Z'}]);
    }
    if(url.endsWith('/rest/v1/rpc/slogi_update_shared_workspace_state')){
      rpcCalls++;
      capturedState=JSON.parse(String(init.body||'{}')).p_state;
      if(rpc==='conflict')return jsonResponse({code:'PT409',message:'workspace_revision_conflict'},409);
      return jsonResponse([{workspace_id:'fixture-workspace',state:capturedState,revision:revision+1,updated_at:'2026-08-24T19:02:00.000Z'}]);
    }
    throw new Error(`unexpected fetch ${new URL(url).pathname}`);
  };
  const window={
    SLOGI_PHASE0_CONFIG:{supabase:{url:'https://fixture.supabase.co',publishableKey:'fixture-publishable-key-with-safe-length'},sharedWorkspace:{passwordGateEndpoint:'https://fixture.supabase.co/functions/v1/password-gate',grantStorageKey:GRANT_KEY}},
    location:{hash:'',pathname:'/',search:'',href:'https://fixture.local/'},
    history:{state:null,replaceState(){}},
    fetch,
    dispatchEvent:event=>events.push(event),
  };
  const context=vm.createContext({window,document:documentHarness.document,localStorage,Storage,CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},fetch,Response,Headers,Request,URL,Date,Math,JSON,Set,String,Number,Array,Object,Boolean,RegExp,encodeURIComponent,setTimeout,clearTimeout});
  vm.runInContext(coreSource,context,{filename:'professional-core.js'});
  vm.runInContext(sharedSource,context,{filename:'shared-workspace.js'});
  documentHarness.fireReady();
  for(let i=0;i<40&&!window.SlogiCloud.ready;i++)await wait(10);
  assert.equal(window.SlogiCloud.ready,true,'shared workspace did not initialize');
  return{P:window.SlogiPro,cloud:window.SlogiCloud,localStorage,events,get rpcCalls(){return rpcCalls;},get capturedState(){return capturedState;}};
}

async function initializationRaceHarness({seed,remoteState,revision,mutate}){
  const Storage=storageClass();
  const grant={grant:'fixture-device-grant',expiresAt:new Date(Date.now()+86400000).toISOString(),version:1};
  const localStorage=new Storage({...seed,[GRANT_KEY]:JSON.stringify(grant)});
  const documentHarness=fakeDocument();
  let releaseState,markStateReadStarted,markReady;
  const stateReadStarted=new Promise(resolve=>{markStateReadStarted=resolve;});
  const stateRelease=new Promise(resolve=>{releaseState=resolve;});
  const readyObserved=new Promise(resolve=>{markReady=resolve;});
  let rpcCalls=0,captured=null;
  const events=[];
  const fetch=async(input,init={})=>{
    const url=String(input);
    if(url.endsWith('/auth/v1/user'))return jsonResponse({id:'fixture-user',is_anonymous:true});
    if(url.endsWith('/functions/v1/password-gate'))return jsonResponse({status:'granted',expiresAt:grant.expiresAt,version:1});
    if(url.includes('/slogi_shared_workspace_members?'))return jsonResponse([{workspace_id:'fixture-workspace'}]);
    if(url.includes('/slogi_shared_workspace_state?')){
      markStateReadStarted();
      await stateRelease;
      return jsonResponse([{state:remoteState,revision,updated_at:'2026-08-24T19:03:00.000Z'}]);
    }
    if(url.endsWith('/rest/v1/rpc/slogi_update_shared_workspace_state')){
      rpcCalls++;
      captured=JSON.parse(String(init.body||'{}'));
      return jsonResponse([{workspace_id:'fixture-workspace',state:captured.p_state,revision:revision+1,updated_at:'2026-08-24T19:04:00.000Z'}]);
    }
    throw new Error(`unexpected fetch ${new URL(url).pathname}`);
  };
  const window={
    SLOGI_PHASE0_CONFIG:{supabase:{url:'https://fixture.supabase.co',publishableKey:'fixture-publishable-key-with-safe-length'},sharedWorkspace:{passwordGateEndpoint:'https://fixture.supabase.co/functions/v1/password-gate',grantStorageKey:GRANT_KEY}},
    location:{hash:'',pathname:'/',search:'',href:'https://fixture.local/'},
    history:{state:null,replaceState(){}},
    fetch,
    dispatchEvent:event=>{events.push(event);if(event.type==='slogi:shared-workspace-ready')markReady();},
  };
  const context=vm.createContext({window,document:documentHarness.document,localStorage,Storage,CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},fetch,Response,Headers,Request,URL,Date,Math,JSON,Set,String,Number,Array,Object,Boolean,RegExp,encodeURIComponent,setTimeout,clearTimeout});
  vm.runInContext(coreSource,context,{filename:'professional-core.js'});
  vm.runInContext(sharedSource,context,{filename:'shared-workspace.js'});
  documentHarness.fireReady();
  await stateReadStarted;
  await mutate(window.SlogiPro);
  releaseState();
  await readyObserved;
  return{localStorage,events,get rpcCalls(){return rpcCalls;},get captured(){return captured;}};
}

test('soft delete keeps the object recoverable in trash',()=>{
  const item=project('one',{deleted:false});
  const harness=coreHarness({locations:[item]});
  harness.P.softDeleteProject(item);
  assert.equal(harness.P.read().trash.projects.length,1);
  assert.equal(harness.P.read().trash.projects[0].id,'one');
  assert.deepEqual(harness.P.readLocations().map(value=>value.id),['one']);
});

test('purge one physically removes only the trashed location',()=>{
  const one=project('one'),two=project('two'),active=project('active',{deleted:false});
  const harness=coreHarness({locations:[one,two,active],workspace:workflowState([one,two])});
  assert.equal(harness.P.purgeProject('one'),true);
  assert.deepEqual(harness.P.readLocations().map(value=>value.id),['two','active']);
  assert.deepEqual(harness.P.read().trash.projects.map(value=>value.id),['two']);
  assert.equal(harness.events.some(event=>event.type==='slogi:locations-updated'&&event.detail.reason==='project-purge'),true);
  assert.equal(harness.P.purgeProject('active'),false,'an active object must never be purged');
});

test('purge all removes all trashed locations and preserves active locations',()=>{
  const one=project('one'),two=project('two'),active=project('active',{deleted:false});
  const harness=coreHarness({locations:[one,two,active],workspace:workflowState([one,two])});
  assert.equal(harness.P.purgeAllProjects(),2);
  assert.deepEqual(harness.P.readLocations().map(value=>value.id),['active']);
  assert.deepEqual(harness.P.read().trash.projects,[]);
  const reloaded=coreHarness({locations:JSON.parse(harness.localStorage.getItem(LOCATIONS_KEY)),workspace:JSON.parse(harness.localStorage.getItem(WORKFLOW_KEY))});
  assert.deepEqual(reloaded.P.readLocations().map(value=>value.id),['active'],'purged objects must not resurrect after reload');
  assert.deepEqual(reloaded.P.read().trash.projects,[]);
});

test('purge is persisted by shared CAS and becomes cross-session source of truth',async()=>{
  const one=project('one');
  const remote={locations:[one],workspace:workflowState([one])};
  const first=await sharedHarness({remoteState:remote});
  assert.equal(first.P.purgeProject('one'),true);
  await wait(900);
  assert.equal(first.rpcCalls,1);
  assert.deepEqual(first.capturedState.locations,[]);
  assert.deepEqual(first.capturedState.workspace.trash.projects,[]);
  const second=await sharedHarness({remoteState:first.capturedState,revision:8});
  assert.deepEqual(JSON.parse(second.localStorage.getItem(LOCATIONS_KEY)),[]);
  assert.deepEqual(JSON.parse(second.localStorage.getItem(WORKFLOW_KEY)).trash.projects,[]);
});

test('PT409 preserves winner state, keeps a conflict draft and does not retry flood',async()=>{
  const one=project('one');
  const winner={locations:[project('winner',{deleted:false})],workspace:workflowState()};
  const harness=await sharedHarness({remoteState:{locations:[one],workspace:workflowState([one])},rpc:'conflict',winnerState:winner});
  assert.equal(harness.P.purgeProject('one'),true);
  await wait(900);
  assert.equal(harness.rpcCalls,1);
  assert.deepEqual(JSON.parse(harness.localStorage.getItem(LOCATIONS_KEY)).map(value=>value.id),['winner']);
  assert.ok(harness.localStorage.getItem(CONFLICT_KEY),'losing state must be retained as a conflict draft');
  assert.equal(harness.events.filter(event=>event.type==='slogi:workspace-conflict').length,1);
  await wait(800);
  assert.equal(harness.rpcCalls,1,'revision conflict must not cause an automatic retry flood');
});

test('soft delete after one PT409 reconciliation is not lost during reload initialization',async()=>{
  const stale=project('stale',{deleted:false});
  const winner=project('winner',{deleted:false});
  const winnerState={locations:[winner],workspace:workflowState()};
  const conflicted=await sharedHarness({
    remoteState:{locations:[stale],workspace:workflowState()},
    revision:7,
    rpc:'conflict',
    winnerState,
  });
  const changed=conflicted.P.read();
  changed.notifications.push({id:'stale-change'});
  conflicted.P.write(changed,'controlled-stale-writer');
  assert.equal(await conflicted.cloud.sync(),false);
  assert.equal(conflicted.rpcCalls,1,'the controlled stale writer must receive exactly one PT409');
  assert.deepEqual(JSON.parse(conflicted.localStorage.getItem(LOCATIONS_KEY)).map(value=>value.id),['winner']);
  assert.ok(conflicted.localStorage.getItem(CONFLICT_KEY),'the PT409 loser must retain a conflict draft');

  const seed={};
  for(const key of [SESSION_KEY,LOCATIONS_KEY,WORKFLOW_KEY,'slogi_shared_workspace_cache_v1',CONFLICT_KEY]){
    const value=conflicted.localStorage.getItem(key);
    if(value!==null)seed[key]=value;
  }
  const race=await initializationRaceHarness({seed,remoteState:winnerState,revision:8,mutate:async P=>{
    P.softDeleteProject(winner);
    const locations=P.readLocations();
    locations[0]={...locations[0],deletedAt:'2026-08-24T19:05:00.000Z'};
    P.writeLocations(locations,'phase0-project-soft-delete');
  }});

  assert.equal(race.rpcCalls,1,'the reconciled soft delete must issue one CAS write after initialization');
  assert.equal(race.captured.p_expected_revision,8);
  assert.equal(race.captured.p_state.locations.length,1);
  assert.ok(race.captured.p_state.locations[0].deletedAt);
  assert.deepEqual(race.captured.p_state.workspace.trash.projects.map(value=>value.id),['winner']);
  assert.equal(race.events.filter(event=>event.type==='slogi:workspace-conflict').length,0,'a matching cached base must not create a second conflict');
});

test('initialization never rebases a local delete over a divergent remote winner',async()=>{
  const base=project('base',{deleted:false});
  const winner=project('remote-winner',{deleted:false});
  const baseState={locations:[base],workspace:workflowState()};
  const remoteState={locations:[winner],workspace:workflowState()};
  const session={access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'fixture-user',is_anonymous:true}};
  const seed={
    [SESSION_KEY]:JSON.stringify(session),
    [LOCATIONS_KEY]:JSON.stringify(baseState.locations),
    [WORKFLOW_KEY]:JSON.stringify(baseState.workspace),
    slogi_shared_workspace_cache_v1:JSON.stringify({workspaceId:'fixture-workspace',revision:7,state:baseState}),
  };
  const harness=await initializationRaceHarness({seed,remoteState,revision:8,mutate:async P=>{
    P.softDeleteProject(base);
    const locations=P.readLocations();
    locations[0]={...locations[0],deletedAt:'2026-08-24T19:05:00.000Z'};
    P.writeLocations(locations,'phase0-project-soft-delete');
  }});
  assert.equal(harness.rpcCalls,0,'a divergent remote winner must never be overwritten automatically');
  assert.deepEqual(JSON.parse(harness.localStorage.getItem(LOCATIONS_KEY)).map(value=>value.id),['remote-winner']);
  const draft=JSON.parse(harness.localStorage.getItem(CONFLICT_KEY));
  assert.equal(draft.state.locations[0].id,'base');
  assert.ok(draft.state.locations[0].deletedAt);
  assert.deepEqual(draft.state.workspace.trash.projects.map(value=>value.id),['base']);
  assert.equal(harness.events.filter(event=>event.type==='slogi:workspace-conflict').length,1);
});
