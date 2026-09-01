'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const model=require('../search-space-card.js');

function ready(overrides={}){
  return{
    id:'space-1',source:'manual',address:'Москва, Тверская улица, 1',
    cluster:{id:'tverskoy',name:'Тверской',status:'inside',hasSlogiCenter:false},
    competitive:{rating:92,rank:12,averageRentPerSqm:3000},
    rentMonthly:360000,area:120,areaConfirmed:'yes',separateEntrance:'yes',
    hasWindows:'yes',windowsOpen:'yes',ceilingHeight:3.4,ceilingHeightConfirmed:'yes',repair:'finished',
    ...overrides,
  };
}

test('browser and CommonJS API expose the agreed normalize/evaluate contract',()=>{
  assert.equal(globalThis.SlogiSearchSpaceCard,model);
  assert.equal(typeof model.normalize,'function');
  assert.equal(typeof model.evaluate,'function');
});

test('manual and parsed payloads use one canonical field and derived-value model',()=>{
  const manual=model.normalize(ready());
  const parsed=model.normalize({
    id:'space-1',source:'cian',address:'  Москва,   Тверская улица, 1  ',
    cluster_id:'tverskoy',cluster_name:'Тверской',cluster_status:'inside',has_slogi_center:false,
    competitive_rating:'92',cluster_rank:'12',average_rent_per_sqm:'3000',
    rent_monthly:'360000',area_sqm:'120',area_confirmed:true,separate_entrance:true,
    has_windows:true,windows_open:true,ceiling_height:'3,4',ceiling_height_confirmed:'да',repair_type:'чистовая',
  });
  assert.equal(manual.source,'manual');assert.equal(parsed.source,'parsed');assert.equal(parsed.sourceProvider,'cian');
  const withoutOrigin=value=>{const copy=structuredClone(value);delete copy.source;delete copy.sourceProvider;return copy;};
  assert.deepEqual(withoutOrigin(parsed),withoutOrigin(manual));
});

test('rent per square metre and competitive delta are always calculated, never trusted from input',()=>{
  const card=model.normalize(ready({pricePerSqm:999999,competitive:{rating:92,rank:12,averageRentPerSqm:3200}}));
  assert.equal(card.pricePerSqm,3000);
  assert.deepEqual(card.competitive,{rating:92,rank:12,isTop30:true,averageRentPerSqm:3200,deltaRentPerSqm:-200,deltaPercent:-6.25,priceDirection:'lower'});
  const higher=model.normalize(ready({rentMonthly:420000,competitive:{rank:30,averageRentPerSqm:3000}}));
  assert.equal(higher.pricePerSqm,3500);assert.equal(higher.competitive.priceDirection,'higher');assert.equal(higher.competitive.deltaPercent,16.67);
});

test('an address outside all clusters is explicit and can never be taken to work',()=>{
  const card=model.normalize(ready({cluster:{status:'outside',hasSlogiCenter:false}}));
  assert.equal(card.cluster.status,'outside');assert.equal(card.cluster.matched,false);
  assert.equal(card.canTakeToWork,false);assert.deepEqual(card.eligibility.reasons,['cluster_outside']);
});

test('take-to-work is allowed only for an inside, free, top-30 and exactly completed card',()=>{
  const card=model.normalize(ready());
  assert.equal(card.cluster.hasSlogiCenter,false);assert.equal(card.competitive.isTop30,true);
  assert.deepEqual(card.eligibility.checks,{clusterInside:true,clusterFree:true,clusterTop30:true,requiredComplete:true});
  assert.equal(card.canTakeToWork,true);assert.deepEqual(card.eligibility.reasons,[]);
});

test('an existing SLOGI center and unknown occupancy both block take-to-work',()=>{
  const occupied=model.evaluate(ready({cluster:{id:'tverskoy',name:'Тверской',status:'inside',hasSlogiCenter:true,centerDetails:'Центр на Тверской'}}));
  assert.equal(occupied.eligible,false);assert.ok(occupied.reasons.includes('cluster_occupied'));
  const unknown=model.evaluate(ready({cluster:{id:'tverskoy',name:'Тверской',status:'inside'}}));
  assert.equal(unknown.eligible,false);assert.ok(unknown.reasons.includes('cluster_occupancy_unknown'));
});

test('rank 30 is admitted while rank 31 and a missing rank are blocked',()=>{
  assert.equal(model.normalize(ready({competitive:{rank:30,averageRentPerSqm:3000}})).canTakeToWork,true);
  const rank31=model.normalize(ready({competitive:{rank:31,averageRentPerSqm:3000}}));
  assert.equal(rank31.top30,false);assert.ok(rank31.eligibility.reasons.includes('cluster_not_top30'));
  assert.ok(model.evaluate(ready({competitive:{averageRentPerSqm:3000}})).reasons.includes('cluster_rank_unknown'));
});

test('every required technical value is validated and windows-open is conditional',()=>{
  const incomplete=model.normalize(ready({address:'',rentMonthly:null,area:null,areaConfirmed:'no',separateEntrance:'unknown',hasWindows:'yes',windowsOpen:'unknown',ceilingHeight:null,ceilingHeightConfirmed:'no',repair:'unknown',competitive:{rank:12}}));
  assert.equal(incomplete.canTakeToWork,false);
  assert.deepEqual(incomplete.eligibility.missingFields,['address','rentMonthly','area','areaConfirmed','pricePerSqm','separateEntrance','windowsOpen','ceilingHeight','ceilingHeightConfirmed','repair','competitiveAverage']);
  const noWindows=model.normalize(ready({hasWindows:'no',windowsOpen:'yes'}));
  assert.equal(noWindows.windowsOpen,'unknown');assert.equal(noWindows.eligibility.required.windowsOpen,true);assert.equal(noWindows.canTakeToWork,true);
});

test('nested technical input and Russian option labels normalize deterministically',()=>{
  const card=model.normalize({
    ...ready(),
    areaConfirmed:undefined,separateEntrance:undefined,hasWindows:undefined,windowsOpen:undefined,
    ceilingHeight:undefined,ceilingHeightConfirmed:undefined,repair:undefined,
    technical:{areaConfirmed:'да',separateEntrance:'нет',windows:'да',windowsOpen:'нет',ceilingHeight:'4,25',ceilingHeightConfirmed:'да',repair:'черновой'},
  });
  assert.equal(card.areaConfirmed,'yes');assert.equal(card.separateEntrance,'no');assert.equal(card.hasWindows,'yes');assert.equal(card.windowsOpen,'no');
  assert.equal(card.ceilingHeight,4.25);assert.equal(card.ceilingHeightConfirmed,'yes');assert.equal(card.repair,'rough');assert.equal(card.canTakeToWork,true);
});
