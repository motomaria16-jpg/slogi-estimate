'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const feed=require('../cian-listing-feed.js');

const SNAPSHOT='2026-08-28T12:00:00.000Z';
const NOW=Date.parse(SNAPSHOT);
const CUTOFF=new Date(NOW-30*86400000).toISOString();
function item(id,overrides={}){return{source:'cian',externalId:String(id),listingUrl:`https://www.cian.ru/rent/commercial/${id}`,firstSeenAt:new Date(NOW-Number(id||0)*1000).toISOString(),freshnessAt:new Date(NOW-86400000).toISOString(),freshnessKind:'published',marketStatus:'active',clusterId:'cluster-a',area:100,floor:1,premiseType:'office',hasBasementOrSocle:false,rentMonthly:300000,pricePerSquareMeter:3000,...overrides};}
function cursorFor(value){return{firstSeenAt:value.firstSeenAt,source:value.source,listingUrl:value.listingUrl};}
function meta({page=1,total,items,hasMore=false,nextCursor=null,snapshotAt=SNAPSHOT,freshnessCutoff=CUTOFF}){return{page,total,returned:items.length,hasMore,nextPage:hasMore?page+1:null,nextCursor,snapshotAt,freshnessCutoff};}

test('keyset drain loads every page beyond two and beyond page size without gaps',async()=>{
  const source=Array.from({length:205},(_,index)=>item(100000000+index,{firstSeenAt:new Date(NOW-index*1000).toISOString(),freshnessAt:new Date(NOW-index*1000).toISOString()}));
  let calls=0;
  const result=await feed.loadAllPages(async({page,limit,snapshotAt,cursor})=>{
    calls++;assert.equal(limit,50);assert.equal(snapshotAt,page===1?null:SNAPSHOT);
    const start=(page-1)*limit,items=source.slice(start,start+limit),hasMore=start+items.length<source.length;
    if(page===1)assert.equal(cursor,null);else assert.deepEqual(cursor,cursorFor(source[start-1]));
    return{items,meta:meta({page,total:source.length,items,hasMore,nextCursor:hasMore?cursorFor(items.at(-1)):null})};
  },{limit:50});
  assert.equal(calls,5);assert.equal(result.pages,5);assert.equal(result.partial,false);assert.equal(result.items.length,205);assert.equal(new Set(result.items.map(feed.identity)).size,205);assert.equal(result.snapshotAt,SNAPSHOT);assert.equal(result.freshnessCutoff,CUTOFF);
});

test('API/UI drain deduplicates external id and canonical URL across pages',async()=>{
  const first=[item(1),item(2)],second=[item(1,{listingUrl:'https://www.cian.ru/rent/commercial/999999999'}),item(3,{listingUrl:'https://www.cian.ru/rent/commercial/2?tracking=duplicate'}),item(4)];
  const result=await feed.loadAllPages(async({page})=>page===1
    ?{items:first,meta:meta({page,total:5,items:first,hasMore:true,nextCursor:cursorFor(first.at(-1))})}
    :{items:second,meta:meta({page,total:3,items:second})},{limit:2});
  assert.equal(result.partial,false);assert.equal(result.received,5);assert.deepEqual(result.items.map(value=>value.externalId),['1','2','4']);
});

test('stable Cian sort resolves freshness ties deterministically',async()=>{
  const sameTime=new Date(NOW-1000).toISOString(),items=[item(3,{freshnessAt:sameTime}),item(1,{freshnessAt:sameTime}),item(2,{freshnessAt:sameTime})];
  const result=await feed.loadAllPages(async()=>({items,meta:meta({total:3,items})}));
  assert.deepEqual(result.items.map(value=>value.externalId),['1','2','3']);
});

test('delayed UI keeps the exact inclusive 30-day boundary from API snapshot and cutoff',async()=>{
  const boundary=item(1,{freshnessAt:CUTOFF});
  const loaded=await feed.loadAllPages(async()=>({items:[boundary],meta:meta({total:1,items:[boundary]})}));
  const delayed=NOW+2*60*60*1000;
  assert.equal(feed.filterAndSort(loaded.items,{days:30},Date.parse(loaded.snapshotAt)).length,1);
  assert.equal(feed.filterAndSort(loaded.items,{days:30},delayed).length,0);
});

test('30-day boundary excludes unknown, older and removed rows',()=>{
  const exact=item(1,{freshnessAt:CUTOFF}),old=item(2,{freshnessAt:new Date(Date.parse(CUTOFF)-1).toISOString()}),unknown=item(3,{freshnessAt:'',freshnessKind:''}),removed=item(4,{marketStatus:'removed'});
  assert.deepEqual(feed.filterAndSort([old,unknown,removed,exact],{days:30},NOW).map(value=>value.externalId),['1']);
});

test('applies cluster, area, monthly rent and per-square-metre filters together',()=>{
  const matching=item(1,{clusterId:'cluster-a',area:120,rentMonthly:360000,pricePerSquareMeter:3000});
  const criteria={cluster:'cluster-a',areaMin:100,areaMax:150,rentMin:300000,rentMax:400000,sqmMin:2500,sqmMax:3500,days:30,sort:'freshness-desc'};
  assert.deepEqual(feed.filterAndSort([item(2,{clusterId:'cluster-b'}),item(3,{area:80}),item(4,{rentMonthly:500000}),item(5,{pricePerSquareMeter:4500}),matching],criteria,NOW).map(value=>value.externalId),['1']);
});

test('fixed premise gate keeps only 100–150 m² first-floor allowed types without basement or socle',()=>{
  const criteria={areaMin:100,areaMax:150,floor:1,premiseTypes:['office','retail','free_purpose'],excludeBasementOrSocle:true,days:30};
  const candidates=[
    item(1,{area:100,premiseType:'office'}),
    item(2,{area:150,premiseType:null,premise_type:'retail',has_basement_or_socle:false}),
    item(3,{premiseType:'',title:'Помещение свободного назначения'}),
    item(4,{area:99}),item(5,{area:151}),item(6,{floor:0}),item(7,{floor:2}),item(8,{floor:null}),
    item(9,{hasBasementOrSocle:true}),item(10,{description:'Офис расположен в цокольном этаже'}),
    item(11,{premiseType:'warehouse',title:'Офис и склад'}),item(12,{premiseType:'',title:'Коммерческое помещение'}),
  ];
  assert.deepEqual(feed.filterAndSort(candidates,criteria,NOW).map(value=>value.externalId),['1','2','3']);
  assert.equal(feed.normalizePremiseType(null,{premise_type:'free_purpose'}),'free_purpose');
  assert.equal(feed.hasBasementOrSocle({has_basement_or_socle:'true'}),true);
});

test('later cursor page failure is an explicit partial result and is never retried',async()=>{
  let calls=0;const first=[item(1)];
  const result=await feed.loadAllPages(async({page})=>{calls++;if(page===2)throw new Error('fixture_failure');return{items:first,meta:meta({page,total:2,items:first,hasMore:true,nextCursor:cursorFor(first[0])})};},{limit:1});
  assert.equal(calls,2);assert.equal(result.partial,true);assert.equal(result.errorCode,'page_failed');assert.equal(result.items.length,1);
});

test('changing remaining counts cannot break a frozen keyset drain',async()=>{
  const pages={1:[item(1)],2:[item(2)]};
  const result=await feed.loadAllPages(async({page})=>({items:pages[page],meta:meta({page,total:page===1?2:1,items:pages[page],hasMore:page===1,nextCursor:page===1?cursorFor(pages[1][0]):null})}),{limit:1});
  assert.equal(result.partial,false);assert.equal(result.serverTotal,2);assert.deepEqual(result.items.map(value=>value.externalId),['1','2']);
});

test('cursor cycle stops safely instead of repeating a page',async()=>{
  const items=[item(1)],next=cursorFor(items[0]);let calls=0;
  const result=await feed.loadAllPages(async({page})=>{calls++;return{items,meta:meta({page,total:2,items,hasMore:true,nextCursor:next})};},{limit:1});
  assert.equal(calls,2);assert.equal(result.partial,true);assert.equal(result.errorCode,'pagination_cycle');
});

test('an aborted stale load is rejected instead of restoring a partial response',async()=>{
  const controller=new AbortController(),items=[item(1)];
  await assert.rejects(()=>feed.loadAllPages(async({page})=>{if(page===2){controller.abort();const error=new Error('aborted');error.name='AbortError';throw error;}return{items,meta:meta({page,total:2,items,hasMore:true,nextCursor:cursorFor(items[0])})};},{limit:1,signal:controller.signal}),error=>error&&error.name==='AbortError');
});

test('read path is read-only, cursor-based and filters against the frozen snapshot',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','cian-workspace.js'),'utf8');
  const readPath=source.slice(source.indexOf('async function fetchListingPage'),source.indexOf('function loadYandex'));
  assert.equal(/fetch\([^)]*(?:cian\.ru|browserless)/i.test(source),false);assert.equal(/refresh-listings|hydrate-listings|update-clusters|\bpersist\b/i.test(source),false);assert.equal(/addMarketListing|\.sync\(|from\(|insert\(|update\(|upsert\(/i.test(readPath),false);assert.equal((readPath.match(/\bfetch\(/g)||[]).length,1);
  assert.match(source,/feed\.loadAllPages/);assert.match(source,/request\.cursor=cursor/);assert.match(source,/applyFixedGate\(loaded\.items\)/);assert.match(source,/areaMin:FIXED_CRITERIA\.areaMin,areaMax:FIXED_CRITERIA\.areaMax,floor:FIXED_CRITERIA\.floor,premiseTypes:/);assert.doesNotMatch(readPath,/\.filter\(item=>isRecent/);
});
