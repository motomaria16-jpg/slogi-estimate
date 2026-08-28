(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SlogiCianMapData=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const SUCCESS_TTL_MS=30*24*60*60*1000;
  const FAILURE_TTL_MS=15*60*1000;
  const CACHE_LIMIT=500;

  const number=value=>{if(value==null||String(value).trim()==='')return null;const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;};

  function coordinates(value){
    const latitude=number(value&&value.latitude),longitude=number(value&&value.longitude);
    if(latitude==null||longitude==null||latitude< -90||latitude>90||longitude< -180||longitude>180)return null;
    return{latitude,longitude};
  }

  function normalizeAddress(value){return String(value||'').trim().toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ').replace(/\s*,\s*/g,', ');}

  function canonicalUrl(value){
    try{const url=new URL(String(value||''));url.hash='';url.search='';url.hostname=url.hostname.toLowerCase();url.pathname=url.pathname.replace(/\/+$/,'')||'/';return url.toString();}
    catch(_error){return String(value||'').trim();}
  }

  function listingId(item){
    const source=String(item&&item.source||''),externalId=String(item&&(item.externalId||item.external_id)||'').trim();
    return source+':'+(externalId||canonicalUrl(item&&(item.listingUrl||item.listing_url)));
  }

  function clusterState(value,clusterService){
    const geo=coordinates(value);
    if(!geo)return{clusterId:'',clusterName:'',clusterStatus:'not_computed',clusterBoundary:false};
    if(clusterService&&typeof clusterService.locate==='function'){
      const located=clusterService.locate(geo.latitude,geo.longitude);
      if(located&&located.status==='inside')return{clusterId:String(located.clusterId||located.id||''),clusterName:String(located.clusterName||located.name||''),clusterStatus:'inside',clusterBoundary:located.boundary===true};
      if(located&&located.status==='outside')return{clusterId:'',clusterName:'',clusterStatus:'outside',clusterBoundary:false};
    }
    if(clusterService&&typeof clusterService.findByCoordinates==='function'){
      const match=clusterService.findByCoordinates(geo.latitude,geo.longitude);
      if(match)return{clusterId:String(match.id||''),clusterName:String(match.name||''),clusterStatus:'inside',clusterBoundary:match.boundary===true};
      return{clusterId:'',clusterName:'',clusterStatus:'outside',clusterBoundary:false};
    }
    return{clusterId:'',clusterName:'',clusterStatus:'not_computed',clusterBoundary:false};
  }

  function classify(value,clusterService){return Object.assign(value,clusterState(value,clusterService));}

  function projection(items){
    const unique=new Map();
    (items||[]).forEach(item=>{const id=listingId(item);if(id!==':'&&!unique.has(id))unique.set(id,item);});
    const listings=[...unique.values()],markers=listings.filter(item=>coordinates(item));
    const failed=listings.filter(item=>['failed','timeout','rate_limited','not_found'].includes(item.geocodeStatus)).length;
    return{
      listings,markers,
      markerCount:markers.length,
      withoutCoordinatesCount:listings.length-markers.length,
      geocodeFailedCount:failed,
      geocodePendingCount:listings.filter(item=>item.geocodeStatus==='pending').length,
      missingAddressCount:listings.filter(item=>item.geocodeStatus==='missing_address').length,
      outsideClusterCount:listings.filter(item=>item.clusterStatus==='outside').length,
    };
  }

  function createAddressCache(storage,{key='slogi_cian_geocode_cache_v2',now=()=>Date.now(),limit=CACHE_LIMIT}={}){
    let entries={};
    try{const parsed=JSON.parse(storage&&storage.getItem(key)||'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))entries=parsed;}catch(_error){entries={};}
    const persist=()=>{if(!storage)return;try{const sorted=Object.entries(entries).sort((left,right)=>Number(left[1]&&left[1].savedAt||0)-Number(right[1]&&right[1].savedAt||0)).slice(-Math.max(1,Number(limit)||CACHE_LIMIT));entries=Object.fromEntries(sorted);storage.setItem(key,JSON.stringify(entries));}catch(_error){/* cache is best effort */}};
    return{
      get(address){const normalized=normalizeAddress(address),entry=entries[normalized];if(!entry)return null;if(Number(entry.expiresAt)<=now()){delete entries[normalized];persist();return null;}return Object.assign({},entry);},
      set(address,value,ttlMs){const normalized=normalizeAddress(address);if(!normalized)return;entries[normalized]=Object.assign({},value,{savedAt:now(),expiresAt:now()+Math.max(1000,Number(ttlMs)||FAILURE_TTL_MS)});persist();},
      size(){return Object.keys(entries).length;},
    };
  }

  function abortError(){const error=new Error('aborted');error.name='AbortError';return error;}

  function wait(milliseconds,signal,sleepImpl){
    if(signal&&signal.aborted)return Promise.reject(abortError());
    if(sleepImpl)return sleepImpl(milliseconds,signal);
    return new Promise((resolve,reject)=>{const timer=setTimeout(done,Math.max(0,milliseconds));function done(){cleanup();resolve();}function aborted(){clearTimeout(timer);cleanup();reject(abortError());}function cleanup(){signal&&signal.removeEventListener('abort',aborted);}signal&&signal.addEventListener('abort',aborted,{once:true});});
  }

  function retryAfter(response,attempt,baseDelayMs){
    const header=String(response&&response.headers&&response.headers.get&&response.headers.get('retry-after')||'').trim();
    const seconds=Number(header);if(header&&Number.isFinite(seconds)&&seconds>=0)return Math.min(10000,seconds*1000);
    const date=Date.parse(header);if(Number.isFinite(date))return Math.max(0,Math.min(10000,date-Date.now()));
    return Math.min(5000,Math.max(0,Number(baseDelayMs)||250)*Math.pow(2,attempt-1));
  }

  function createServerGeocoder({endpoint,token='',fetchImpl=globalThis.fetch,timeoutMs=12000,maxAttempts=3,baseDelayMs=250,sleepImpl}={}){
    const url=String(endpoint||'').trim(),attemptLimit=Math.max(1,Math.min(5,Math.trunc(Number(maxAttempts)||3)));
    if(!url||typeof fetchImpl!=='function')throw new Error('geocoder_unavailable');
    return async function geocode(address,{signal}={}){
      const normalized=String(address||'').trim();if(normalized.length<5)return{status:'not_found',attempts:0,diagnostic:'address_invalid'};
      let lastStatus='failed';
      for(let attempt=1;attempt<=attemptLimit;attempt++){
        if(signal&&signal.aborted)throw abortError();
        const controller=new AbortController();let timedOut=false;
        const timer=setTimeout(()=>{timedOut=true;controller.abort();},Math.max(100,Number(timeoutMs)||12000));
        const abort=()=>controller.abort();signal&&signal.addEventListener('abort',abort,{once:true});
        try{
          const headers={'Content-Type':'application/json','Accept':'application/json','X-Slogi-Client':'cian-map'};if(token)headers.Authorization='Bearer '+token;
          const response=await fetchImpl(url,{method:'POST',headers,body:JSON.stringify({address:normalized}),signal:controller.signal});
          const payload=await response.json().catch(()=>null);
          if(response.ok){
            const result=(Array.isArray(payload&&payload.results)?payload.results:[]).find(item=>coordinates({latitude:item&&item.lat,longitude:item&&item.lng}));
            if(!result)return{status:'not_found',attempts:attempt,diagnostic:String(payload&&payload.diagnostic&&payload.diagnostic.status||'no_results'),cacheHit:Boolean(payload&&payload.diagnostic&&payload.diagnostic.cacheHit)};
            return{status:'geocoded',attempts:attempt,latitude:Number(result.lat),longitude:Number(result.lng),precision:String(result.precision||''),resolvedAddress:String(result.address||normalized),cacheHit:Boolean(payload&&payload.diagnostic&&payload.diagnostic.cacheHit)};
          }
          lastStatus=response.status===429?'rate_limited':response.status===408||response.status===504?'timeout':'failed';
          if(attempt<attemptLimit&&(response.status===429||response.status===408||response.status>=500)){await wait(retryAfter(response,attempt,baseDelayMs),signal,sleepImpl);continue;}
          return{status:lastStatus,attempts:attempt,diagnostic:String(payload&&payload.error||`http_${response.status}`)};
        }catch(error){
          if(signal&&signal.aborted)throw abortError();
          lastStatus=timedOut||error&&error.name==='AbortError'?'timeout':'failed';
          if(attempt<attemptLimit){await wait(Math.min(5000,Math.max(0,Number(baseDelayMs)||250)*Math.pow(2,attempt-1)),signal,sleepImpl);continue;}
          return{status:lastStatus,attempts:attempt,diagnostic:lastStatus==='timeout'?'timeout':'network_error'};
        }finally{clearTimeout(timer);signal&&signal.removeEventListener('abort',abort);}
      }
      return{status:lastStatus,attempts:attemptLimit,diagnostic:'retry_exhausted'};
    };
  }

  function applyGeocodeResult(items,result,clusterService,source){
    items.forEach(item=>{
      item.geocodeStatus=String(result&&result.status||'failed');item.geocodeAttempts=Number(result&&result.attempts)||0;item.geocodeDiagnostic=String(result&&result.diagnostic||'');
      if(result&&result.status==='geocoded'&&coordinates(result)){
        item.latitude=Number(result.latitude);item.longitude=Number(result.longitude);item.coordinateSource=source;classify(item,clusterService);
      }else{item.coordinateSource='';Object.assign(item,clusterState(item,clusterService));}
    });
  }

  async function geocodeMissingListings(items,{geocode,clusterService,cache=null,signal,concurrency=2,onProgress}={}){
    const groups=new Map();let cached=0;
    (items||[]).forEach(item=>{
      if(coordinates(item)){item.coordinateSource=item.coordinateSource||'stored';item.geocodeStatus='stored';classify(item,clusterService);return;}
      const key=normalizeAddress(item.address);
      if(!key){item.geocodeStatus='missing_address';item.coordinateSource='';Object.assign(item,clusterState(item,clusterService));return;}
      if(!groups.has(key))groups.set(key,{address:String(item.address).trim(),items:[]});groups.get(key).items.push(item);
    });
    const tasks=[];
    groups.forEach(group=>{
      const hit=cache&&cache.get(group.address);
      if(hit){cached++;applyGeocodeResult(group.items,hit,clusterService,hit.status==='geocoded'?'geocode_cache':'');}
      else{group.items.forEach(item=>{item.geocodeStatus='pending';item.coordinateSource='';});tasks.push(group);}
    });
    let cursor=0,completed=0;
    const report=()=>{if(typeof onProgress==='function')onProgress({completed,total:tasks.length,cached,projection:projection(items)});};
    report();
    const worker=async()=>{
      for(;;){
        if(signal&&signal.aborted)throw abortError();
        const index=cursor++;if(index>=tasks.length)return;const group=tasks[index];
        let result;
        try{result=await geocode(group.address,{signal});}
        catch(error){if(error&&error.name==='AbortError')throw error;result={status:'failed',attempts:1,diagnostic:'client_error'};}
        const ttl=result&&result.status==='geocoded'?SUCCESS_TTL_MS:FAILURE_TTL_MS;
        cache&&cache.set(group.address,result,ttl);applyGeocodeResult(group.items,result,clusterService,'geocode_server');completed++;report();
      }
    };
    if(tasks.length&&typeof geocode==='function')await Promise.all(Array.from({length:Math.min(tasks.length,Math.max(1,Math.min(4,Math.trunc(Number(concurrency)||2))))},worker));
    else if(tasks.length){tasks.forEach(group=>applyGeocodeResult(group.items,{status:'failed',attempts:0,diagnostic:'geocoder_unavailable'},clusterService,''));completed=tasks.length;report();}
    return{completed,total:tasks.length,cached,projection:projection(items)};
  }

  return{SUCCESS_TTL_MS,FAILURE_TTL_MS,coordinates,normalizeAddress,canonicalUrl,listingId,clusterState,classify,projection,createAddressCache,createServerGeocoder,geocodeMissingListings};
});
