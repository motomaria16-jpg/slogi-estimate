'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
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

test('only unmodified same-app Search/In-work links use fast navigation',()=>{
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
  assert.equal(navigation.clickTarget(click(),anchor('proposal.html'),BASE),null);
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
    const html=read(page),shared=html.indexOf('shared-workspace.js?v=76133'),fast=html.indexOf('fast-navigation.js?v=76133'),headEnd=html.indexOf('</head>');
    assert.match(html,/data-slogi-access="pending"/);assert.ok(shared>=0&&shared<fast&&fast<headEnd,page);
    const styles=[...html.matchAll(/href="([^"]+\.css\?[^\"]+)"/g)].map(match=>match[1]);
    assert.match(styles.at(-1),/^figma-shell-v76-1-15\.css\?v=\d+$/);
  }
  assert.match(read('figma-shell-v76-1-15.js'),/slogi-fast-view-embedded/);
  assert.match(read('cian-workspace.js'),/if\(window\.__slogiFastNavigationHost\)return/);
  const inWork=read('in-work-app.js');
  assert.match(inWork,/if\(window\.__slogiFastNavigationHost\)return/);
  assert.match(inWork,/slogi:view-visibility/);assert.match(inWork,/clearInterval\(reminderTimer\)/);assert.match(inWork,/if\(appInitialized\)reload\(\)/,'a cached in-work view must refresh local storage on resume');
  const source=read('fast-navigation.js');
  assert.match(source,/requestIdleCallback/);assert.match(source,/max:2/);assert.doesNotMatch(source,/previous\.remove\(\)/);
  assert.match(source,/data-slogi-access'\)==='granted'/,'view loading must wait for the existing fail-closed gate');
  assert.match(source,/accessObserver\.observe\(frameDoc\.documentElement/,'embedded pending access must be observed before a view is cached');
  const workspace=read('shared-workspace.js');
  assert.match(workspace,/embeddedFastView/);assert.match(workspace,/parentGranted&&parentWindow\.SlogiCloud&&parentWindow\.SlogiCloud\.ready===true/,'embedded views may reuse only an already granted same-origin workspace owner');
  assert.match(workspace,/window\.SlogiCloud=parentWindow\.SlogiCloud/,'cached views must share one revision owner instead of racing independent sync loops');
});
