(function(){
  'use strict';
  const snapshot=new Date().toISOString(),freshness=new Date(Date.now()-24*60*60*1000).toISOString();
  const listing=(id,address,latitude,longitude,clusterName='')=>({source:'cian',externalId:String(id),listingUrl:`https://www.cian.ru/rent/commercial/${id}`,title:`Помещение ${id}`,address,latitude,longitude,area:100+Number(id),rentMonthly:300000+Number(id)*1000,floor:1,totalFloors:5,ceilingHeight:3.2,freshnessAt:freshness,freshnessKind:'published',publishedAt:freshness,marketStatus:'active',clusterName,parseCompleteness:1,parseWarnings:[]});
  const firstPage=[listing(1,'Москва, Митино, тестовый адрес, 1',55.84,37.36,'Митино'),listing(2,'Москва, общий тестовый адрес, 2',null,null),listing(3,'Москва, общий тестовый адрес, 2',null,null)];
  for(let id=7;id<=53;id++)firstPage.push(listing(id,`Москва, Митино, тестовый адрес, ${id}`,55.84+(id%5)*0.0001,37.36+(id%7)*0.0001,'Митино'));
  const pages={1:firstPage,2:[listing(4,'Москва, адрес с ошибкой геокодера, 4',null,null),listing(5,'',null,null),listing(6,'Московская область, внешний адрес, 6',56,38)]};
  const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
  window.fetch=async function(url,options={}){
    const target=String(url||''),body=(()=>{try{return JSON.parse(options.body||'{}');}catch(_error){return{};}})();
    if(target.includes('/search-listings')){const page=Number(body.page)||1,items=pages[page]||[];return json({items,meta:{sources:{cian:{status:'ok',lastSucceededAt:snapshot}},page,limit:Number(body.limit)||50,total:53,returned:items.length,hasMore:page===1,nextPage:page===1?2:null,snapshotAt:snapshot}});}
    if(target.includes('/geocode-address')){
      const address=String(body.address||'');
      if(address.includes('ошибкой'))return json({error:'geocoder_provider_timeout',diagnostic:{status:'geocoder_provider_timeout'}},504);
      if(address.includes('общий'))return json({results:[{address,lat:55.84,lng:37.36,precision:'exact'}],diagnostic:{status:'ok',cacheHit:false,attempts:1}});
      return json({results:[],diagnostic:{status:'not_found',cacheHit:false,attempts:1}});
    }
    return json({});
  };
  window.SlogiCloud={ready:Promise.resolve(),getAccessToken:async()=> 'browser-fixture-token',sync:async()=>({})};
  const closeFixtureDialog=()=>{const dialog=document.getElementById('slogi-workspace-dialog');if(dialog&&dialog.open)dialog.close();};closeFixtureDialog();setTimeout(closeFixtureDialog,0);document.addEventListener('DOMContentLoaded',()=>setTimeout(closeFixtureDialog,0),{once:true});

  class Events{constructor(){this.handlers=new Map();}add(name,handler){if(!this.handlers.has(name))this.handlers.set(name,[]);this.handlers.get(name).push(handler);}emit(name){(this.handlers.get(name)||[]).forEach(handler=>handler());}removeAll(){this.handlers.clear();}}
  class Options{constructor(initial={}){this.value={...initial};}set(name,value){if(name&&typeof name==='object')Object.assign(this.value,name);else this.value[name]=value;}}
  class Properties{constructor(initial={}){this.value={...initial};}set(name,value){this.value[name]=value;}}
  class GeoObjects{constructor(){this.items=[];}add(item){this.items.push(item);return this;}remove(item){this.items=this.items.filter(value=>value!==item);return this;}}
  class FakeMap{constructor(container){this.container={fitToViewport(){}};this.geoObjects=new GeoObjects();this.behaviors={disable(){}};this.node=typeof container==='string'?document.getElementById(container):container;if(this.node){this.node.dataset.fixtureMap='ready';window.__slogiFixtureMapNode=this.node;}}setBounds(){return Promise.resolve();}panTo(coords){if(this.node)this.node.dataset.lastPan=coords.join(',');return Promise.resolve();}}
  class Placemark{constructor(coords,properties={},options={}){this.geometry={getCoordinates:()=>coords};this.properties=new Properties(properties);this.options=new Options(options);this.events=new Events();this.balloon={open(){}};}}
  class Polygon{constructor(coords,properties={},options={}){this.coords=coords;this.properties=new Properties(properties);this.options=new Options(options);this.events=new Events();}}
  class Clusterer{constructor(){this.items=[];}add(items){this.items.push(...items);const node=window.__slogiFixtureMapNode;if(node)items.slice(0,3).forEach((item,index)=>{const button=document.createElement('button');button.type='button';button.className='fixture-map-marker';button.setAttribute('aria-label',`Тестовый маркер ${index+1}`);button.textContent=`● ${index+1}`;button.addEventListener('click',()=>item.events.emit('click'));node.appendChild(button);});}removeAll(){this.items=[];window.__slogiFixtureMapNode?.querySelectorAll('.fixture-map-marker').forEach(node=>node.remove());}getBounds(){if(!this.items.length)return null;const coords=this.items.map(item=>item.geometry.getCoordinates());return[[Math.min(...coords.map(point=>point[0])),Math.min(...coords.map(point=>point[1]))],[Math.max(...coords.map(point=>point[0])),Math.max(...coords.map(point=>point[1]))]];}}
  window.ymaps={ready:callback=>callback(),Map:FakeMap,Placemark,Polygon,Clusterer,templateLayoutFactory:{createClass:()=>function(){}}};
})();
