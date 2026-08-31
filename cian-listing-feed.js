(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SlogiCianFeed=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const DAY=24*60*60*1000;
  const ALLOWED_PREMISE_TYPES=Object.freeze(['office','retail','free_purpose']);
  const number=value=>{if(value==null||String(value).trim()==='')return null;const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;};
  const text=value=>String(value==null?'':value).trim().toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
  function normalizePremiseType(value,item={}){
    const raw=text(value??item.premiseType??item.premise_type);
    if(raw){
      if(['office','offices','офис','офисы','офисное помещение'].includes(raw))return'office';
      if(['retail','trade','shop','shopping_area','торговая площадь','торговое помещение','магазин'].includes(raw))return'retail';
      if(['free_purpose','free-purpose','free purpose','psn','псн','помещение свободного назначения','свободное назначение'].includes(raw))return'free_purpose';
      return raw.replace(/[^a-zа-я0-9]+/gi,'_').replace(/^_+|_+$/g,'');
    }
    const description=text([item.title,item.description].filter(Boolean).join(' '));
    if(/офис|office/.test(description))return'office';
    if(/торгов|магазин|ритейл|retail|shop/.test(description))return'retail';
    if(/свободн[а-я]*\s+назнач|(?:^|\s)псн(?:\s|$)|free[\s_-]*purpose/.test(description))return'free_purpose';
    return'';
  }
  function hasBasementOrSocle(item={}){
    const explicit=item.hasBasementOrSocle??item.has_basement_or_socle;
    const normalized=text(explicit);
    if(explicit===true||explicit===1||['true','1','yes','да'].includes(normalized))return true;
    const description=text([item.title,item.description].filter(Boolean).join(' '));
    return /подвал|подваль|цокол|цоколь|basement|semi[\s_-]*basement/.test(description);
  }
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
  function deduplicate(items){
    const externalIds=new Set(),urls=new Set(),result=[];
    (items||[]).forEach(item=>{
      const source=String(item&&item.source||''),externalId=String(item&&(item.externalId||item.external_id)||'').trim();
      const url=canonicalUrl(item&&(item.listingUrl||item.listing_url));
      const externalKey=externalId?source+':'+externalId:'',urlKey=url?source+':'+url:'';
      if((externalKey&&externalIds.has(externalKey))||(urlKey&&urls.has(urlKey)))return;
      if(!externalKey&&!urlKey)return;
      if(externalKey)externalIds.add(externalKey);if(urlKey)urls.add(urlKey);result.push(item);
    });
    return result;
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
    const requiredFloor=number(criteria.floor);
    const premiseTypes=Array.isArray(criteria.premiseTypes)?criteria.premiseTypes.map(value=>normalizePremiseType(value)).filter(Boolean):[];
    return items.filter(item=>{
      if(!isRecent(item,criteria.days||30,now))return false;
      const clusterMatch=!cluster
        ||(cluster==='__outside'?item.clusterStatus==='outside'
          :cluster==='__unresolved'?item.clusterStatus!=='inside'&&item.clusterStatus!=='outside'
            :cluster==='__unassigned'?!item.clusterId:item.clusterId===cluster);
      return clusterMatch&&within(item.area,criteria.areaMin,criteria.areaMax)
        &&(requiredFloor==null||number(item.floor)===requiredFloor)
        &&(!premiseTypes.length||premiseTypes.includes(normalizePremiseType(null,item)))
        &&(criteria.excludeBasementOrSocle!==true||!hasBasementOrSocle(item))
        &&within(item.rentMonthly,criteria.rentMin,criteria.rentMax)
        &&within(item.pricePerSquareMeter,criteria.sqmMin,criteria.sqmMax);
    }).sort((left,right)=>compareStable(left,right,criteria.sort));
  }
  function abortError(){const error=new Error('aborted');error.name='AbortError';return error;}
  function cursorKey(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return'';
    const firstSeenAt=String(value.firstSeenAt||''),source=String(value.source||''),listingUrl=String(value.listingUrl||'');
    return Number.isFinite(new Date(firstSeenAt).getTime())&&source&&listingUrl?JSON.stringify({firstSeenAt,source,listingUrl}):'';
  }
  async function loadAllPages(fetchPage,{limit=100,maxPages=10000,signal}={}){
    const pageSize=Math.max(1,Math.min(100,Math.trunc(number(limit)||100)));
    const pageLimit=Math.max(1,Math.min(10000,Math.trunc(number(maxPages)||10000)));
    const receivedItems=[],seenCursors=new Set(['start']);
    let page=1,cursor=null,snapshotAt=null,freshnessCutoff=null,serverTotal=null,meta=null,partial=false,errorCode=null,received=0;
    for(;;){
      if(signal&&signal.aborted)throw abortError();
      if(page>pageLimit){partial=true;errorCode='page_limit';break;}
      let result;
      try{result=await fetchPage({page,limit:pageSize,snapshotAt,cursor});}
      catch(error){if(error&&error.name==='AbortError')throw error;if(page===1)throw error;partial=true;errorCode='page_failed';break;}
      if(!result||!Array.isArray(result.items)||!result.meta){if(page===1)throw new Error('listing_page_invalid');partial=true;errorCode='page_shape';break;}
      meta=result.meta;
      const metaPage=Number(meta.page);if(Number.isSafeInteger(metaPage)&&metaPage!==page){partial=true;errorCode='page_mismatch';break;}
      if(page===1){
        snapshotAt=String(meta.snapshotAt||'');freshnessCutoff=String(meta.freshnessCutoff||'');
        const snapshotTime=new Date(snapshotAt).getTime(),cutoffTime=new Date(freshnessCutoff).getTime();
        if(!Number.isFinite(snapshotTime))throw new Error('listing_snapshot_invalid');
        if(!Number.isFinite(cutoffTime)||cutoffTime!==snapshotTime-30*DAY)throw new Error('listing_cutoff_invalid');
      }else if(String(meta.snapshotAt||'')!==snapshotAt){partial=true;errorCode='snapshot_changed';break;}
      else if(String(meta.freshnessCutoff||'')!==freshnessCutoff){partial=true;errorCode='cutoff_changed';break;}
      const candidateTotal=Number(meta.total);
      if(serverTotal==null&&Number.isSafeInteger(candidateTotal)&&candidateTotal>=0)serverTotal=candidateTotal;
      const returned=Number(meta.returned);received+=Number.isSafeInteger(returned)&&returned>=0?returned:result.items.length;
      receivedItems.push(...result.items);
      if(meta.hasMore!==true){if(serverTotal!=null&&received!==serverTotal){partial=true;errorCode='total_mismatch';}break;}
      if(result.items.length===0){partial=true;errorCode='empty_page';break;}
      const nextKey=cursorKey(meta.nextCursor);if(!nextKey){partial=true;errorCode='cursor_invalid';break;}
      if(seenCursors.has(nextKey)){partial=true;errorCode='pagination_cycle';break;}
      seenCursors.add(nextKey);cursor=meta.nextCursor;page+=1;
    }
    const items=deduplicate(receivedItems).sort((left,right)=>compareStable(left,right));
    return {items,total:partial?(serverTotal??items.length):items.length,serverTotal,partial,errorCode,meta,pages:page,received,snapshotAt,freshnessCutoff};
  }
  return{ALLOWED_PREMISE_TYPES,canonicalUrl,identity,deduplicate,freshnessTime,isRecent,compareStable,normalizePremiseType,hasBasementOrSocle,filterAndSort,loadAllPages};
});
