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

test('administrative cluster is inferred from the address when a point is outside SLOGI polygons',()=>{
  const item=listing(10,{address:'Москва, ЮВАО, р-н Лефортово, ш. Энтузиастов, 3к1',latitude:55.7480696,longitude:37.6904566});
  assert.equal(mapData.inferAddressCluster(item.address),'Лефортово');
  mapData.classify(item,clusterService);
  assert.deepEqual({name:item.clusterName,status:item.clusterStatus,boundary:item.clusterBoundary},{name:'Лефортово',status:'address',boundary:false});
});

test('same address is geocoded once while distinct canonical listings keep distinct markers',async()=>{
  const items=[listing(1),listing(2)];let calls=0;
  await mapData.geocodeMissingListings(items,{clusterService,geocode:async()=>{calls++;return{status:'geocoded',attempts:1,latitude:55.84,longitude:37.36};}});
  const state=mapData.projection(items);
  assert.equal(calls,1);assert.equal(state.markerCount,2);assert.equal(new Set(state.markers.map(mapData.listingId)).size,2);
  assert.ok(items.every(item=>item.clusterId==='Митино'&&item.clusterName==='Митино'&&item.clusterStatus==='inside'));
});

test('reload reuses the address cache and does not call the geocoder again',async()=>{
  const storage=memoryStorage(),first=[listing(1)];let calls=0;
  await mapData.geocodeMissingListings(first,{clusterService,cache:mapData.createAddressCache(storage),geocode:async()=>{calls++;return{status:'geocoded',attempts:1,latitude:55.84,longitude:37.36};}});
  const reloaded=[listing(1)];
  await mapData.geocodeMissingListings(reloaded,{clusterService,cache:mapData.createAddressCache(storage),geocode:async()=>{calls++;return{status:'failed'};}});
  assert.equal(calls,1);assert.equal(reloaded[0].coordinateSource,'geocode_cache');assert.equal(reloaded[0].clusterId,'Митино');
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
  assert.match(source,/applyFixedGate\(loaded\.items\)/);assert.match(source,/geocodeMissingListings\(all,/);
  assert.match(source,/data-remove-space/);assert.match(source,/SlogiSearchSpaceCardModal/);
});

test('legacy phase0 geocoding has no browser-to-Yandex direct fallback or client API key payload',()=>{
  const config=fs.readFileSync(path.join(ROOT,'phase0-config.js'),'utf8'),services=fs.readFileSync(path.join(ROOT,'phase0-services.js'),'utf8');
  assert.doesNotMatch(config,/directBaseUrl|useServerFallback|geocode-maps\.yandex\.ru\/v1/);assert.doesNotMatch(services,/buildDirectUrl|async direct\(|apikey:this\.apiKey|yandexGeocoderApiKey/);assert.match(services,/edgeEndpoint\(\)/);assert.match(services,/endpoint\.origin!==project\.origin/);
});
