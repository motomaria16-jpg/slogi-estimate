'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const navigation=require('../fast-navigation.js');

const ROOT=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(ROOT,name),'utf8');
const BASE='https://slogi.example/app/available-spaces.html';

function anchor(href,attributes={}){
  const values={href,...attributes};
  return{
    href:new URL(href,BASE).href,
    getAttribute:name=>Object.prototype.hasOwnProperty.call(values,name)?values[name]:null,
    hasAttribute:name=>Object.prototype.hasOwnProperty.call(values,name)
  };
}

function click(overrides={}){return{button:0,defaultPrevented:false,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,...overrides};}

test('only unmodified same-app Search/In-work/KP links use fast navigation',()=>{
  assert.equal(navigation.clickTarget(click(),anchor('in-work.html'),BASE).href,'https://slogi.example/app/in-work.html');
  assert.equal(navigation.clickTarget(click(),anchor('in-work.html?mode=calendar'),BASE).search,'?mode=calendar');
  assert.equal(navigation.clickTarget(click({ctrlKey:true}),anchor('in-work.html'),BASE),null);
  assert.equal(navigation.clickTarget(click({shiftKey:true}),anchor('in-work.html'),BASE),null);
  assert.equal(navigation.clickTarget(click({button:1}),anchor('in-work.html'),BASE),null);
  assert.equal(navigation.clickTarget(click(),anchor('in-work.html',{target:'_blank'}),BASE),null);
  assert.equal(navigation.clickTarget(click(),anchor('in-work.html',{download:''}),BASE),null);
  assert.equal(navigation.clickTarget(click(),anchor('#calendar'),BASE),null);
  assert.equal(navigation.clickTarget(click(),anchor('https://other.example/in-work.html'),BASE),null);
  assert.equal(navigation.clickTarget(click(),anchor('/other/in-work.html'),BASE),null);
  assert.equal(navigation.clickTarget(click(),anchor('proposal.html'),BASE).href,'https://slogi.example/app/proposal.html');
});

test('internal iframe marker never leaks into the visible deep link',()=>{
  const framed=navigation.iframeUrl('in-work.html?mode=calendar',BASE),clean=navigation.cleanUrl(framed,BASE);
  assert.match(framed,/__slogi_view=1/);
  assert.equal(clean.href,'https://slogi.example/app/in-work.html?mode=calendar');
  assert.equal(navigation.isFastUrl(clean,BASE),true);
});

test('embedded view becomes cacheable only after its own access gate grants and main contract exists',()=>{
  const main={id:'cian-main'},root={access:'pending',getAttribute(name){return name==='data-slogi-access'?this.access:null;}};
  const doc={documentElement:root,querySelector:selector=>selector==='#cian-main'?main:null};
  assert.equal(navigation.viewContractReady(doc,'#cian-main'),false,'pending access must keep the host loading state visible');
  root.access='granted';
  assert.equal(navigation.viewContractReady(doc,'#missing-main'),false,'grant without the route contract is not ready');
  assert.equal(navigation.viewContractReady(doc,'#cian-main'),true);
});

test('fast navigation waits for the shared workspace and has a bounded full-page fallback',()=>{
  const values=new Map();
  const win={
    SlogiCloud:{ready:false},
    document:{documentElement:{getAttribute:name=>name==='data-slogi-access'?'granted':null}},
    sessionStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}
  };
  assert.equal(navigation.workspaceReady(win),false,'access markup alone is not a ready workspace');
  win.SlogiCloud.ready=true;
  assert.equal(navigation.workspaceReady(win),true);
  navigation.disableFastNavigation(win,60000);
  assert.equal(navigation.fallbackActive(win),true,'a failed embedded load must stop the reload loop');
});

test('a fallback reload boots the ordinary page instead of suppressing its application',()=>{
  const values=new Map([[navigation.FALLBACK_KEY,String(Date.now()+60000)]]),attributes=[];
  const win={
    SLOGI_PHASE0_CONFIG:{fastNavigation:{enabled:true}},
    location:{href:BASE},parent:null,
    document:{documentElement:{setAttribute:(...args)=>attributes.push(args)}},
    sessionStorage:{getItem:key=>values.get(key)||null,removeItem:key=>values.delete(key)}
  };
  win.parent=win;
  navigation.boot(win);
  assert.equal(win.__slogiFastNavigationHost,undefined,'ordinary app guards must remain inactive during fallback');
  assert.deepEqual(attributes,[],'fallback must not turn the document into a navigation host');
});

test('embedded workspace bridge recovers when the parent becomes ready after child parsing',()=>{
  let childAccess='',parentAccess='pending',readyListener=null,intervalCallback=null;
  const cloud={ready:false};
  const parentWindow={
    location:{origin:'https://slogi.example'},
    document:{documentElement:{getAttribute:name=>name==='data-slogi-access'?parentAccess:null}},
    SlogiCloud:cloud,
    fetch(){},
    addEventListener:(type,listener)=>{if(type==='slogi:shared-workspace-ready')readyListener=listener;},
    removeEventListener:()=>{}
  };
  const childWindow={
    location:{href:'https://slogi.example/available-spaces.html?__slogi_view=1',origin:'https://slogi.example'},
    parent:parentWindow,
    fetch(){},
    setInterval:callback=>{intervalCallback=callback;return 1;},
    clearInterval:()=>{intervalCallback=null;},
    addEventListener:()=>{},
    dispatchEvent:()=>{}
  };
  const context={
    window:childWindow,
    document:{documentElement:{setAttribute:(name,value)=>{if(name==='data-slogi-access')childAccess=value;}}},
    URL,
    CustomEvent:class{constructor(type){this.type=type;}},
    MutationObserver:class{observe(){}disconnect(){}}
  };
  vm.runInNewContext(read('shared-workspace.js'),context,{filename:'shared-workspace.js'});
  assert.equal(childAccess,'pending');
  assert.equal(typeof readyListener,'function');
  assert.equal(typeof intervalCallback,'function');
  parentAccess='granted';cloud.ready=true;readyListener();
  assert.equal(childAccess,'granted');
  assert.equal(childWindow.SlogiCloud,cloud);
  assert.equal(intervalCallback,null,'bridge polling must stop after connection');
});

test('bounded cache preloads at most two route views and reuses exact frame identity',async()=>{
  let loads=0;const disposed=[];
  const cache=navigation.createBoundedViewCache({max:99,load:async(key,href)=>({key,href,frame:{id:++loads}}),dispose:view=>disposed.push(view.frame.id)});
  const search=await cache.get('available-spaces.html','https://slogi.example/app/available-spaces.html');
  const work=await cache.get('in-work.html','https://slogi.example/app/in-work.html');
  const searchAgain=await cache.get('available-spaces.html','https://slogi.example/app/available-spaces.html');
  assert.equal(loads,2,'Search → In-work → Search must not create or reload a third frame');
  assert.equal(searchAgain,search);assert.equal(searchAgain.frame,search.frame);assert.equal(work.frame.id,2);
  assert.equal(cache.size(),2);assert.deepEqual(cache.keys().sort(),['available-spaces.html','in-work.html']);assert.deepEqual(disposed,[]);

  const replaced=await cache.get('in-work.html','https://slogi.example/app/in-work.html?mode=calendar');
  assert.equal(loads,3,'a changed deep link may replace only its own route view');
  assert.notEqual(replaced,work);assert.deepEqual(disposed,[2]);assert.equal(cache.size(),2);
});

test('a changed deep link keeps the previous route view alive until its replacement is ready',async()=>{
  let releaseReplacement;const disposed=[];
  const cache=navigation.createBoundedViewCache({
    load:async(_key,href)=>href.includes('calendar')?new Promise(resolve=>{releaseReplacement=()=>resolve({href,frame:{id:'new'}});}):{href,frame:{id:'old'}},
    dispose:view=>disposed.push(view.frame.id)
  });
  const previous=await cache.get('in-work.html','https://slogi.example/app/in-work.html');
  const replacement=cache.get('in-work.html','https://slogi.example/app/in-work.html?mode=calendar');
  await Promise.resolve();
  assert.deepEqual(disposed,[],'the visible route must not be disposed while the replacement is loading');
  releaseReplacement();await replacement;
  assert.deepEqual(disposed,['old']);assert.equal(previous.frame.id,'old');
});

test('a failed replacement restores the already rendered route view',async()=>{
  const disposed=[];
  const cache=navigation.createBoundedViewCache({load:async(_key,href)=>{if(href.includes('calendar'))throw new Error('offline');return{href,frame:{id:'old'}};},dispose:view=>disposed.push(view.frame.id)});
  const previous=await cache.get('in-work.html','https://slogi.example/app/in-work.html');
  await assert.rejects(cache.get('in-work.html','https://slogi.example/app/in-work.html?mode=calendar'),/offline/);
  assert.equal(await cache.get('in-work.html','https://slogi.example/app/in-work.html'),previous);
  assert.deepEqual(disposed,[]);
});

test('coordinator uses top history for forward/back while the sidebar object is preserved',async()=>{
  const sidebar={id:'persistent-sidebar'},shell={sidebar},history=[],shown=[],active=[];
  const cache=navigation.createBoundedViewCache({load:async(key,href)=>({key,href,frame:{key}})});
  const coordinator=navigation.createNavigationCoordinator({
    initialUrl:BASE,
    loadView:href=>cache.get(navigation.routeName(href),href),
    showView:(view,href)=>{assert.equal(shell.sidebar,sidebar);shown.push([view,href]);},
    setActive:href=>active.push(navigation.routeName(href)),
    pushState:href=>history.push(href),
    hardNavigate:()=>assert.fail('unexpected hard fallback')
  });
  await coordinator.navigate('https://slogi.example/app/in-work.html','push');
  await coordinator.pop('https://slogi.example/app/available-spaces.html');
  await coordinator.pop('https://slogi.example/app/in-work.html');
  assert.deepEqual(history,['https://slogi.example/app/in-work.html']);
  assert.deepEqual(active,['in-work.html','available-spaces.html','in-work.html']);
  assert.equal(shown[0][0],shown[2][0],'forward must reveal the cached frame, not load another document');
  assert.equal(cache.size(),2);assert.equal(shell.sidebar,sidebar);
});

test('view load failure falls back to a clean full-document URL',async()=>{
  const fallback=[];const busy=[];
  const coordinator=navigation.createNavigationCoordinator({
    initialUrl:BASE,
    loadView:async()=>{throw new Error('network failure');},
    hardNavigate:(href,error)=>fallback.push({href,message:error.message}),
    setBusy:value=>busy.push(value)
  });
  assert.equal(await coordinator.navigate('in-work.html?__slogi_view=1','push'),false);
  assert.deepEqual(fallback,[{href:'https://slogi.example/app/in-work.html',message:'network failure'}]);
  assert.deepEqual(busy,[true,false]);
});

test('host wiring keeps the fail-closed gate first, isolates runtimes, and pauses hidden reminders',()=>{
  for(const page of ['available-spaces.html','in-work.html']){
    const html=read(page),shared=html.indexOf('shared-workspace.js?v=76134'),fast=html.indexOf('fast-navigation.js?v='),headEnd=html.indexOf('</head>');
    assert.match(html,/data-slogi-access="pending"/);assert.ok(shared>=0&&shared<fast&&fast<headEnd,page);
    assert.match(html,/phase0-config\.js\?v=76138/);assert.match(html,/fast-navigation\.js\?v=76140/);
    const styles=[...html.matchAll(/href="([^"]+\.css\?[^\"]+)"/g)].map(match=>match[1]);
    assert.match(styles.at(-1),/^figma-shell-v76-1-15\.css\?v=\d+$/);
  }
  assert.match(read('figma-shell-v76-1-15.js'),/slogi-fast-view-embedded/);
  assert.match(read('cian-workspace.js'),/if\(window\.__slogiFastNavigationHost\)return/);
  const inWork=read('in-work-app.js');
  assert.match(inWork,/if\(window\.__slogiFastNavigationHost\)return/);
  assert.match(inWork,/slogi:view-visibility/);assert.match(inWork,/clearInterval\(reminderTimer\)/);assert.match(inWork,/if\(appInitialized\)reload\(\)/,'a cached in-work view must refresh local storage on resume');
  const source=read('fast-navigation.js');
  assert.match(read('phase0-config.js'),/fastNavigation:\{[\s\S]*enabled:existingFastNavigation\.enabled!==false/,'persistent navigation must be enabled by default with an explicit runtime opt-out');
  assert.match(source,/fastNavigation\.enabled===true/,'persistent iframe navigation must require an explicit runtime flag');
  assert.match(source,/max:2/);assert.doesNotMatch(source,/previous\.remove\(\)/);
  assert.doesNotMatch(source,/requestIdleCallback/,'a hidden route must not run before the user opens it');
  assert.match(source,/if\(fallbackActive\(win\)\)return;\s*bootHost\(win\)/,'a fallback reload must run the ordinary page app instead of setting the host flag again');
  assert.match(source,/if\(busy&&!activeFrame&&!fallbackVisible\)/,'the current frame must stay visible while the next one loads');
  assert.match(source,/doc\.readyState==='complete'\)start\(\);else win\.addEventListener\('load',start,\{once:true\}\)/,'the native app must initialize before the persistent host can take over');
  assert.match(source,/if\(cleanHref===initial\)return Promise\.resolve\(\{native:true/,'the initial page must remain native instead of loading itself in an iframe');
  assert.doesNotMatch(source,/coordinator\.navigate\(initial/,'startup must never replace a working native page with a loading overlay');
  assert.doesNotMatch(source,/__slogiFastNavigationHost=true/,'the native page application must never be suppressed by the navigation shell');
  assert.match(source,/Открыть раздел обычным способом/,'failed iframe navigation needs a keyboard-accessible full-page fallback');
  assert.match(source,/if\(!shell\)\{disableFastNavigation\(win\);win\.location\.replace\(initial\);return;\}/,'a missing shell must enter bounded fallback instead of a reload loop');
  assert.match(source,/data-slogi-access'\)==='granted'/,'view loading must wait for the existing fail-closed gate');
  assert.match(source,/accessObserver\.observe\(frameDoc\.documentElement/,'embedded pending access must be observed before a view is cached');
  const shellCss=read('figma-shell-v76-1-15.css');
  assert.match(shellCss,/\.slogi-fast-view-host\{display:none;/,'the loading host must not cover the native page');
  assert.match(shellCss,/body\.slogi-fast-navigation-active>\.slogi-fast-view-host\{display:block\}/);
  assert.match(shellCss,/\.slogi-fast-view-status\[hidden\]\{display:none!important\}/,'a ready view must never remain covered by the loading message');
  assert.doesNotMatch(shellCss,/body\.slogi-fast-navigation-host>main/,'the native page must stay visible until an iframe is ready');
  const workspace=read('shared-workspace.js');
  assert.match(workspace,/embeddedFastView/);assert.match(workspace,/parentWindow\.SlogiCloud\.ready!==true/,'embedded views may reuse only an already granted same-origin workspace owner');
  assert.match(workspace,/slogi:shared-workspace-ready/,'embedded views must retry after delayed parent initialization');
  assert.match(workspace,/window\.SlogiCloud=parentWindow\.SlogiCloud/,'cached views must share one revision owner instead of racing independent sync loops');
});
