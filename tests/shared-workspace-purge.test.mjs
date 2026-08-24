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
    document:{readyState:'loading',head,body,getElementById:id=>nodes.get(String(id))||null,createElement:makeNode,addEventListener(type,handler){if(type==='DOMContentLoaded')domReady=handler;}},
    fireReady(){if(!domReady)throw new Error('DOMContentLoaded handler missing');domReady();},
  };
}

async function sharedHarness({remoteState,revision=7,rpc='ok',winnerState={locations:[],workspace:workflowState()}}){
  const Storage=storageClass();
  const session={access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'fixture-user',is_anonymous:true}};
  const localStorage=new Storage({[SESSION_KEY]:JSON.stringify(session),[LOCATIONS_KEY]:'[]',[WORKFLOW_KEY]:JSON.stringify(workflowState())});
  const events=[];
  const documentHarness=fakeDocument();
  let stateReads=0,rpcCalls=0,capturedState=null;
  const fetch=async(input,init={})=>{
    const url=String(input);
    if(url.endsWith('/auth/v1/user'))return jsonResponse({id:'fixture-user',is_anonymous:true});
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
    SLOGI_PHASE0_CONFIG:{supabase:{url:'https://fixture.supabase.co',publishableKey:'fixture-publishable-key-with-safe-length'},sharedWorkspace:{joinEndpoint:'https://fixture.supabase.co/functions/v1/join-workspace'}},
    dispatchEvent:event=>events.push(event),
  };
  const context=vm.createContext({window,document:documentHarness.document,localStorage,Storage,CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},fetch,Response,URL,Date,Math,JSON,Set,String,Number,Array,Object,Boolean,RegExp,encodeURIComponent,setTimeout,clearTimeout});
  vm.runInContext(coreSource,context,{filename:'professional-core.js'});
  vm.runInContext(sharedSource,context,{filename:'shared-workspace.js'});
  documentHarness.fireReady();
  for(let i=0;i<40&&!window.SlogiCloud.ready;i++)await wait(10);
  assert.equal(window.SlogiCloud.ready,true,'shared workspace did not initialize');
  return{P:window.SlogiPro,cloud:window.SlogiCloud,localStorage,events,get rpcCalls(){return rpcCalls;},get capturedState(){return capturedState;}};
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
