'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const geometry=require('../cluster-geometry.js');
const mapData=require('../cian-map-data.js');
const feed=require('../cian-listing-feed.js');

const ROOT=path.join(__dirname,'..');
const POLYGONS=JSON.parse(fs.readFileSync(path.join(ROOT,'clusters.geojson'),'utf8'));
const NOW=Date.parse('2026-08-28T12:00:00.000Z');
const clusterService={locate:(lat,lng)=>geometry.locate(POLYGONS,lat,lng)};
const PROJECT_URL='https://fixture-ref.supabase.co';
const GEOCODE_ENDPOINT=PROJECT_URL+'/functions/v1/geocode-address';

function listing(id,overrides={}){return{source:'cian',externalId:String(id),listingUrl:`https://www.cian.ru/rent/commercial/${id}`,address:'Москва, тестовый адрес, 1',freshnessAt:new Date(NOW-86400000).toISOString(),freshnessKind:'published',marketStatus:'active',area:100,floor:1,premiseType:'office',hasBasementOrSocle:false,rentMonthly:300000,pricePerSquareMeter:3000,clusterId:'',clusterName:'',clusterStatus:'not_computed',...overrides};}
function savedCianProject(id,overrides={}){return{id:`project-${id}`,address:'Москва, тестовый адрес, 1',geo:null,area:120,phase0:{source:'cian',externalId:String(id),listingUrl:`https://www.cian.ru/rent/commercial/${id}`,listingTitle:`Помещение ${id}`,rent:{amount:360000}},...overrides};}
function memoryStorage(){const values=new Map();return{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value))};}
function response(status,payload,headers={}){return{ok:status>=200&&status<300,status,headers:{get:name=>headers[String(name).toLowerCase()]||null},json:async()=>payload};}

test('null, blank and partial coordinate pairs are never treated as real coordinates',()=>{
  assert.equal(mapData.coordinates({latitude:null,longitude:null}),null);assert.equal(mapData.coordinates({latitude:'',longitude:''}),null);assert.equal(mapData.coordinates({latitude:55.84,longitude:null}),null);
  assert.equal(geometry.locate(POLYGONS,null,null).status,'invalid');
});

test('canonical source contains exactly 58 uniquely named polygons and browser data is identical',()=>{
  const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'clusters-data.js'),'utf8'),sandbox);
  assert.equal(POLYGONS.features.length,58);assert.equal(new Set(POLYGONS.features.map(feature=>feature.properties.name)).size,58);
  assert.equal(sandbox.window.SLOGI_CLUSTERS_GEOJSON.features.length,58);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.SLOGI_CLUSTERS_GEOJSON)),POLYGONS);
});

test('point-in-polygon is deterministic for inside, outside and boundary points',()=>{
  const inside=geometry.locate(POLYGONS,55.84,37.36),outside=geometry.locate(POLYGONS,56,38),boundary=geometry.locate(POLYGONS,55.834088,37.388049);
  assert.deepEqual({status:inside.status,id:inside.clusterId,name:inside.clusterName,boundary:inside.boundary},{status:'inside',id:'Митино',name:'Митино',boundary:false});
  assert.deepEqual({status:outside.status,id:outside.clusterId,name:outside.clusterName},{status:'outside',id:'',name:''});
  assert.deepEqual({status:boundary.status,id:boundary.clusterId,name:boundary.clusterName,boundary:boundary.boundary},{status:'inside',id:'Митино',name:'Митино',boundary:true});
  assert.equal(geometry.locate(POLYGONS,55.834088,37.388049).canonicalIndex,0);
});

test('administrative district text is never treated as exact SLOGI polygon containment',()=>{
  const item=listing(10,{address:'Москва, ЮВАО, р-н Лефортово, ш. Энтузиастов, 3к1',latitude:55.7480696,longitude:37.6904566});
  assert.equal(mapData.inferAddressCluster(item.address),'Лефортово');
  mapData.classify(item,clusterService);
  assert.deepEqual({name:item.clusterName,status:item.clusterStatus,boundary:item.clusterBoundary,source:item.clusterResolutionSource},{name:'',status:'outside',boundary:false,source:'automatic'});
});

test('address variants keep raw input, remove administrative noise and normalize building parts',()=>{
  const raw='Москва, ЮВАО, р-н Лефортово, ш. Энтузиастов, 3к1';
  const variants=mapData.addressQueryVariants(raw);
  assert.equal(variants[0],raw);
  assert.ok(variants.includes('Москва, ш. Энтузиастов, 3к1'));
  assert.ok(variants.includes('Москва, ш. Энтузиастов, 3 корпус 1'));
  assert.ok(mapData.addressQueryVariants('Москва, Тверская, 3с1').includes('Москва, Тверская, 3 строение 1'));
  assert.ok(mapData.addressQueryVariants('Москва, Тверская, 3 корп. 2').includes('Москва, Тверская, 3 корпус 2'));
  assert.ok(mapData.addressQueryVariants('Москва, р-н Лефортово, м. Авиамоторная, ш. Энтузиастов, 3к1').includes('Москва, ш. Энтузиастов, 3 корпус 1'));
  const withoutRegion=mapData.addressQueryVariants('ш. Энтузиастов, 3к1');
  assert.ok(withoutRegion.includes('Москва, ш. Энтузиастов, 3к1'));
  assert.ok(withoutRegion.includes('Московская область, ш. Энтузиастов, 3 корпус 1'));
});

test('same normalized address is geocoded once while distinct canonical listings keep distinct markers and exact clusters',async()=>{
  const items=[listing(1,{address:' Москва,  Тестовая улица, 1 '}),listing(2,{address:'москва, тестовая улица , 1'})];let calls=0;
  await mapData.geocodeMissingListings(items,{clusterService,geocode:async()=>{calls++;return{status:'geocoded',attempts:1,latitude:55.84,longitude:37.36};}});
  const state=mapData.projection(items);
  assert.equal(calls,1);assert.equal(state.markerCount,2);assert.equal(new Set(state.markers.map(mapData.listingId)).size,2);
  assert.ok(items.every(item=>item.clusterId==='Митино'&&item.clusterName==='Митино'&&item.clusterStatus==='inside'&&item.clusterResolutionSource==='automatic'));
});

test('failed server falls back through browser address variants to exact polygon containment',async()=>{
  const address='Москва, ЮВАО, р-н Лефортово, ш. Энтузиастов, 3к1',queries=[];let serverCalls=0;
  const browser=mapData.createAddressVariantGeocoder(async query=>{
    queries.push(query);
    return query==='Москва, ш. Энтузиастов, 3 корпус 1'?{latitude:55.84,longitude:37.36,resolvedAddress:query}:null;
  },{successDiagnostic:'yandex_maps_fallback',noResultsDiagnostic:'map_geocoder_no_results',failureDiagnostic:'map_geocoder_failed',coordinateSource:'geocode_browser'});
  const geocode=mapData.createFallbackGeocoder(async()=>{serverCalls++;return{status:'failed',attempts:1,diagnostic:'http_502'};},browser);
  const items=[listing(77,{address})];
  await mapData.geocodeMissingListings(items,{clusterService,geocode});
  assert.equal(serverCalls,1);assert.equal(queries[0],address);assert.equal(queries.at(-1),'Москва, ш. Энтузиастов, 3 корпус 1');
  assert.deepEqual({latitude:items[0].latitude,longitude:items[0].longitude,clusterId:items[0].clusterId,status:items[0].clusterStatus,source:items[0].clusterResolutionSource},{latitude:55.84,longitude:37.36,clusterId:'Митино',status:'inside',source:'automatic'});
  assert.equal(items[0].coordinateSource,'geocode_browser');
  assert.equal(items[0].geocodeAttempts,5);assert.match(items[0].geocodeDiagnostic,/fallback:http_502 -> yandex_maps_fallback_variant_4/);
});

test('a saved project without geo preserves geocoded parsed-listing coordinates and exact cluster',()=>{
  const parsed=listing(7,{latitude:55.84,longitude:37.36,coordinateSource:'geocode_server',geocodeStatus:'geocoded'});
  const project={id:'project-7',address:parsed.address,geo:null,phase0:{source:'cian',externalId:'7'}};
  const merged=mapData.mergeProjectListingGeo(project,parsed,clusterService);
  assert.deepEqual({latitude:merged.latitude,longitude:merged.longitude,clusterId:merged.clusterId,clusterStatus:merged.clusterStatus,source:merged.clusterResolutionSource},{latitude:55.84,longitude:37.36,clusterId:'Митино',clusterStatus:'inside',source:'automatic'});
  assert.equal(merged.coordinateSource,'geocode_server');assert.equal(merged.geocodeStatus,'geocoded');
});

test('an orphan saved CIAN project joins the grouped geocoding pass and receives an exact cluster marker at runtime',async()=>{
  const runtime=mapData.createProjectGeocodeRuntime(),project=savedCianProject(700,{address:'Москва, общий адрес, 7'}),live=listing(701,{address:'москва, общий адрес, 7'});
  const targets=mapData.collectProjectGeocodeTargets([live],[project],{findProject:()=>null,runtime,clusterService});let calls=0;
  await mapData.geocodeMissingListings(targets,{clusterService,geocode:async()=>{calls++;return{status:'geocoded',attempts:1,latitude:55.84,longitude:37.36,coordinateSource:'geocode_browser'};}});
  const orphan=runtime.get(project),merged=mapData.mergeProjectListingGeo(project,orphan,clusterService),state=mapData.projection(targets);
  assert.equal(calls,1,'the live listing and orphan project share one address lookup but remain separate objects');
  assert.equal(targets.length,2);assert.equal(state.markerCount,2);assert.equal(orphan._runtimeProjectId,project.id);
  assert.deepEqual({latitude:merged.latitude,longitude:merged.longitude,clusterId:merged.clusterId,status:merged.clusterStatus,source:merged.clusterResolutionSource},{latitude:55.84,longitude:37.36,clusterId:'Митино',status:'inside',source:'automatic'});
  assert.equal(project.geo,null,'read-time geocoding must not persist into the saved workspace project');
});

test('orphan runtime geocoding exposes failures, invalidates on address edits and leaves normal feed matching unchanged',async()=>{
  const runtime=mapData.createProjectGeocodeRuntime(),orphan=savedCianProject(710,{address:'Москва, ошибочный адрес, 10'}),matched=savedCianProject(711),manual={id:'manual-1',address:'Москва, вручную',geo:null,phase0:{source:'manual'}};
  const current=listing(711),targets=mapData.collectProjectGeocodeTargets([current],[orphan,matched,manual],{findProject:item=>item.externalId==='711'?matched:null,runtime,clusterService});
  assert.deepEqual(targets.map(item=>item.externalId),['711','710'],'matched live and manual projects must not create extra runtime targets');
  await mapData.geocodeMissingListings(targets,{clusterService,geocode:async()=>({status:'timeout',attempts:3,diagnostic:'timeout'})});
  assert.equal(runtime.get(orphan).geocodeStatus,'timeout');assert.equal(runtime.get(orphan).geocodeDiagnostic,'timeout');assert.equal(mapData.projection(targets).geocodeFailedCount,2);
  orphan.address='Москва, новый адрес, 11';assert.equal(runtime.get(orphan),null,'a result from the old address must be discarded immediately');
  const refreshed=mapData.collectProjectGeocodeTargets([current],[orphan,matched,manual],{findProject:item=>item.externalId==='711'?matched:null,runtime,clusterService});
  assert.equal(refreshed.at(-1).address,'Москва, новый адрес, 11');assert.equal(refreshed.at(-1).geocodeStatus,'not_computed');
});

test('project runtime rejects ineligible state and reconciles matched, persisted and deleted projects',()=>{
  const runtime=mapData.createProjectGeocodeRuntime(),changed=savedCianProject(730),matched=savedCianProject(731),persisted=savedCianProject(732),deleted=savedCianProject(733);
  [changed,matched,persisted,deleted].forEach(project=>runtime.target(project));assert.equal(runtime.size(),4);
  changed.phase0.source='manual';assert.equal(runtime.get(changed),null,'a project that stops being parsed CIAN cannot reuse runtime geo');
  persisted.geo={lat:55.84,lng:37.36};
  const live=listing(731),targets=mapData.collectProjectGeocodeTargets([live],[changed,matched,persisted],{findProject:()=>matched,runtime,clusterService});
  assert.deepEqual(targets,[live]);assert.equal(runtime.get(matched),null,'a newly matched live listing owns its own geo state');assert.equal(runtime.get(persisted),null,'persisted project geo supersedes runtime state');
  assert.equal(runtime.size(),0,'reconcile prunes projects missing from the current repository snapshot');
});

test('a reloaded orphan project reuses the v5 address cache without a second lookup',async()=>{
  const storage=memoryStorage(),cache=mapData.createAddressCache(storage),project=savedCianProject(720,{address:'Москва, кэшируемый адрес, 20'});let calls=0;
  const firstRuntime=mapData.createProjectGeocodeRuntime(),first=mapData.collectProjectGeocodeTargets([], [project],{findProject:()=>null,runtime:firstRuntime,clusterService});
  await mapData.geocodeMissingListings(first,{clusterService,cache,geocode:async()=>{calls++;return{status:'geocoded',attempts:1,latitude:55.84,longitude:37.36,coordinateSource:'geocode_browser'};}});
  const reloadedProject=JSON.parse(JSON.stringify(project)),secondRuntime=mapData.createProjectGeocodeRuntime(),second=mapData.collectProjectGeocodeTargets([], [reloadedProject],{findProject:()=>null,runtime:secondRuntime,clusterService});
  await mapData.geocodeMissingListings(second,{clusterService,cache:mapData.createAddressCache(storage),geocode:async()=>{calls++;return{status:'failed'};}});
  assert.equal(calls,1);assert.equal(secondRuntime.get(reloadedProject).coordinateSource,'geocode_cache_browser');assert.equal(secondRuntime.get(reloadedProject).clusterId,'Митино');
});

test('reload reuses the address cache and does not call the geocoder again',async()=>{
  const storage=memoryStorage(),first=[listing(1)];let calls=0;
  await mapData.geocodeMissingListings(first,{clusterService,cache:mapData.createAddressCache(storage),geocode:async()=>{calls++;return{status:'geocoded',attempts:1,latitude:55.84,longitude:37.36,coordinateSource:'geocode_browser'};}});
  const reloaded=[listing(1)];
  await mapData.geocodeMissingListings(reloaded,{clusterService,cache:mapData.createAddressCache(storage),geocode:async()=>{calls++;return{status:'failed'};}});
  assert.equal(calls,1);assert.equal(reloaded[0].coordinateSource,'geocode_cache_browser');assert.equal(reloaded[0].clusterId,'Митино');
});

test('v5 cache ignores old v3 failures so the new address fallback can run immediately after deployment',async()=>{
  const storage=memoryStorage(),oldKey='slogi_cian_geocode_cache_v3',normalized=mapData.normalizeAddress('Москва, Тверская, 1');
  storage.setItem(oldKey,JSON.stringify({[normalized]:{status:'failed',attempts:3,diagnostic:'legacy_failure',expiresAt:Date.now()+86400000}}));
  let calls=0;const item=listing(91,{address:'Москва, Тверская, 1'});
  await mapData.geocodeMissingListings([item],{clusterService,cache:mapData.createAddressCache(storage),geocode:async()=>{calls++;return{status:'geocoded',attempts:1,latitude:55.84,longitude:37.36,coordinateSource:'geocode_server'};}});
  assert.equal(calls,1);assert.equal(item.coordinateSource,'geocode_server');assert.equal(item.clusterId,'Митино');
  assert.ok(storage.getItem('slogi_cian_geocode_cache_v5'));
});

test('v5 cache migrates only unexpired v4 successes and immediately retries v4 failures',async()=>{
  const storage=memoryStorage(),now=Date.now(),successAddress='Москва, успешный адрес, 1',failedAddress='Москва, прежняя ошибка, 2';
  storage.setItem('slogi_cian_geocode_cache_v4',JSON.stringify({
    [mapData.normalizeAddress(successAddress)]:{status:'geocoded',attempts:1,latitude:55.84,longitude:37.36,coordinateSource:'geocode_server',savedAt:now-1000,expiresAt:now+86400000},
    [mapData.normalizeAddress(failedAddress)]:{status:'failed',attempts:3,diagnostic:'http_502',savedAt:now-1000,expiresAt:now+86400000}
  }));
  const items=[listing(201,{address:successAddress}),listing(202,{address:failedAddress})];let calls=0;
  await mapData.geocodeMissingListings(items,{clusterService,cache:mapData.createAddressCache(storage,{now:()=>now}),geocode:async address=>{calls++;assert.equal(address,failedAddress);return{status:'geocoded',attempts:1,latitude:55.84,longitude:37.36,coordinateSource:'geocode_server'};}});
  assert.equal(calls,1);assert.equal(items[0].coordinateSource,'geocode_cache_server');assert.equal(items[1].coordinateSource,'geocode_server');
  const migrated=JSON.parse(storage.getItem('slogi_cian_geocode_cache_v5'));assert.ok(migrated[mapData.normalizeAddress(successAddress)]);assert.ok(migrated[mapData.normalizeAddress(failedAddress)]);
});

test('only complete successful automatic project geocodes become persistence updates',async()=>{
  const project=savedCianProject(810,{address:'Москва, проектный адрес, 10',phase0:{source:'cian',externalId:'810',revision:7}}),listingItem=listing(810,{address:' москва,  проектный адрес, 10 '});
  const runtime=mapData.createProjectGeocodeRuntime(),targets=mapData.collectProjectGeocodeTargets([listingItem],[project],{findProject:()=>project,runtime,clusterService});
  await mapData.geocodeMissingListings(targets,{clusterService,geocode:async()=>({status:'geocoded',attempts:1,latitude:55.84,longitude:37.36,coordinateSource:'geocode_server'})});
  assert.deepEqual(mapData.projectGeocodeUpdates(targets),[{projectId:project.id,expectedRevision:7,addressKey:mapData.normalizeAddress(project.address),latitude:55.84,longitude:37.36,clusterId:'Митино',clusterName:'Митино',clusterStatus:'inside',clusterBoundary:false,clusterResolutionSource:'automatic'}]);
  listingItem.geocodeStatus='failed';assert.deepEqual(mapData.projectGeocodeUpdates(targets),[],'failed results must never be written');
  listingItem.geocodeStatus='geocoded';listingItem.clusterStatus='not_computed';assert.deepEqual(mapData.projectGeocodeUpdates(targets),[],'unclassified results must never be written');
});

test('geocoder HTTP failure and timeout are explicit and never invent coordinates',async()=>{
  const failed=mapData.createServerGeocoder({endpoint:GEOCODE_ENDPOINT,projectUrl:PROJECT_URL,maxAttempts:1,fetchImpl:async()=>response(502,{error:'upstream'})});
  const failure=await failed('Москва, Тверская, 1');assert.equal(failure.status,'failed');assert.equal(mapData.coordinates(failure),null);
  const timeout=mapData.createServerGeocoder({endpoint:GEOCODE_ENDPOINT,projectUrl:PROJECT_URL,timeoutMs:100,maxAttempts:1,fetchImpl:(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{const error=new Error('timeout');error.name='AbortError';reject(error);},{once:true}))});
  const timedOut=await timeout('Москва, Тверская, 2');assert.equal(timedOut.status,'timeout');assert.equal(mapData.coordinates(timedOut),null);
});

test('bearer is sent only to the configured same-project Edge endpoint',async()=>{
  let calls=0,authorization='';
  assert.throws(()=>mapData.createServerGeocoder({endpoint:'https://attacker.example/geocode',projectUrl:PROJECT_URL,token:'fixture-bearer',fetchImpl:async()=>{calls++;return response(200,{results:[]});}}),/geocoder_endpoint_untrusted/);
  assert.equal(calls,0);
  const trusted=mapData.createServerGeocoder({endpoint:GEOCODE_ENDPOINT,projectUrl:PROJECT_URL,token:'fixture-bearer',maxAttempts:1,fetchImpl:async(url,options)=>{calls++;assert.equal(url,GEOCODE_ENDPOINT);authorization=options.headers.Authorization;return response(200,{results:[]});}});
  await trusted('Москва, Тверская, 3');assert.equal(calls,1);assert.equal(authorization,'Bearer fixture-bearer');
});

test('marker and missing-coordinate counts equal the filtered canonical listing set',async()=>{
  const items=[listing(1,{latitude:55.84,longitude:37.36}),listing(2,{address:'Москва, второй адрес, 2'}),listing(3,{address:'Москва, ошибка, 3'}),listing(4,{address:''})];
  let calls=0;await mapData.geocodeMissingListings(items,{clusterService,geocode:async address=>{calls++;return address.includes('второй')?{status:'geocoded',attempts:1,latitude:56,longitude:38}:{status:'timeout',attempts:3,diagnostic:'timeout'};}});
  const filtered=feed.filterAndSort(items,{days:30},NOW),state=mapData.projection(filtered);
  assert.equal(calls,2);assert.equal(state.listings.length,4);assert.equal(state.markerCount,2);assert.equal(state.withoutCoordinatesCount,2);assert.equal(state.geocodeFailedCount,1);assert.equal(state.missingAddressCount,1);assert.equal(state.markerCount,filtered.filter(item=>mapData.coordinates(item)).length);
  assert.equal(items[1].clusterStatus,'outside');assert.equal(items[2].clusterStatus,'not_computed');
});

test('marker count is the coordinate-capable canonical set across both identity keys',()=>{
  const base=[listing(1,{latitude:55.84,longitude:37.36}),listing(2,{latitude:55.85,longitude:37.37}),listing(3,{latitude:null,longitude:null})];
  const duplicates=[listing(1,{listingUrl:'https://www.cian.ru/rent/commercial/999999999',latitude:56,longitude:38}),listing(4,{listingUrl:'https://www.cian.ru/rent/commercial/2?tracking=duplicate',latitude:56,longitude:38})];
  const state=mapData.projection([...base,...duplicates]);assert.equal(state.listings.length,3);assert.equal(state.markerCount,2);assert.deepEqual(state.markers.map(item=>item.externalId),['1','2']);
});

test('cluster filter drives list and map from one filtered collection',()=>{
  const items=[listing(1,{latitude:55.84,longitude:37.36}),listing(2,{latitude:56,longitude:38}),listing(3,{address:''})];items.forEach(item=>mapData.classify(item,clusterService));
  const inside=feed.filterAndSort(items,{cluster:'Митино',days:30},NOW),outside=feed.filterAndSort(items,{cluster:'__outside',days:30},NOW),unresolved=feed.filterAndSort(items,{cluster:'__unresolved',days:30},NOW);
  assert.deepEqual(inside.map(mapData.listingId),mapData.projection(inside).markers.map(mapData.listingId));
  assert.deepEqual(inside.map(item=>item.externalId),['1']);assert.deepEqual(outside.map(item=>item.externalId),['2']);assert.deepEqual(unresolved.map(item=>item.externalId),['3']);
});

test('UI binds marker-card selection and unified project removal without filter DOM dependencies',()=>{
  const source=fs.readFileSync(path.join(ROOT,'cian-workspace.js'),'utf8');
  const render=source.slice(source.indexOf('function render()'),source.indexOf('function existingProject'));
  const bind=source.slice(source.indexOf('function bind()'),source.indexOf('function init()'));
  assert.equal(/addEventListener/.test(render),false);
  assert.match(bind,/nodes\.list\.addEventListener\('click'/);assert.match(bind,/selectListing\(button\.dataset\.listingId\)/);
  assert.match(source,/marker\.events\.add\('click',[\s\S]*selectListing/);assert.match(bind,/data-remove-space/);
  assert.match(source,/HIDDEN_LISTINGS_KEY='slogi_cian_hidden_listing_ids_v1'/);assert.match(source,/projectRepository\(\)\.softDelete/);assert.match(source,/data-take-space/);
  assert.doesNotMatch(source,/\bfields\b|applyFilters|populateClusters|available-reset|available-cluster/);
  assert.match(source,/marker\.events\.removeAll/);
  assert.match(source,/createFallbackGeocoder\(serverGeocode,browserGeocode\)/);
  assert.match(source,/window\.ymaps\.geocode/);
});

test('server geocoder marks successful coordinates with their real provider',async()=>{
  const server=mapData.createServerGeocoder({endpoint:GEOCODE_ENDPOINT,projectUrl:PROJECT_URL,maxAttempts:1,fetchImpl:async()=>response(200,{results:[{lat:55.84,lng:37.36,address:'Москва, Тверская, 1',precision:'exact'}],diagnostic:{status:'ok',attempts:1}})});
  const result=await server('Москва, Тверская, 1');assert.equal(result.status,'geocoded');assert.equal(result.coordinateSource,'geocode_server');
});

test('server geocoder forwards configured bounds and selects by precision then provider order, never polygon membership',async()=>{
  let body=null;
  const server=mapData.createServerGeocoder({endpoint:GEOCODE_ENDPOINT,projectUrl:PROJECT_URL,searchCenter:'37.6176,55.7558',searchSpan:'4.2,3.0',maxAttempts:1,fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return response(200,{results:[{lat:55.84,lng:37.36,address:'Неточный результат внутри зоны',precision:'street'},{lat:56,lng:38,address:'Точный результат вне зоны',precision:'exact'},{lat:55.85,lng:37.37,address:'Второй точный результат',precision:'exact'}],diagnostic:{status:'ok',attempts:1}});}});
  const result=await server('Москва, Тверская, 1');assert.deepEqual(body,{address:'Москва, Тверская, 1',ll:'37.6176,55.7558',spn:'4.2,3.0'});assert.deepEqual({lat:result.latitude,lng:result.longitude},{lat:56,lng:38});assert.equal(mapData.clusterState(result,clusterService).clusterStatus,'outside');
});

test('UI exposes separate missing-address, missing-coordinate, failed and pending DOM counters',()=>{
  const html=fs.readFileSync(path.join(ROOT,'available-spaces.html'),'utf8'),source=fs.readFileSync(path.join(ROOT,'cian-workspace.js'),'utf8');
  for(const id of ['cian-map-missing','cian-map-no-address','cian-map-failed','cian-map-pending'])assert.match(html,new RegExp(`id=["']${id}["']`));
  assert.match(source,/mapNoAddress\.textContent=`Без адреса: \$\{state\.missingAddressCount\}`/);
});

test('search layout keeps compact hero, map controls in heading and card actions vertical',()=>{
  const html=fs.readFileSync(path.join(ROOT,'available-spaces.html'),'utf8'),source=fs.readFileSync(path.join(ROOT,'cian-workspace.js'),'utf8'),css=fs.readFileSync(path.join(ROOT,'cian-workspace.css'),'utf8');
  assert.match(html,/class="cian-hero-content"[^>]*><h1 id="available-title">Поиск помещений<\/h1><div class="cian-hero-details">/);
  assert.match(html,/class="cian-map-heading-actions">[\s\S]*id="cian-map-count"[\s\S]*id="cian-clusters-toggle"/);
  assert.doesNotMatch(html,/class="cian-map-toolbar"/);
  assert.doesNotMatch(source,/>Карточка помещения<\/button>/);
  assert.match(source,/<button class="cian-card-open"[^>]*data-listing-id=/);
  assert.match(css,/\.cian-card-actions\{display:grid!important;grid-template-columns:minmax\(0,1fr\)!important/);
});

test('search page has no user filters, sends the fixed gate and removes saved-base wording',()=>{
  const html=fs.readFileSync(path.join(ROOT,'available-spaces.html'),'utf8'),source=fs.readFileSync(path.join(ROOT,'cian-workspace.js'),'utf8');
  assert.doesNotMatch(html,/cian-filter-card|available-(?:cluster|area|min|max|rent|sqm|date|sort|reset)/);
  assert.doesNotMatch(html+source,/сохран[её]нн/i);
  assert.match(source,/areaMin:FIXED_CRITERIA\.areaMin,areaMax:FIXED_CRITERIA\.areaMax,floor:FIXED_CRITERIA\.floor,premiseTypes:\[\.\.\.FIXED_CRITERIA\.premiseTypes\]/);
  assert.match(source,/applyFixedGate\(loaded\.items\)/);assert.match(source,/collectProjectGeocodeTargets\(all,storedProjects\(\)/);assert.match(source,/geocodeMissingListings\(geocodeTargets,/);
  assert.match(source,/data-remove-space/);assert.match(source,/SlogiSearchSpaceCardModal/);
});

test('legacy phase0 geocoding has no browser-to-Yandex direct fallback or client API key payload',()=>{
  const config=fs.readFileSync(path.join(ROOT,'phase0-config.js'),'utf8'),services=fs.readFileSync(path.join(ROOT,'phase0-services.js'),'utf8');
  assert.doesNotMatch(config,/directBaseUrl|useServerFallback|geocode-maps\.yandex\.ru\/v1/);assert.doesNotMatch(services,/buildDirectUrl|async direct\(|apikey:this\.apiKey|yandexGeocoderApiKey/);assert.match(services,/edgeEndpoint\(\)/);assert.match(services,/endpoint\.origin!==project\.origin/);
});
