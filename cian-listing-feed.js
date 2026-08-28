(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SlogiCianFeed=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const DAY=24*60*60*1000;
  const number=value=>{if(value==null||String(value).trim()==='')return null;const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;};
  function canonicalUrl(value){
    try{
      const url=new URL(String(value||''));
      url.hash='';url.search='';url.hostname=url.hostname.toLowerCase();
      url.pathname=url.pathname.replace(/\/+$/,'')||'/';
      return url.toString();
    }catch(_error){return String(value||'').trim();}
  }
  function identity(item){
    const source=String(item&&item.source||'');
    const externalId=String(item&&(item.externalId||item.external_id)||'').trim();
    const listingUrl=canonicalUrl(item&&(item.listingUrl||item.listing_url));
    return source+':'+(externalId||listingUrl);
  }
  function freshnessTime(item){
    if(!item||(item.freshnessKind!=='published'&&item.freshnessKind!=='updated'))return null;
    const time=new Date(item&&item.freshnessAt||'').getTime();
    return Number.isFinite(time)?time:null;
  }
  function isRecent(item,days=30,now=Date.now()){
    if(!item||item.marketStatus==='removed'||item.source!=='cian')return false;
    const time=freshnessTime(item);if(time==null)return false;
    const age=Number(now)-time;return age>=0&&age<=Number(days)*DAY;
  }
  function compareStable(left,right,sort='freshness-desc'){
    let primary=0;
    if(sort==='rent-asc')primary=(left.rentMonthly??Infinity)-(right.rentMonthly??Infinity);
    else if(sort==='area-asc')primary=(left.area??Infinity)-(right.area??Infinity);
    else if(sort==='sqm-asc')primary=(left.pricePerSquareMeter??Infinity)-(right.pricePerSquareMeter??Infinity);
    else primary=(freshnessTime(right)??-Infinity)-(freshnessTime(left)??-Infinity);
    if(primary)return primary;
    const freshness=(freshnessTime(right)??-Infinity)-(freshnessTime(left)??-Infinity);
    return freshness||identity(left).localeCompare(identity(right));
  }
  function within(value,min,max){if(min!=null&&(value==null||value<min))return false;if(max!=null&&(value==null||value>max))return false;return true;}
  function filterAndSort(items,criteria={},now=Date.now()){
    const cluster=String(criteria.cluster||'');
    return items.filter(item=>{
      if(!isRecent(item,criteria.days||30,now))return false;
      const clusterMatch=!cluster
        ||(cluster==='__outside'?item.clusterStatus==='outside'
          :cluster==='__unresolved'?item.clusterStatus!=='inside'&&item.clusterStatus!=='outside'
            :cluster==='__unassigned'?!item.clusterId:item.clusterId===cluster);
      return clusterMatch&&within(item.area,criteria.areaMin,criteria.areaMax)
        &&within(item.rentMonthly,criteria.rentMin,criteria.rentMax)
        &&within(item.pricePerSquareMeter,criteria.sqmMin,criteria.sqmMax);
    }).sort((left,right)=>compareStable(left,right,criteria.sort));
  }
  function abortError(){const error=new Error('aborted');error.name='AbortError';return error;}
  async function loadAllPages(fetchPage,{limit=100,maxPages=10000,signal}={}){
    const pageSize=Math.max(1,Math.min(100,Math.trunc(number(limit)||100)));
    const pageLimit=Math.max(1,Math.min(10000,Math.trunc(number(maxPages)||10000)));
    const unique=new Map();const seenPages=new Set();
    let page=1,snapshotAt=null,serverTotal=null,meta=null,partial=false,errorCode=null,received=0;
    for(;;){
      if(signal&&signal.aborted)throw abortError();
      if(seenPages.size>=pageLimit){partial=true;errorCode='page_limit';break;}
      if(seenPages.has(page)){partial=true;errorCode='pagination_cycle';break;}
      seenPages.add(page);
      let result;
      try{result=await fetchPage({page,limit:pageSize,snapshotAt});}
      catch(error){if(error&&error.name==='AbortError')throw error;if(page===1)throw error;partial=true;errorCode='page_failed';break;}
      if(!result||!Array.isArray(result.items)||!result.meta){if(page===1)throw new Error('listing_page_invalid');partial=true;errorCode='page_shape';break;}
      meta=result.meta;
      const metaPage=Number(meta.page);if(Number.isSafeInteger(metaPage)&&metaPage!==page){partial=true;errorCode='page_mismatch';break;}
      if(page===1){snapshotAt=String(meta.snapshotAt||'');if(!snapshotAt||!Number.isFinite(new Date(snapshotAt).getTime()))throw new Error('listing_snapshot_invalid');}
      else if(String(meta.snapshotAt||'')!==snapshotAt){partial=true;errorCode='snapshot_changed';break;}
      const candidateTotal=Number(meta.total);
      if(Number.isSafeInteger(candidateTotal)&&candidateTotal>=0){
        if(serverTotal==null)serverTotal=candidateTotal;
        else if(candidateTotal!==serverTotal){partial=true;errorCode='total_changed';break;}
      }
      const returned=Number(meta.returned);received+=Number.isSafeInteger(returned)&&returned>=0?returned:result.items.length;
      result.items.forEach(item=>{const key=identity(item);if(key!==':'&&!unique.has(key))unique.set(key,item);});
      if(meta.hasMore!==true){if(serverTotal!=null&&received!==serverTotal){partial=true;errorCode='total_mismatch';}break;}
      if(result.items.length===0){partial=true;errorCode='empty_page';break;}
      const next=Number(meta.nextPage);if(!Number.isSafeInteger(next)||next<=page){partial=true;errorCode='pagination_invalid';break;}
      if(serverTotal!=null&&next>Math.max(1,Math.ceil(serverTotal/pageSize))){partial=true;errorCode='pagination_exceeds_total';break;}
      page=next;
    }
    const items=[...unique.values()].sort((left,right)=>compareStable(left,right));
    return {items,total:partial?(serverTotal??items.length):items.length,serverTotal,partial,errorCode,meta,pages:seenPages.size,received};
  }
  return{canonicalUrl,identity,freshnessTime,isRecent,compareStable,filterAndSort,loadAllPages};
});
