import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { BROWSERLESS_LIMITS, resolveBrowserlessTimeoutProfile, resolveHourlyBrowserlessPolicy } from '../browserless.ts';
import { extractListingDates, listingFreshnessDecision } from '../freshness.ts';
import { pageBlockReason } from '../parsing.ts';
import { CianListingProvider } from '../providers/cian.ts';
import { SupabaseListingServerStore, type ListingServerStore, type QueueItem, type ScanState } from '../server-store.ts';
import type { BrowserlessPage, NormalizedListing } from '../types.ts';
import { createHydrateListingsHandler, HYDRATION_LIMITS } from '../../../hydrate-listings/index.ts';
import { createImportListingHandler } from '../../../import-listing/index.ts';
import { secureTransport } from '../../../password-gate/index.ts';
import { createRefreshListingsHandler, DISCOVERY_LIMITS } from '../../../refresh-listings/index.ts';
import { createSearchListingsHandler, parseSearchRequest, SupabaseListingReadStore, type ListingReadStore } from '../../../search-listings/index.ts';

const testDirectory=dirname(fileURLToPath(import.meta.url));
const functionsDirectory=join(testDirectory,'..','..','..');
const repositoryDirectory=join(functionsDirectory,'..','..');
const observedAt='2026-08-20T09:00:00.000Z';
const dateReference=new Date('2026-08-21T09:00:00.000Z');

function fixture(name:string):string{return readFileSync(join(testDirectory,'fixtures',name),'utf8');}
function page(html:string,links:string[]=[]):BrowserlessPage{return{status:'ok',html,markdown:'',links,strategy:'smart-scrape',attempted:['smart-scrape'],statusCode:200,durationMs:1,blockReason:null,warnings:[]};}
function listing(overrides:Partial<NormalizedListing>={}):NormalizedListing{return{
  source:'cian',listingUrl:'https://www.cian.ru/rent/commercial/111111111',externalId:'111111111',title:'Офис',address:'Москва, Тверская улица, 12',latitude:55.76,longitude:37.6,area:180,rentMonthly:450000,pricePerSquareMeter:2500,floor:3,totalFloors:9,ceilingHeight:3.4,description:null,publishedAt:observedAt,sourceUpdatedAt:null,freshnessAt:observedAt,freshnessKind:'published',dateConfidence:'high',dateWarnings:[],firstSeenAt:observedAt,lastSeenAt:observedAt,marketStatus:'active',parseCompleteness:.9,parseWarnings:[],...overrides,
};}
function environment(values:Record<string,string>={}){return{get(name:string){return values[name];}};}
function inertStore(overrides:Partial<ListingServerStore>={}):ListingServerStore{return Object.assign({
  async getState(){throw new Error('unexpected_get_state');},async saveState(){throw new Error('unexpected_save_state');},async claimRun(){throw new Error('unexpected_claim_run');},async finishRun(){throw new Error('unexpected_finish_run');},async enqueue(){throw new Error('unexpected_enqueue');},async claimQueue(){throw new Error('unexpected_claim_queue');},async finishQueue(){throw new Error('unexpected_finish_queue');},async persistRecent(){throw new Error('unexpected_persist');},async markRemoved(){throw new Error('unexpected_removed');},
},overrides) as ListingServerStore;}
function scanState(nextPage=2):ScanState{return{source:'cian',nextPage,discoveryFailures:0,hydrationFailures:0,lastDiscoveryStartedAt:null,lastDiscoverySucceededAt:null,lastDiscoveryErrorCode:null,lastHydrationStartedAt:null,lastHydrationSucceededAt:null,lastHydrationErrorCode:null,cooldownUntil:null};}
function queueItem(id:number):QueueItem{return{id,source:'cian',listingUrl:`https://www.cian.ru/rent/commercial/${100000000+id}`,externalId:String(100000000+id),priority:'backfill',status:'pending',attemptCount:0,discoveredAt:observedAt,lastDiscoveredAt:observedAt,nextAttemptAt:observedAt,lockedAt:null,lockedBy:null,lastAttemptAt:null,completedAt:null,lastErrorCode:null};}

test('password gate Edge transport accepts only allowlisted hosted proxy surfaces',()=>{
  assert.equal(secureTransport(new Request('https://fixture.supabase.co/functions/v1/password-gate')),true);
  const environment={get:(name:string)=>name==='SUPABASE_URL'?'https://fixture.supabase.co':undefined};
  const headers={host:'edge-runtime.supabase.com','x-forwarded-host':'fixture.supabase.co','x-forwarded-proto':'https'};
  assert.equal(secureTransport(new Request('http://fixture.supabase.co/functions/v1/password-gate',{headers}),environment),true);
  assert.equal(secureTransport(new Request('http://fixture.supabase.co/functions/v1/password-gate',{headers:{...headers,'x-forwarded-port':'443'}}),environment),true);
  assert.equal(secureTransport(new Request('http://edge-runtime.supabase.com/functions/v1/password-gate',{headers:{...headers,host:'fixture.supabase.co','x-forwarded-host':'edge-runtime.supabase.com'}}),environment),true);
  assert.equal(secureTransport(new Request('http://fixture.supabase.co/functions/v1/password-gate',{headers:{...headers,host:'untrusted.example'}}),environment),false);
  assert.equal(secureTransport(new Request('http://fixture.supabase.co/functions/v1/password-gate',{headers:{...headers,'x-forwarded-proto':'https,http'}}),environment),false);
  assert.equal(secureTransport(new Request('http://fixture.supabase.co/functions/v1/password-gate',{headers:{...headers,'x-forwarded-port':'80'}}),environment),false);
  assert.equal(secureTransport(new Request('http://fixture.supabase.co/functions/v1/password-gate',{headers:{...headers,'x-forwarded-port':'443,80'}}),environment),false);
  assert.equal(secureTransport(new Request('http://other.supabase.co/functions/v1/password-gate',{headers}),environment),false);
  assert.equal(secureTransport(new Request('http://fixture.supabase.co/functions/v1/password-gate',{headers}),{get:()=>undefined}),false);
  assert.equal(secureTransport(new Request('http://fixture.supabase.co/functions/v1/password-gate')),false);
});

test('Cian URL canonicalization strips tracking and rejects lookalikes',()=>{
  const provider=new CianListingProvider();
  const result=provider.validateAndCanonicalizeUrl('http://cian.ru/rent/commercial/111111111/?utm_source=test#map');
  assert.equal(result.canonicalUrl,'https://www.cian.ru/rent/commercial/111111111');
  assert.equal(result.externalId,'111111111');
  assert.equal(provider.validateAndCanonicalizeUrl('https://cian.ru.example.test/rent/commercial/111111111').ok,false);
  assert.equal(provider.validateAndCanonicalizeUrl('https://www.cian.ru/cat.php').ok,false);
});

test('Cian discovery returns only canonical unique commercial cards',()=>{
  const provider=new CianListingProvider();
  assert.deepEqual(provider.discoverListingUrls(page(fixture('cian-search.html'))),[
    'https://www.cian.ru/rent/commercial/111111111','https://www.cian.ru/rent/commercial/222222222',
  ]);
});

test('Cian JSON-LD produces the expected complete normalized listing',()=>{
  const value=new CianListingProvider().parseListing(page(fixture('cian-listing.html')),'https://www.cian.ru/rent/commercial/111111111',observedAt);
  assert.equal(value.externalId,'111111111');assert.equal(value.title,'Офис 180 м² на Тверской');assert.equal(value.address,'Москва, Тверская улица, 12');assert.equal(value.area,180);assert.equal(value.rentMonthly,450000);assert.equal(value.pricePerSquareMeter,2500);assert.equal(value.floor,3);assert.equal(value.totalFloors,9);assert.equal(value.ceilingHeight,3.4);assert.equal(value.latitude,55.7641);assert.ok(value.parseCompleteness>=.8);
});

test('multi-unit semantic parsing does not mix premises',()=>{
  const value=new CianListingProvider().parseListing(page(fixture('cian-multi-unit.html')),'https://www.cian.ru/rent/commercial/326369393',observedAt);
  assert.equal(value.area,2156.2);assert.notEqual(value.area,100);assert.equal(value.floor,13);assert.equal(value.totalFloors,20);assert.equal(value.rentMonthly,9648994);assert.equal(value.pricePerSquareMeter,4475);assert.ok(value.parseWarnings.includes('representative_unit_selected'));assert.equal(value.parseWarnings.includes('semantic_price_per_square_meter_mismatch'),false);
});

test('engineering W/m² value is never interpreted as area',()=>{
  const value=new CianListingProvider().parseListing(page(fixture('cian-engineering-only.html')),'https://www.cian.ru/rent/commercial/333333333',observedAt);
  assert.equal(value.area,null);assert.notEqual(value.area,100);assert.ok(value.parseWarnings.includes('partial_listing'));
});

test('malformed structured data remains partial without invented rent',()=>{
  const value=new CianListingProvider().parseListing(page(fixture('malformed-structured.html')),'https://www.cian.ru/rent/commercial/222222222',observedAt);
  assert.equal(value.address,'Москва, улица Правды, 7');assert.equal(value.area,95);assert.equal(value.rentMonthly,null);assert.ok(value.parseWarnings.includes('malformed_json_ld'));assert.ok(value.parseWarnings.includes('partial_listing'));
});

test('blocked fixture is classified as captcha',()=>{assert.equal(pageBlockReason(fixture('blocked.html')),'captcha');});

test('publication and update dates remain distinct and publication wins',()=>{
  const value=extractListingDates('<script type="application/ld+json">{"@type":"Offer","datePublished":"2026-08-10T09:00:00Z","dateModified":"2026-08-19T10:00:00Z"}</script>','',dateReference);
  assert.equal(value.publishedAt,'2026-08-10T09:00:00.000Z');assert.equal(value.sourceUpdatedAt,'2026-08-19T10:00:00.000Z');assert.equal(value.freshnessAt,value.publishedAt);assert.equal(value.freshnessKind,'published');
});

test('description date is not publication evidence',()=>{
  const value=extractListingDates('<div data-name="Description">Договор действует с 1 августа 2026 года.</div>','',dateReference);
  assert.equal(value.freshnessAt,null);assert.ok(value.dateWarnings.includes('missing_freshness_date'));
});

test('explicit update is accepted only when publication is unavailable',()=>{
  const value=extractListingDates('<script type="application/json">{"updatedAt":"2026-08-20T00:00:00Z"}</script>','',dateReference);
  assert.equal(value.publishedAt,null);assert.equal(value.freshnessAt,'2026-08-20T00:00:00.000Z');assert.equal(value.freshnessKind,'updated');
});

test('unknown freshness is excluded',()=>{assert.equal(listingFreshnessDecision(listing({freshnessAt:null}),dateReference),'unknown');});
test('exactly 30 days old is included',()=>{assert.equal(listingFreshnessDecision(listing({freshnessAt:new Date(dateReference.getTime()-30*86400000).toISOString()}),dateReference),'recent');});
test('older than 30 days is excluded',()=>{assert.equal(listingFreshnessDecision(listing({freshnessAt:new Date(dateReference.getTime()-30*86400000-1).toISOString()}),dateReference),'old');});
test('future marketplace date is rejected',()=>{const value=extractListingDates('<script type="application/json">{"publishedAt":"2026-08-22T09:00:00Z"}</script>','',dateReference);assert.equal(value.freshnessAt,null);assert.ok(value.dateWarnings.includes('future_date_rejected'));});

test('runtime Browserless policy is Cian smart-scrape only',()=>{
  assert.deepEqual(resolveHourlyBrowserlessPolicy('cian',environment()),{strategy:'smart-scrape',directUnblock:false});
  assert.throws(()=>resolveHourlyBrowserlessPolicy('avito',environment()),/source_disabled/);
  assert.doesNotThrow(()=>resolveBrowserlessTimeoutProfile('cian','card','smart-scrape'));
  assert.throws(()=>resolveBrowserlessTimeoutProfile('avito','card','smart-scrape'));
});

test('rolling ingestion budgets are bounded, sequential and cursor-capable',()=>{
  assert.equal(DISCOVERY_LIMITS.browserlessCalls,2);assert.equal(DISCOVERY_LIMITS.concurrency,1);assert.equal(DISCOVERY_LIMITS.backfillPagesPerRun,1);assert.equal(DISCOVERY_LIMITS.runSlotHours,6);assert.equal(HYDRATION_LIMITS.hardBatch,2);assert.equal(HYDRATION_LIMITS.runSlotMinutes,60);assert.equal(HYDRATION_LIMITS.hardConcurrency,1);assert.equal(HYDRATION_LIMITS.browserlessCallsPerItem,1);assert.ok(BROWSERLESS_LIMITS.hardClientTimeoutMs<=75000);
  const source=readFileSync(join(repositoryDirectory,'supabase','functions','refresh-listings','index.ts'),'utf8');
  assert.equal(/MAX_BACKFILL_PAGE|max_backfill_page_reached/i.test(source),false);
});

test('manual import uses one Cian smart-scrape call without unblock or retry',async()=>{
  let captured:any=null;
  const handler=createImportListingHandler({authorize:async()=>true,client:{async fetchPage(_url,options){captured=options;return page(fixture('cian-listing.html'));}},now:()=>new Date(observedAt)});
  const result=await handler(new Request('http://local/import-listing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://www.cian.ru/rent/commercial/111111111'})}));
  assert.equal(result.status,200);assert.deepEqual(captured.strategies,['smart-scrape']);assert.equal(captured.allowUnblock,false);assert.equal(captured.directUnblock,false);assert.equal(captured.retryCount,0);
});

test('search request allowlist accepts only Cian and rejects crawler actions',()=>{
  assert.equal(parseSearchRequest({sources:['cian']}).ok,true);assert.equal(parseSearchRequest({sources:['avito']}).ok,false);assert.equal(parseSearchRequest({sources:['cian'],persist:true}).ok,false);
});

test('search requires a bearer session before any database read',async()=>{
  let reads=0;const store:ListingReadStore={async readRecent(){reads++;return{items:[],total:0,hasMore:false,nextCursor:null};},async readScanStates(){reads++;return[];}};
  const result=await createSearchListingsHandler({store})(new Request('http://local/search',{method:'POST',body:'{}'}));
  assert.equal(result.status,401);assert.equal(reads,0);
});

test('search reads saved rows only and applies recent/removed filter',async()=>{
  const recent=listing({freshnessAt:new Date(dateReference.getTime()-29*86400000).toISOString()});
  const old=listing({listingUrl:'https://www.cian.ru/rent/commercial/222222222',freshnessAt:new Date(dateReference.getTime()-31*86400000).toISOString()});
  const removed=listing({listingUrl:'https://www.cian.ru/rent/commercial/333333333',marketStatus:'removed'});
  let reads=0;const store:ListingReadStore={async readRecent(){reads++;return{items:[old,removed,recent],total:1,hasMore:false,nextCursor:null};},async readScanStates(){reads++;return[];}};
  const response=await createSearchListingsHandler({store,authorize:async()=>true,now:()=>dateReference})(new Request('http://local/search',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:'{}'}));
  const body=await response.json();assert.equal(reads,2);assert.deepEqual(body.items.map((entry:NormalizedListing)=>entry.listingUrl),[recent.listingUrl]);assert.equal(body.meta.total,1);assert.equal(body.meta.snapshotAt,dateReference.toISOString());
});

test('search returns stable keyset metadata without triggering writes',async()=>{
  let captured:any=null;const rows=Array.from({length:5},(_,index)=>listing({externalId:String(index+1),listingUrl:`https://www.cian.ru/rent/commercial/${100000000+index}`,freshnessAt:new Date(dateReference.getTime()-index*1000).toISOString()}));
  const cursor={firstSeenAt:observedAt,source:'cian' as const,listingUrl:rows[1].listingUrl};
  const nextCursor={firstSeenAt:observedAt,source:'cian' as const,listingUrl:rows[3].listingUrl};
  const store:ListingReadStore={async readRecent(request){captured=request;return{items:rows.slice(2,4),total:5,hasMore:true,nextCursor};},async readScanStates(){return[];}};
  const response=await createSearchListingsHandler({store,authorize:async()=>true,now:()=>dateReference})(new Request('http://local/search',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({sources:['cian'],page:2,limit:2,snapshotAt:dateReference.toISOString(),cursor})}));
  const body=await response.json();assert.equal(response.status,200);assert.equal(captured.page,2);assert.equal(captured.limit,2);assert.deepEqual(captured.cursor,cursor);assert.equal(body.items.length,2);assert.equal(body.meta.total,5);assert.equal(body.meta.hasMore,true);assert.equal(body.meta.nextPage,3);assert.deepEqual(body.meta.nextCursor,nextCursor);
});

test('Supabase listing read uses snapshot eligibility, inclusive cutoff and stable keyset ordering',async()=>{
  let requested='';let method='GET';let prefer='';
  const fetchImpl:typeof fetch=async(input,init)=>{
    requested=String(input);method=String(init?.method||'GET');prefer=new Headers(init?.headers).get('Prefer')||'';
    return new Response(JSON.stringify([{
      source:'cian',listing_url:'https://www.cian.ru/rent/commercial/111111111',external_id:'111111111',address:'fixture',freshness_at:dateReference.toISOString(),freshness_kind:'published',first_seen_at:observedAt,last_seen_at:observedAt,market_status:'active',parse_warnings:[],parse_completeness:1,
    },{
      source:'cian',listing_url:'https://www.cian.ru/rent/commercial/222222222',external_id:'222222222',address:'fixture',freshness_at:dateReference.toISOString(),freshness_kind:'published',first_seen_at:'2026-08-19T09:00:00.000Z',last_seen_at:observedAt,market_status:'active',parse_warnings:[],parse_completeness:1,
    }]),{status:200,headers:{'Content-Range':'0-1/205'}});
  };
  const store=new SupabaseListingReadStore(environment({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture'}),fetchImpl);
  const result=await store.readRecent({sources:['cian'],page:1,limit:1,snapshotAt:dateReference.toISOString(),cursor:null,areaMin:null,areaMax:null,floor:null},dateReference);
  assert.equal(method,'GET');assert.equal(prefer,'count=exact');assert.equal(result.total,205);assert.equal(result.items.length,1);assert.equal(result.hasMore,true);assert.equal(result.nextCursor?.listingUrl,'https://www.cian.ru/rent/commercial/111111111');
  assert.match(requested,/freshness_at=gte\./);assert.match(requested,/freshness_at=lte\./);assert.match(requested,/first_seen_at=lte\./);assert.match(requested,/freshness_kind=in\.\(published,updated\)/);assert.match(requested,/market_status=neq\.removed/);assert.match(requested,/order=first_seen_at\.desc,source\.asc,listing_url\.asc/);assert.match(requested,/limit=2/);assert.doesNotMatch(requested,/updated_at=lte\.|offset=/);
});

test('keyset snapshot has no gap or duplicate when hydration mutates updated_at between pages',async()=>{
  const snapshot=dateReference.toISOString(),rows=[
    {source:'cian',listing_url:'https://www.cian.ru/rent/commercial/300000003',external_id:'300000003',address:'A',freshness_at:observedAt,freshness_kind:'published',first_seen_at:'2026-08-20T12:00:00.000Z',last_seen_at:observedAt,updated_at:observedAt,market_status:'active',parse_warnings:[],parse_completeness:1},
    {source:'cian',listing_url:'https://www.cian.ru/rent/commercial/300000002',external_id:'300000002',address:'B',freshness_at:observedAt,freshness_kind:'published',first_seen_at:'2026-08-20T11:00:00.000Z',last_seen_at:observedAt,updated_at:observedAt,market_status:'active',parse_warnings:[],parse_completeness:1},
    {source:'cian',listing_url:'https://www.cian.ru/rent/commercial/300000001',external_id:'300000001',address:'C',freshness_at:observedAt,freshness_kind:'published',first_seen_at:'2026-08-20T10:00:00.000Z',last_seen_at:observedAt,updated_at:observedAt,market_status:'active',parse_warnings:[],parse_completeness:1},
  ];
  const requested:string[]=[];let call=0;
  const fetchImpl:typeof fetch=async(input)=>{requested.push(String(input));call+=1;if(call===1)return new Response(JSON.stringify(rows),{status:200,headers:{'Content-Range':'0-2/3'}});rows[1].updated_at='2026-08-21T09:00:01.000Z';const inserted={...rows[0],listing_url:'https://www.cian.ru/rent/commercial/300000004',external_id:'300000004',first_seen_at:'2026-08-21T09:00:01.000Z'};return new Response(JSON.stringify([rows[2]]),{status:200,headers:{'Content-Range':'0-0/1','X-Fixture-New-Row':inserted.external_id}});};
  const store=new SupabaseListingReadStore(environment({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture'}),fetchImpl);
  const first=await store.readRecent({sources:['cian'],page:1,limit:2,snapshotAt:snapshot,cursor:null,areaMin:null,areaMax:null,floor:null},dateReference);
  const second=await store.readRecent({sources:['cian'],page:2,limit:2,snapshotAt:snapshot,cursor:first.nextCursor,areaMin:null,areaMax:null,floor:null},dateReference);
  assert.deepEqual([...first.items,...second.items].map(item=>item.externalId),['300000003','300000002','300000001']);assert.equal(new Set([...first.items,...second.items].map(item=>item.externalId)).size,3);
  assert.doesNotMatch(requested.join('\n'),/updated_at=lte\.|offset=/);assert.match(requested[0],/first_seen_at=lte\./);assert.match(requested[1],/or=\(first_seen_at\.lt\./);assert.equal(requested.join('\n').includes('300000004'),false);
});

test('duplicate daily discovery slot exits before Browserless',async()=>{
  let calls=0;const store=inertStore({async claimRun(){return{claimed:false,runId:null,recovered:false};}});
  const handler=createRefreshListingsHandler({store,client:{async fetchPage(){calls++;throw new Error('unexpected');}},environment:environment({SLOGI_LISTING_CRON_SECRET:'fixture'}),now:()=>dateReference});
  const response=await handler(new Request('http://local/refresh',{method:'POST',headers:{'x-slogi-listing-cron-secret':'fixture','Content-Type':'application/json'},body:'{"source":"cian"}'}));
  assert.equal(response.status,200);assert.equal(calls,0);assert.equal((await response.json()).outcome.status,'duplicate');
});

test('duplicate hourly hydration slot exits before Browserless',async()=>{
  let calls=0;const store=inertStore({async claimRun(){return{claimed:false,runId:null,recovered:false};}});
  const handler=createHydrateListingsHandler({store,client:{async fetchPage(){calls++;throw new Error('unexpected');}},environment:environment({SLOGI_LISTING_CRON_SECRET:'fixture'}),now:()=>dateReference,workerId:()=> '11111111-1111-4111-8111-111111111111'});
  const response=await handler(new Request('http://local/hydrate',{method:'POST',headers:{'x-slogi-listing-cron-secret':'fixture','Content-Type':'application/json'},body:'{"source":"cian"}'}));
  assert.equal(response.status,200);assert.equal(calls,0);assert.equal((await response.json()).outcome.status,'duplicate');
});

test('discovery and hydration slots advance within the same UTC day without provider calls',async()=>{
  const capture=async(kind:'discovery'|'hydration',at:string)=>{
    let slot='';
    const store=inertStore({async claimRun(_source,phase,runSlot){assert.equal(phase,kind);slot=runSlot;return{claimed:false,runId:null,recovered:false};}});
    const common={store,client:{async fetchPage(){throw new Error('unexpected_provider_call');}},environment:environment({SLOGI_LISTING_CRON_SECRET:'fixture'}),now:()=>new Date(at)};
    const handler=kind==='discovery'?createRefreshListingsHandler(common):createHydrateListingsHandler({...common,workerId:()=> '11111111-1111-4111-8111-111111111111'});
    const response=await handler(new Request('http://local/slot',{method:'POST',headers:{'x-slogi-listing-cron-secret':'fixture','Content-Type':'application/json'},body:'{"source":"cian"}'}));
    assert.equal(response.status,200);return slot;
  };
  assert.equal(await capture('discovery','2026-08-28T07:59:00Z'),'2026-08-28T06:00:00.000Z');
  assert.equal(await capture('discovery','2026-08-28T13:01:00Z'),'2026-08-28T12:00:00.000Z');
  assert.equal(await capture('hydration','2026-08-28T07:59:00Z'),'2026-08-28T07:00:00.000Z');
  assert.equal(await capture('hydration','2026-08-28T08:01:00Z'),'2026-08-28T08:00:00.000Z');
});

test('discovery advances the durable backfill cursor and resets on old-only or empty pages',async()=>{
  const state=scanState(2);let runId=0,providerCalls=0;const finished:any[]=[];
  const store=inertStore({
    async claimRun(){return{claimed:true,runId:++runId,recovered:false};},async getState(){return state;},
    async saveState(next){Object.assign(state,next);},async finishRun(_id,update){finished.push(update);},
    async enqueue(_source,priority,items){return items.map(entry=>({listingUrl:entry.listingUrl,queueStatus:priority==='backfill'&&state.nextPage===4?'discarded_old':'pending',queuedNew:true}));},
  });
  const client={async fetchPage(){providerCalls++;return providerCalls===8
    ?page('<p>По вашему запросу ничего не найдено</p>')
    :page('',[`https://www.cian.ru/rent/commercial/${200000000+providerCalls}`]);}};
  const invoke=async(at:string)=>{
    const handler=createRefreshListingsHandler({store,client,environment:environment({SLOGI_LISTING_CRON_SECRET:'fixture'}),now:()=>new Date(at)});
    const response=await handler(new Request('http://local/refresh',{method:'POST',headers:{'x-slogi-listing-cron-secret':'fixture','Content-Type':'application/json'},body:'{"source":"cian"}'}));
    assert.equal(response.status,200);return (await response.json()).outcome;
  };
  const first=await invoke('2026-08-28T00:10:00Z');assert.equal(first.cursorBefore,2);assert.equal(first.cursorAfter,3);
  const second=await invoke('2026-08-28T06:10:00Z');assert.equal(second.cursorBefore,3);assert.equal(second.cursorAfter,4);
  const oldOnly=await invoke('2026-08-28T12:10:00Z');assert.equal(oldOnly.cursorBefore,4);assert.equal(oldOnly.cursorAfter,2);assert.equal(oldOnly.cursorResetReason,'deep_page_old_only');
  const empty=await invoke('2026-08-28T18:10:00Z');assert.equal(empty.cursorBefore,2);assert.equal(empty.cursorAfter,2);assert.equal(empty.cursorResetReason,'deep_page_empty');
  assert.equal(providerCalls,8);assert.equal(finished.length,4);assert.ok(finished.every(value=>value.status==='ok'));
});

function partialListingHtml(freshnessAt:string|null):string{
  const date=freshnessAt?`,"datePublished":"${freshnessAt}"`:'';
  return `<script type="application/ld+json">{"@type":"Offer","name":"Неполное объявление"${date}}</script>`;
}

async function hydrateCase(options:{
  html:string;
  now?:Date;
  initialAttemptCount?:number;
  persistResult?:{inserted:number;updated:number};
}){
  const now=options.now||dateReference,state=scanState(),item={...queueItem(1),attemptCount:options.initialAttemptCount||0};
  let providerCalls=0,persistCalls=0,queueFinish:any=null,runFinish:any=null;
  const persisted:NormalizedListing[]=[];
  const store=inertStore({
    async claimRun(){return{claimed:true,runId:1,recovered:false};},async getState(){return state;},
    async saveState(next){Object.assign(state,next);},async finishRun(_id,update){runFinish=update;},
    async claimQueue(_source,workerId){item.status='processing';item.lockedBy=workerId;item.attemptCount+=1;return[item];},
    async finishQueue(_id,_workerId,update){queueFinish=update;item.status=update.status;item.nextAttemptAt=update.nextAttemptAt||update.finishedAt;item.lockedBy=null;return true;},
    async persistRecent(_source,listings){persistCalls+=1;persisted.push(...listings);return options.persistResult||{inserted:1,updated:0};},
    async markRemoved(){throw new Error('unexpected_removed');},
  });
  const handler=createHydrateListingsHandler({
    store,client:{async fetchPage(){providerCalls+=1;return page(options.html);}},
    environment:environment({SLOGI_LISTING_CRON_SECRET:'fixture'}),now:()=>now,
    workerId:()=> '11111111-1111-4111-8111-111111111111',
  });
  const response=await handler(new Request('http://local/hydrate',{method:'POST',headers:{'x-slogi-listing-cron-secret':'fixture','Content-Type':'application/json'},body:'{"source":"cian"}'}));
  assert.equal(response.status,200);
  return{body:await response.json(),item,persisted,persistCalls,providerCalls,queueFinish,runFinish};
}

test('reliable recent partial listing persists nulls and warnings once, then completes terminally',async()=>{
  const recent=new Date(dateReference.getTime()-86400000).toISOString();
  const result=await hydrateCase({html:partialListingHtml(recent),persistResult:{inserted:1,updated:0}});
  assert.equal(result.providerCalls,1);assert.equal(result.persistCalls,1);assert.equal(result.persisted.length,1);
  const value=result.persisted[0];assert.equal(value.address,null);assert.equal(value.area,null);assert.equal(value.rentMonthly,null);assert.ok(value.parseWarnings.includes('partial_listing'));assert.ok(value.parseCompleteness<1);
  assert.equal(result.item.status,'completed');assert.equal(result.queueFinish.status,'completed');assert.equal(result.queueFinish.nextAttemptAt,null);assert.equal(result.queueFinish.errorCode,'partial_listing_persisted');
  assert.equal(result.body.outcome.status,'ok');assert.equal(result.body.outcome.completed,1);assert.equal(result.body.outcome.retry,0);
  assert.deepEqual(result.runFinish.metrics,{claimed:1,attempted:1,parsed:1,partial:1,blocked:0,failed:0,inserted:1,updated:0,skipped_old:0,skipped_unknown_date:0});
});

test('reliable partial listing at the exact inclusive 30-day boundary persists',async()=>{
  const boundary=new Date(dateReference.getTime()-30*86400000).toISOString();
  const result=await hydrateCase({html:partialListingHtml(boundary),persistResult:{inserted:0,updated:1}});
  assert.equal(result.persistCalls,1);assert.equal(result.item.status,'completed');assert.equal(result.queueFinish.errorCode,'partial_listing_persisted');
  assert.equal(result.runFinish.metrics.parsed,1);assert.equal(result.runFinish.metrics.partial,1);assert.equal(result.runFinish.metrics.inserted,0);assert.equal(result.runFinish.metrics.updated,1);
});

test('real server store preserves partial-over-complete fields without widening complete merge semantics',async()=>{
  const existing={
    source:'cian',listing_url:'https://www.cian.ru/rent/commercial/111111111',external_id:'111111111',title:'Надёжный офис',address:'Москва, Тверская улица, 12',description:'Проверенное описание',cluster_name:'Тверской',area:180,floor:3,total_floors:9,ceiling_height:3.4,rent_monthly:450000,previous_rent_monthly:430000,latitude:55.7641,longitude:37.6045,first_seen_at:'2026-08-01T09:00:00.000Z',published_at:observedAt,source_updated_at:observedAt,freshness_at:observedAt,freshness_kind:'published',date_confidence:'high',price_changed:true,
  };
  let upsert:any[]=[],historyCalls=0;
  const fetchImpl:typeof fetch=async(input,init)=>{
    const url=String(input),method=String(init?.method||'GET');
    if(method==='GET'&&url.includes('slogi_market_listings?'))return new Response(JSON.stringify([existing]),{status:200});
    if(method==='POST'&&url.includes('slogi_market_listings?on_conflict=')){upsert=JSON.parse(String(init?.body||'[]'));return new Response('',{status:201});}
    if(method==='POST'&&url.includes('slogi_market_price_history')){historyCalls+=1;return new Response('',{status:201});}
    throw new Error('unexpected_store_request');
  };
  const store=new SupabaseListingServerStore(environment({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture'}),fetchImpl);
  const partial=listing({title:null,address:'',description:null,clusterName:'',area:null,floor:null,totalFloors:null,ceilingHeight:null,rentMonthly:null,latitude:null,longitude:null,parseCompleteness:.35,parseWarnings:['partial_listing','missing_address','missing_area','missing_rent'],dateWarnings:[]});
  const result=await store.persistRecent('cian',[partial],'2026-08-21T10:00:00.000Z');
  assert.deepEqual(result,{inserted:0,updated:1});assert.equal(upsert.length,1);assert.equal(historyCalls,0);
  const row=upsert[0];assert.equal(row.title,existing.title);assert.equal(row.address,existing.address);assert.equal(row.description,existing.description);assert.equal(row.cluster_name,existing.cluster_name);assert.equal(row.area,existing.area);assert.equal(row.floor,existing.floor);assert.equal(row.total_floors,existing.total_floors);assert.equal(row.ceiling_height,existing.ceiling_height);assert.equal(row.rent_monthly,existing.rent_monthly);assert.equal(row.latitude,existing.latitude);assert.equal(row.longitude,existing.longitude);assert.equal(row.first_seen_at,existing.first_seen_at);assert.equal(row.previous_rent_monthly,existing.previous_rent_monthly);assert.equal(row.price_changed,true);assert.equal(row.parse_completeness,.35);assert.deepEqual(row.parse_warnings,partial.parseWarnings);
  const complete=listing({description:null,latitude:null,longitude:null,previousRentMonthly:null,parseWarnings:[],dateWarnings:[]});
  await store.persistRecent('cian',[complete],'2026-08-21T11:00:00.000Z');
  const completeRow=upsert[0];assert.equal(completeRow.description,null);assert.equal(completeRow.latitude,null);assert.equal(completeRow.longitude,null);assert.equal(completeRow.previous_rent_monthly,null);assert.equal(completeRow.price_changed,false);
});

test('unknown-date partial listing is never persisted and uses only the bounded date retry',async()=>{
  const first=await hydrateCase({html:partialListingHtml(null),initialAttemptCount:0});
  assert.equal(first.persistCalls,0);assert.equal(first.item.status,'retry');assert.equal(first.queueFinish.errorCode,'missing_or_invalid_freshness_date');assert.ok(first.queueFinish.nextAttemptAt);assert.equal(first.runFinish.metrics.parsed,1);assert.equal(first.runFinish.metrics.partial,1);
  const terminal=await hydrateCase({html:partialListingHtml(null),initialAttemptCount:HYDRATION_LIMITS.unknownDateMaxAttempts-1});
  assert.equal(terminal.persistCalls,0);assert.equal(terminal.providerCalls,1);assert.equal(terminal.item.attemptCount,HYDRATION_LIMITS.unknownDateMaxAttempts);assert.equal(terminal.item.status,'discarded_unknown_date');assert.equal(terminal.queueFinish.nextAttemptAt,null);assert.equal(terminal.body.outcome.retry,0);assert.equal(terminal.body.outcome.discardedUnknownDate,1);
});

test('old partial listing is terminal discarded_old and never persisted',async()=>{
  const old=new Date(dateReference.getTime()-30*86400000-1).toISOString();
  const result=await hydrateCase({html:partialListingHtml(old)});
  assert.equal(result.persistCalls,0);assert.equal(result.providerCalls,1);assert.equal(result.item.status,'discarded_old');assert.equal(result.queueFinish.status,'discarded_old');assert.equal(result.queueFinish.nextAttemptAt,null);
  assert.equal(result.runFinish.metrics.parsed,1);assert.equal(result.runFinish.metrics.partial,1);assert.equal(result.runFinish.metrics.skipped_old,1);
});

test('complete recent hydration behavior and counters remain unchanged',async()=>{
  const freshComplete=`<script type="application/ld+json">{"datePublished":"2026-08-20T09:00:00Z"}</script>${fixture('cian-listing.html')}`;
  const result=await hydrateCase({html:freshComplete,persistResult:{inserted:0,updated:1}});
  assert.equal(result.persistCalls,1);assert.equal(result.persisted.length,1);assert.equal(result.item.status,'completed');assert.equal(result.queueFinish.errorCode,null);
  assert.equal(result.body.outcome.status,'ok');assert.equal(result.body.outcome.completed,1);assert.deepEqual(result.runFinish.metrics,{claimed:1,attempted:1,parsed:1,partial:0,blocked:0,failed:0,inserted:0,updated:1,skipped_old:0,skipped_unknown_date:0});
});

test('queue SQL recovers stale processing rows without loss and claims deterministically',()=>{
  const sql=readFileSync(join(repositoryDirectory,'supabase','migrations','20260821_7610_listing_refresh.sql'),'utf8');
  assert.match(sql,/status = 'retry'[\s\S]*status = 'processing'[\s\S]*locked_at <= p_stale_before/);
  assert.match(sql,/for update skip locked[\s\S]*limit v_limit/);
  assert.match(sql,/unique \(source, listing_url\)/);
  assert.match(sql,/least\(2, coalesce\(p_batch_limit, 1\)\)/);
});
test('listing migration is Cian-only, durable and server-only',()=>{
  const sql=readFileSync(join(repositoryDirectory,'supabase','migrations','20260821_7610_listing_refresh.sql'),'utf8');
  assert.match(sql,/create table public\.slogi_listing_fetch_queue/);assert.match(sql,/for update skip locked/i);assert.match(sql,/unique \(source, phase, run_slot\)/);assert.match(sql,/check \(source = 'cian'\)/);assert.match(sql,/security definer[\s\S]*set search_path = pg_catalog, public/i);assert.match(sql,/revoke all on public\.slogi_listing_fetch_queue from public, anon, authenticated, service_role/i);assert.equal(/avito|apify|inpars|ozon/i.test(sql),false);
});

test('shared workspace schema uses membership RLS, fixed search_path and CAS',()=>{
  const sql=readFileSync(join(repositoryDirectory,'supabase','migrations','20260823_7611_shared_workspace.sql'),'utf8');
  assert.match(sql,/create table public\.slogi_shared_workspaces/);assert.match(sql,/create table public\.slogi_shared_workspace_members/);assert.match(sql,/create table public\.slogi_shared_workspace_state/);assert.match(sql,/enable row level security/);assert.match(sql,/set search_path = pg_catalog, public/);assert.match(sql,/workspace_revision_conflict/);assert.match(sql,/where workspace_state\.workspace_id = p_workspace_id[\s\S]*workspace_state\.revision = p_expected_revision/);assert.match(sql,/revoke all on public\.slogi_shared_workspaces from public, anon, authenticated, service_role/);assert.equal(/grant[^;]+slogi_shared_workspaces to authenticated/i.test(sql),false);
});

test('rolling schedule is inactive, Cian-only and resolves secrets from Vault',()=>{
  const sql=readFileSync(join(repositoryDirectory,'supabase','schedules','cian-listings-daily.sql.example'),'utf8');
  assert.match(sql,/INACTIVE BY DESIGN/);assert.match(sql,/vault\.decrypted_secrets/);assert.match(sql,/10 0,6,12,18 \* \* \*/);assert.match(sql,/25 \* \* \* \*/);assert.match(sql,/body := '\{"source":"cian"\}'::jsonb/);assert.equal(/batchSize/.test(sql),false);assert.equal(/^\s*select cron\.schedule/m.test(sql),false);assert.equal(/avito|apify|inpars|ozon/i.test(sql),false);
});

test('scheduler activation changes only the two guarded Cian cadences and has an exact rollback',()=>{
  const activation=readFileSync(join(repositoryDirectory,'supabase','schedules','cian-listings-v7616-activate.sql'),'utf8');
  const rollback=readFileSync(join(repositoryDirectory,'supabase','schedules','cian-listings-v7616-rollback.sql'),'utf8');
  for(const sql of [activation,rollback]){
    assert.match(sql,/^begin;/m);assert.match(sql,/^commit;/m);assert.match(sql,/cian_scheduler_contract_mismatch/);
    assert.match(sql,/slogi-cian-daily-discovery/);assert.match(sql,/slogi-cian-daily-hydration/);
    assert.equal(/cron\.schedule|cron\.unschedule|delete\s+from|insert\s+into|update\s+cron\.job/i.test(sql),false);
    assert.equal(/avito|ozon/i.test(sql.replace(/command not like '%(?:avito|ozon)%'/g,'')),false);
  }
  assert.match(activation,/10 0,6,12,18 \* \* \*/);assert.match(activation,/25 \* \* \* \*/);
  assert.match(rollback,/10 3 \* \* \*/);assert.match(rollback,/25 3 \* \* \*/);
});

test('frontend search sends Auth, reads only, and exposes disabled future source',()=>{
  const js=readFileSync(join(repositoryDirectory,'cian-workspace.js'),'utf8');const html=readFileSync(join(repositoryDirectory,'available-spaces.html'),'utf8');
  assert.match(js,/Authorization/);assert.match(js,/getAccessToken/);assert.match(js,/feed\.loadAllPages/);assert.match(html,/cian-listing-feed\.js/);assert.equal(/persist|update-clusters|refresh-listings|hydrate-listings/.test(js),false);assert.match(html,/<h2>Авито<\/h2><p>Подключение готовится<\/p>/);assert.equal(/data-source="avito"|available-source/.test(html),false);
});

test('hotfix navigation exposes the four product sections in the approved order',()=>{
  const shell=readFileSync(join(repositoryDirectory,'professional-shell.js'),'utf8');
  const block=shell.match(/const productLinks=\[([\s\S]*?)\];/)?.[1]||'';
  const labels=[...block.matchAll(/\['(?:search|premises|estimate|repair)','[^']+','([^']+)'/g)].map(match=>match[1]);
  assert.deepEqual(labels.slice(0,4),['Поиск помещений','Мои помещения','Смета и КП','Ремонт']);
  assert.equal(/Пространство специалиста|Предложения ЦИАН/.test(shell),false);
});

test('Cian workspace uses canonical clusters and renders measurable map polygons',()=>{
  const js=readFileSync(join(repositoryDirectory,'cian-workspace.js'),'utf8');const html=readFileSync(join(repositoryDirectory,'available-spaces.html'),'utf8');
  assert.match(html,/id="available-cluster"/);assert.match(html,/Все кластеры/);assert.match(html,/Кластер не определён/);
  assert.match(js,/service\.findByCoordinates/);assert.match(js,/new window\.ymaps\.Polygon/);assert.match(js,/dataset\.clusterPolygons/);
  assert.equal(/fetch\([^)]*cian\.ru/i.test(js),false);
});

test('adding a Cian listing follows the existing project domain path and deduplicates',()=>{
  const services=readFileSync(join(repositoryDirectory,'phase0-services.js'),'utf8');const workspace=readFileSync(join(repositoryDirectory,'cian-workspace.js'),'utf8');
  assert.match(services,/findByListing\('cian'/);assert.match(services,/async addMarketListing\(listing\)/);assert.match(services,/this\.save\(\{listingUrl:url/);
  assert.match(services,/source!=='cian'&&clusterApi\.findNearestByCoordinates/);
  assert.match(workspace,/service\.addMarketListing\(item\)/);assert.match(workspace,/SlogiCloud\.sync\(\)/);
  assert.equal(/localStorage\.setItem\([^,]+,\s*JSON\.stringify\(item\)/.test(workspace),false);
});

test('shared workspace recognizes PostgreSQL revision conflict returned as HTTP 500',()=>{
  const shared=readFileSync(join(repositoryDirectory,'shared-workspace.js'),'utf8');
  assert.match(shared,/response\.status!==500/);assert.match(shared,/payload\.code==='40001'/);assert.match(shared,/payload\.message==='workspace_revision_conflict'/);assert.match(shared,/await isRevisionConflict\(response\)/);
});

test('legacy personal account client and UI references are removed',()=>{
  const shell=readFileSync(join(repositoryDirectory,'professional-shell.js'),'utf8');const shared=readFileSync(join(repositoryDirectory,'shared-workspace.js'),'utf8');
  assert.equal(/Личный кабинет|Войти|Регистрац|Восстановлен|logout|signout|slogi-account/i.test(shell+shared),false);assert.match(shared,/\/auth\/v1\/signup/);assert.match(shared,/is_anonymous/);assert.match(shared,/p_expected_revision/);
});

test('permanent purge removes only trash-authorized locations from shared state',()=>{
  const core=readFileSync(join(repositoryDirectory,'professional-core.js'),'utf8');
  const pages=readFileSync(join(repositoryDirectory,'professional-pages.js'),'utf8');
  assert.match(core,/function purgeProjects\(ids\)/);
  assert.match(core,/trashIds=new Set/);
  assert.match(core,/allowed=new Set\(\[\.\.\.requested\]\.filter\(id=>trashIds\.has\(id\)\)\)/);
  assert.match(core,/remaining=locations\.filter\(x=>!allowed\.has/);
  assert.match(core,/writeLocations\(remaining,'project-purge'\)/);
  assert.match(core,/function purgeAllProjects\(\)/);
  assert.match(pages,/P\.purgeProject\(b\.dataset\.purge\)/);
});

test('Edge configuration enforces JWT on all release functions',()=>{
  const config=readFileSync(join(repositoryDirectory,'supabase','config.toml'),'utf8');
  for(const name of ['import-listing','search-listings','refresh-listings','hydrate-listings','password-gate'])assert.match(config,new RegExp(`\\[functions\\.${name.replace('-','\\-')}\\][\\s\\S]{0,50}verify_jwt = true`));
});
