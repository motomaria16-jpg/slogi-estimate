'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const feed=require('../cian-listing-feed.js');

const NOW=Date.parse('2026-08-28T12:00:00.000Z');
function item(id,overrides={}){return{source:'cian',externalId:String(id),listingUrl:`https://www.cian.ru/rent/commercial/${id}`,freshnessAt:new Date(NOW-86400000).toISOString(),freshnessKind:'published',marketStatus:'active',clusterId:'cluster-a',area:100,rentMonthly:300000,pricePerSquareMeter:3000,...overrides};}

test('loads every page beyond two and beyond page size without gaps',async()=>{
  const source=Array.from({length:205},(_,index)=>item(100000000+index,{freshnessAt:new Date(NOW-index*1000).toISOString()}));
  let calls=0;
  const result=await feed.loadAllPages(async({page,limit,snapshotAt})=>{
    calls++;
    assert.equal(limit,50);
    assert.equal(snapshotAt,page===1?null:'2026-08-28T12:00:00.000Z');
    const start=(page-1)*limit,items=source.slice(start,start+limit);
    return{items,meta:{snapshotAt:'2026-08-28T12:00:00.000Z',total:source.length,hasMore:start+items.length<source.length,nextPage:start+items.length<source.length?page+1:null}};
  },{limit:50});
  assert.equal(calls,5);assert.equal(result.pages,5);assert.equal(result.partial,false);assert.equal(result.items.length,205);assert.equal(new Set(result.items.map(feed.identity)).size,205);
});

test('deduplicates stable Cian identity and sorts ties deterministically',async()=>{
  const sameTime=new Date(NOW-1000).toISOString();
  const result=await feed.loadAllPages(async()=>({items:[item(3,{freshnessAt:sameTime}),item(1,{freshnessAt:sameTime}),item(1,{listingUrl:'https://www.cian.ru/rent/commercial/1?tracking=duplicate'}),item(2,{freshnessAt:sameTime})],meta:{snapshotAt:'2026-08-28T12:00:00.000Z',total:4,hasMore:false,nextPage:null}}));
  assert.deepEqual(result.items.map(value=>value.externalId),['1','2','3']);
});

test('canonical URL fallback deduplicates tracking variants when external id is unavailable',async()=>{
  const first=item('',{externalId:'',listingUrl:'https://www.cian.ru/rent/commercial/555555555/?utm_source=one#card'});
  const second=item('',{externalId:'',listingUrl:'https://www.cian.ru/rent/commercial/555555555?utm_source=two'});
  const result=await feed.loadAllPages(async()=>({items:[first,second],meta:{snapshotAt:'2026-08-28T12:00:00.000Z',total:2,hasMore:false,nextPage:null}}));
  assert.equal(result.items.length,1);
  assert.equal(feed.identity(first),feed.identity(second));
});

test('30-day boundary is inclusive while unknown, older and removed rows are excluded',()=>{
  const exact=item(1,{freshnessAt:new Date(NOW-30*86400000).toISOString()});
  const old=item(2,{freshnessAt:new Date(NOW-30*86400000-1).toISOString()});
  const unknown=item(3,{freshnessAt:'',freshnessKind:''});
  const removed=item(4,{marketStatus:'removed'});
  assert.deepEqual(feed.filterAndSort([old,unknown,removed,exact],{days:30},NOW).map(value=>value.externalId),['1']);
});

test('applies cluster, area, monthly rent and per-square-metre filters together',()=>{
  const matching=item(1,{clusterId:'cluster-a',area:120,rentMonthly:360000,pricePerSquareMeter:3000});
  const wrongCluster=item(2,{clusterId:'cluster-b'}),wrongArea=item(3,{area:80}),wrongRent=item(4,{rentMonthly:500000}),wrongSqm=item(5,{pricePerSquareMeter:4500});
  const criteria={cluster:'cluster-a',areaMin:100,areaMax:150,rentMin:300000,rentMax:400000,sqmMin:2500,sqmMax:3500,days:30,sort:'freshness-desc'};
  assert.deepEqual(feed.filterAndSort([wrongCluster,wrongArea,wrongRent,wrongSqm,matching],criteria,NOW).map(value=>value.externalId),['1']);
});

test('later page failure is an explicit partial result and is never retried',async()=>{
  let calls=0;
  const result=await feed.loadAllPages(async({page})=>{calls++;if(page===2)throw new Error('fixture_failure');return{items:[item(1)],meta:{snapshotAt:'2026-08-28T12:00:00.000Z',total:2,hasMore:true,nextPage:2}};},{limit:1});
  assert.equal(calls,2);assert.equal(result.partial,true);assert.equal(result.errorCode,'page_failed');assert.equal(result.items.length,1);
});

test('pagination fails partial instead of skipping rows when the server total changes',async()=>{
  let calls=0;
  const result=await feed.loadAllPages(async({page})=>{
    calls++;
    return page===1
      ?{items:[item(1)],meta:{snapshotAt:'2026-08-28T12:00:00.000Z',total:2,hasMore:true,nextPage:2}}
      :{items:[item(2)],meta:{snapshotAt:'2026-08-28T12:00:00.000Z',total:3,hasMore:false,nextPage:null}};
  },{limit:1});
  assert.equal(calls,2);assert.equal(result.partial,true);assert.equal(result.errorCode,'total_changed');assert.equal(result.items.length,1);
});

test('read path contains no provider trigger or persistence action',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','cian-workspace.js'),'utf8');
  const readPath=source.slice(source.indexOf('async function loadListings'),source.indexOf('function loadYandex'));
  assert.equal(/fetch\([^)]*(?:cian\.ru|browserless)/i.test(source),false);
  assert.equal(/refresh-listings|hydrate-listings|update-clusters|\bpersist\b/i.test(source),false);
  assert.equal(/addMarketListing|\.sync\(|localStorage|sessionStorage/i.test(readPath),false);
  assert.equal((readPath.match(/\bfetch\(/g)||[]).length,1);
  assert.match(source,/feed\.loadAllPages/);assert.match(source,/Authorization/);
});
