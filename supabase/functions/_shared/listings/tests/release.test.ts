import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { BROWSERLESS_LIMITS, resolveBrowserlessTimeoutProfile, resolveHourlyBrowserlessPolicy } from '../browserless.ts';
import { extractListingDates, listingFreshnessDecision } from '../freshness.ts';
import { pageBlockReason } from '../parsing.ts';
import { CianListingProvider } from '../providers/cian.ts';
import type { ListingServerStore } from '../server-store.ts';
import type { BrowserlessPage, NormalizedListing } from '../types.ts';
import { createHydrateListingsHandler, HYDRATION_LIMITS } from '../../../hydrate-listings/index.ts';
import { createImportListingHandler } from '../../../import-listing/index.ts';
import { createJoinWorkspaceHandler } from '../../../join-workspace/index.ts';
import { createRefreshListingsHandler, DISCOVERY_LIMITS } from '../../../refresh-listings/index.ts';
import { createSearchListingsHandler, parseSearchRequest, type ListingReadStore } from '../../../search-listings/index.ts';

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

test('daily run hard budgets are bounded and sequential',()=>{
  assert.equal(DISCOVERY_LIMITS.browserlessCalls,2);assert.equal(DISCOVERY_LIMITS.concurrency,1);assert.equal(HYDRATION_LIMITS.hardBatch,2);assert.equal(HYDRATION_LIMITS.hardConcurrency,1);assert.equal(HYDRATION_LIMITS.browserlessCallsPerItem,1);assert.ok(BROWSERLESS_LIMITS.hardClientTimeoutMs<=75000);
});

test('manual import uses one Cian smart-scrape call without unblock or retry',async()=>{
  let captured:any=null;
  const handler=createImportListingHandler({client:{async fetchPage(_url,options){captured=options;return page(fixture('cian-listing.html'));}},now:()=>new Date(observedAt)});
  const result=await handler(new Request('http://local/import-listing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://www.cian.ru/rent/commercial/111111111'})}));
  assert.equal(result.status,200);assert.deepEqual(captured.strategies,['smart-scrape']);assert.equal(captured.allowUnblock,false);assert.equal(captured.directUnblock,false);assert.equal(captured.retryCount,0);
});

test('search request allowlist accepts only Cian and rejects crawler actions',()=>{
  assert.equal(parseSearchRequest({sources:['cian']}).ok,true);assert.equal(parseSearchRequest({sources:['avito']}).ok,false);assert.equal(parseSearchRequest({sources:['cian'],persist:true}).ok,false);
});

test('search requires a bearer session before any database read',async()=>{
  let reads=0;const store:ListingReadStore={async readRecent(){reads++;return[];},async readScanStates(){reads++;return[];}};
  const result=await createSearchListingsHandler({store})(new Request('http://local/search',{method:'POST',body:'{}'}));
  assert.equal(result.status,401);assert.equal(reads,0);
});

test('search reads saved rows only and applies recent/removed filter',async()=>{
  const recent=listing({freshnessAt:new Date(dateReference.getTime()-29*86400000).toISOString()});
  const old=listing({listingUrl:'https://www.cian.ru/rent/commercial/222222222',freshnessAt:new Date(dateReference.getTime()-31*86400000).toISOString()});
  const removed=listing({listingUrl:'https://www.cian.ru/rent/commercial/333333333',marketStatus:'removed'});
  let reads=0;const store:ListingReadStore={async readRecent(){reads++;return[old,removed,recent];},async readScanStates(){reads++;return[];}};
  const response=await createSearchListingsHandler({store,now:()=>dateReference})(new Request('http://local/search',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:'{}'}));
  const body=await response.json();assert.equal(reads,2);assert.deepEqual(body.items.map((entry:NormalizedListing)=>entry.listingUrl),[recent.listingUrl]);
});

test('duplicate daily discovery slot exits before Browserless',async()=>{
  let calls=0;const store=inertStore({async claimRun(){return{claimed:false,runId:null,recovered:false};}});
  const handler=createRefreshListingsHandler({store,client:{async fetchPage(){calls++;throw new Error('unexpected');}},environment:environment({SLOGI_LISTING_CRON_SECRET:'fixture'}),now:()=>dateReference});
  const response=await handler(new Request('http://local/refresh',{method:'POST',headers:{'x-slogi-listing-cron-secret':'fixture','Content-Type':'application/json'},body:'{"source":"cian"}'}));
  assert.equal(response.status,200);assert.equal(calls,0);assert.equal((await response.json()).outcome.status,'duplicate');
});

test('duplicate daily hydration slot exits before Browserless',async()=>{
  let calls=0;const store=inertStore({async claimRun(){return{claimed:false,runId:null,recovered:false};}});
  const handler=createHydrateListingsHandler({store,client:{async fetchPage(){calls++;throw new Error('unexpected');}},environment:environment({SLOGI_LISTING_CRON_SECRET:'fixture'}),now:()=>dateReference,workerId:()=> '11111111-1111-4111-8111-111111111111'});
  const response=await handler(new Request('http://local/hydrate',{method:'POST',headers:{'x-slogi-listing-cron-secret':'fixture','Content-Type':'application/json'},body:'{"source":"cian"}'}));
  assert.equal(response.status,200);assert.equal(calls,0);assert.equal((await response.json()).outcome.status,'duplicate');
});

test('invalid workspace code is generic and does not call provider',async()=>{
  let calls=0;const handler=createJoinWorkspaceHandler({fetch:async()=>{calls++;return new Response();}});
  const response=await handler(new Request('http://local/join',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:'{"code":"short"}'}));
  assert.equal(response.status,404);assert.equal(calls,0);assert.equal((await response.json()).error,'Рабочее пространство недоступно.');
});

test('workspace join sends only a hash to the privileged RPC',async()=>{
  const rawCode='SyntheticWorkspaceCode_0123456789_ABCDEF';let rpcBody='';let calls=0;
  const handler=createJoinWorkspaceHandler({environment:environment({SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SLOGI_WORKSPACE_CODE_PEPPER:'fixture-pepper-value-with-at-least-32-characters'}),fetch:async(input,init)=>{calls++;const url=String(input);if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:'11111111-1111-4111-8111-111111111111',is_anonymous:true}),{status:200});rpcBody=String(init&&init.body||'');return new Response(JSON.stringify('22222222-2222-4222-8222-222222222222'),{status:200});}});
  const response=await handler(new Request('http://local/join',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({code:rawCode})}));
  assert.equal(response.status,200);assert.equal(calls,2);assert.equal(rpcBody.includes(rawCode),false);assert.match(rpcBody,/[0-9a-f]{64}/);
});

test('listing migration is Cian-only, durable and server-only',()=>{
  const sql=readFileSync(join(repositoryDirectory,'supabase','migrations','20260821_7610_listing_refresh.sql'),'utf8');
  assert.match(sql,/create table public\.slogi_listing_fetch_queue/);assert.match(sql,/for update skip locked/i);assert.match(sql,/unique \(source, phase, run_slot\)/);assert.match(sql,/check \(source = 'cian'\)/);assert.match(sql,/security definer[\s\S]*set search_path = pg_catalog, public/i);assert.match(sql,/revoke all on public\.slogi_listing_fetch_queue from public, anon, authenticated, service_role/i);assert.equal(/avito|apify|inpars|ozon/i.test(sql),false);
});

test('shared workspace schema uses membership RLS, fixed search_path and CAS',()=>{
  const sql=readFileSync(join(repositoryDirectory,'supabase','migrations','20260823_7611_shared_workspace.sql'),'utf8');
  assert.match(sql,/create table public\.slogi_shared_workspaces/);assert.match(sql,/create table public\.slogi_shared_workspace_members/);assert.match(sql,/create table public\.slogi_shared_workspace_state/);assert.match(sql,/enable row level security/);assert.match(sql,/set search_path = pg_catalog, public/);assert.match(sql,/workspace_revision_conflict/);assert.match(sql,/where workspace_state\.workspace_id = p_workspace_id[\s\S]*workspace_state\.revision = p_expected_revision/);assert.match(sql,/revoke all on public\.slogi_shared_workspaces from public, anon, authenticated, service_role/);assert.equal(/grant[^;]+slogi_shared_workspaces to authenticated/i.test(sql),false);
});

test('daily schedule is inactive, Cian-only and resolves secrets from Vault',()=>{
  const sql=readFileSync(join(repositoryDirectory,'supabase','schedules','cian-listings-daily.sql.example'),'utf8');
  assert.match(sql,/INACTIVE BY DESIGN/);assert.match(sql,/vault\.decrypted_secrets/);assert.match(sql,/"source":"cian"/);assert.equal(/^\s*select cron\.schedule/m.test(sql),false);assert.equal(/avito|apify|inpars|ozon/i.test(sql),false);
});

test('frontend search sends Auth, reads only, and exposes disabled future source',()=>{
  const js=readFileSync(join(repositoryDirectory,'cian-workspace.js'),'utf8');const html=readFileSync(join(repositoryDirectory,'available-spaces.html'),'utf8');
  assert.match(js,/Authorization/);assert.match(js,/getAccessToken/);assert.equal(/persist|update-clusters|refresh-listings|hydrate-listings/.test(js),false);assert.match(html,/Авито — подключение готовится/);assert.equal(/data-source="avito"|available-source/.test(html),false);
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

test('Edge configuration enforces JWT on all release functions',()=>{
  const config=readFileSync(join(repositoryDirectory,'supabase','config.toml'),'utf8');
  for(const name of ['import-listing','search-listings','refresh-listings','hydrate-listings','join-workspace'])assert.match(config,new RegExp(`\\[functions\\.${name.replace('-','\\-')}\\][\\s\\S]{0,50}verify_jwt = true`));
});
