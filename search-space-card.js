(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SlogiSearchSpaceCard=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const CARD_SCHEMA_VERSION=2;
  const YES_NO=Object.freeze(['yes','no']);
  const TRI_STATE=Object.freeze(['yes','no','unknown']);
  const REPAIR_OPTIONS=Object.freeze(['none','rough','finished']);
  const CLUSTER_STATUSES=Object.freeze(['inside','outside','address','not_computed']);

  const first=(...values)=>values.find(value=>value!==undefined&&value!==null);
  const text=value=>String(value==null?'':value).trim().replace(/\s+/g,' ');
  const key=value=>text(value).toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
  function number(value){
    if(value==null||String(value).trim()==='')return null;
    const parsed=Number(String(value).trim().replace(/\s+/g,'').replace(',','.'));
    return Number.isFinite(parsed)?parsed:null;
  }
  const positive=value=>{const parsed=number(value);return parsed!=null&&parsed>0?parsed:null;};
  const rounded=(value,digits=2)=>value==null?null:Number(Number(value).toFixed(digits));
  function listingUrl(value){
    const raw=text(value);
    if(!raw)return'';
    try{const url=new URL(raw);return['http:','https:'].includes(url.protocol)?url.href:'';}catch(_error){return'';}
  }

  function resolutionSource(value){
    const normalized=key(value);
    if(['manual','manually','ручной','вручную'].includes(normalized))return'manual';
    if(['automatic','auto','automatically','автоматически','авто'].includes(normalized))return'automatic';
    return null;
  }

  function yesNo(value,fallback='no'){
    if(value===true||value===1)return'yes';
    if(value===false||value===0)return'no';
    const normalized=key(value);
    if(['yes','y','true','1','да'].includes(normalized))return'yes';
    if(['no','n','false','0','нет'].includes(normalized))return'no';
    return fallback;
  }

  function triState(value){
    if(value===true||value===1)return'yes';
    if(value===false||value===0)return'no';
    const normalized=key(value);
    if(['yes','y','true','1','да','есть'].includes(normalized))return'yes';
    if(['no','n','false','0','нет'].includes(normalized))return'no';
    return'unknown';
  }

  function repair(value){
    const normalized=key(value);
    if(['none','no','нет','без ремонта','отсутствует'].includes(normalized))return'none';
    if(['rough','shell','черновой','черновая','черновая отделка'].includes(normalized))return'rough';
    if(['finished','finish','чистовой','чистовая','чистовая отделка','готовый'].includes(normalized))return'finished';
    return'unknown';
  }

  function sourceState(input){
    const raw=key(first(input.sourceKind,input.source_kind,input.origin,input.source));
    const manual=raw==='manual'||raw==='ручной'||raw==='вручную';
    return{
      source:manual?'manual':'parsed',
      sourceProvider:manual?'':text(first(input.sourceProvider,input.source_provider,raw&&raw!=='parsed'?raw:'')),
    };
  }

  function clusterState(input){
    const source=input.cluster&&typeof input.cluster==='object'?input.cluster:{};
    const id=text(first(source.id,source.clusterId,source.cluster_id,input.clusterId,input.cluster_id));
    const name=text(first(source.name,source.clusterName,source.cluster_name,input.clusterName,input.cluster_name));
    const rawStatus=key(first(source.status,source.clusterStatus,source.cluster_status,input.clusterStatus,input.cluster_status));
    const matchedValue=first(source.matched,input.clusterMatched,input.cluster_matched);
    let status=CLUSTER_STATUSES.includes(rawStatus)?rawStatus:'';
    if(!status){
      if(matchedValue===true||yesNo(matchedValue,'')==='yes')status='inside';
      else if(matchedValue===false||yesNo(matchedValue,'')==='no')status='outside';
      else if(rawStatus==='unresolved'||rawStatus==='unknown'||rawStatus==='invalid')status='not_computed';
      else status=id||name?'inside':'not_computed';
    }
    const matched=status==='inside'||status==='address';
    const centerRaw=first(source.hasSlogiCenter,source.has_slogi_center,source.centerInCluster,source.center_in_cluster,input.hasSlogiCenter,input.has_slogi_center,input.centerInCluster,input.center_in_cluster);
    const centerState=triState(centerRaw);
    return{
      id,
      name,
      status,
      matched,
      resolutionSource:resolutionSource(first(source.resolutionSource,source.resolution_source,input.clusterResolutionSource,input.cluster_resolution_source)),
      hasSlogiCenter:centerState==='unknown'?null:centerState==='yes',
      centerDetails:text(first(source.centerDetails,source.center_details,input.centerDetails,input.center_details)),
    };
  }

  function competitiveState(input,pricePerSqm){
    const source=input.competitive&&typeof input.competitive==='object'?input.competitive:{};
    const rating=number(first(source.rating,source.score,input.competitiveRating,input.competitive_rating,input.rating));
    const rankValue=positive(first(source.rank,source.clusterRank,source.cluster_rank,input.clusterRank,input.cluster_rank));
    const rank=rankValue==null?null:Math.trunc(rankValue);
    const averageRentPerSqm=positive(first(source.averageRentPerSqm,source.average_rent_per_sqm,source.avgPricePerSqm,source.avg_price_per_sqm,input.averageRentPerSqm,input.average_rent_per_sqm,input.avgPricePerSqm,input.avg_price_per_sqm));
    const comparisonPercentOverride=number(first(source.comparisonPercentOverride,source.comparison_percent_override,input.comparisonPercentOverride,input.comparison_percent_override));
    const calculatedDeltaRentPerSqm=pricePerSqm!=null&&averageRentPerSqm!=null?rounded(pricePerSqm-averageRentPerSqm):null;
    const calculatedDeltaPercent=calculatedDeltaRentPerSqm!=null?rounded(calculatedDeltaRentPerSqm/averageRentPerSqm*100):null;
    const deltaPercent=comparisonPercentOverride==null?calculatedDeltaPercent:rounded(comparisonPercentOverride);
    const deltaRentPerSqm=deltaPercent!=null&&averageRentPerSqm!=null?rounded(averageRentPerSqm*deltaPercent/100):calculatedDeltaRentPerSqm;
    const priceDirection=deltaRentPerSqm==null?'unknown':Math.abs(deltaRentPerSqm)<0.01?'equal':deltaRentPerSqm>0?'higher':'lower';
    return{
      rating,
      rank,
      isTop30:rank==null?null:rank>=1&&rank<=30,
      isTop35:rank==null?null:rank>=1&&rank<=35,
      resolutionSource:resolutionSource(first(source.resolutionSource,source.resolution_source,input.competitiveResolutionSource,input.competitive_resolution_source)),
      averageRentPerSqm:rounded(averageRentPerSqm),
      comparisonPercentOverride:comparisonPercentOverride==null?null:rounded(comparisonPercentOverride),
      deltaRentPerSqm,
      deltaPercent,
      priceDirection,
    };
  }

  function normalizeCore(input={}){
    const source=sourceState(input);
    const rentMonthly=positive(first(input.rentMonthly,input.rent_monthly,input.monthlyRent,input.monthly_rent,input.price));
    const area=positive(first(input.area,input.areaSqm,input.area_sqm,total(input,'technical','area')));
    const calculatedPricePerSqm=rentMonthly!=null&&area!=null?rounded(rentMonthly/area):null;
    const pricePerSqmOverride=positive(first(input.pricePerSqmOverride,input.price_per_sqm_override,total(input,'technical','pricePerSqmOverride')));
    const pricePerSqm=pricePerSqmOverride==null?calculatedPricePerSqm:rounded(pricePerSqmOverride);
    const areaConfirmedInput=first(input.areaConfirmed,input.area_confirmed,total(input,'technical','areaConfirmed'));
    const explicitAreaConfirmed=triState(areaConfirmedInput);
    let areaConfirmedSource=resolutionSource(first(input.areaConfirmedSource,input.area_confirmed_source,total(input,'technical','areaConfirmedSource')));
    let areaConfirmed=explicitAreaConfirmed;
    if(areaConfirmedSource==='automatic'||areaConfirmed==='unknown'){
      areaConfirmed=area==null?'unknown':area>=90&&area<=150?'yes':'no';
      if(area!=null&&areaConfirmedSource!=='manual')areaConfirmedSource='automatic';
    }else if(!areaConfirmedSource){
      areaConfirmedSource='manual';
    }
    const hasWindows=triState(first(input.hasWindows,input.has_windows,input.windows,total(input,'technical','hasWindows'),total(input,'technical','windows')));
    const windowsOpen=hasWindows==='yes'
      ?triState(first(input.windowsOpen,input.windows_open,input.openableWindows,input.openable_windows,total(input,'technical','windowsOpen')))
      :'unknown';
    const cluster=clusterState(input);
    const competitive=competitiveState(input,pricePerSqm);
    return{
      schemaVersion:CARD_SCHEMA_VERSION,
      id:text(first(input.id,input.cardId,input.card_id,input.externalId,input.external_id)),
      source:source.source,
      sourceProvider:source.sourceProvider,
      listingUrl:listingUrl(first(input.listingUrl,input.listing_url,input.canonicalUrl,input.canonical_url)),
      address:text(first(input.address,input.fullAddress,input.full_address)),
      geo:{
        lat:number(first(total(input,'geo','lat'),total(input,'geo','latitude'),input.latitude,input.lat)),
        lng:number(first(total(input,'geo','lng'),total(input,'geo','longitude'),input.longitude,input.lng)),
        resolutionSource:resolutionSource(first(total(input,'geo','resolutionSource'),total(input,'geo','resolution_source'),input.geoResolutionSource,input.geo_resolution_source)),
      },
      cluster,
      competitive,
      rentMonthly:rounded(rentMonthly),
      area:rounded(area),
      areaConfirmed,
      areaConfirmedSource,
      calculatedPricePerSqm,
      pricePerSqmOverride:pricePerSqmOverride==null?null:rounded(pricePerSqmOverride),
      pricePerSqm,
      separateEntrance:triState(first(input.separateEntrance,input.separate_entrance,total(input,'technical','separateEntrance'))),
      hasWindows,
      windowsOpen,
      ceilingHeight:rounded(positive(first(input.ceilingHeight,input.ceiling_height,total(input,'technical','ceilingHeight')))),
      ceilingHeightConfirmed:triState(first(input.ceilingHeightConfirmed,input.ceiling_height_confirmed,total(input,'technical','ceilingHeightConfirmed'))),
      repair:repair(first(input.repair,input.repairType,input.repair_type,total(input,'technical','repair'))),
      work:input.work&&typeof input.work==='object'?Object.assign({},input.work):{},
      clusterRank:competitive.rank,
      top30:competitive.isTop30,
      top35:competitive.isTop35,
    };
  }

  function total(input,section,property){
    const value=input&&input[section];
    return value&&typeof value==='object'?value[property]:undefined;
  }

  function evaluate(input={}){
    const card=normalizeCore(input);
    const required={
      address:card.address.length>0,
      rentMonthly:card.rentMonthly!=null,
      area:card.area!=null,
      areaConfirmed:card.areaConfirmed==='yes',
      pricePerSqm:card.pricePerSqm!=null,
      separateEntrance:card.separateEntrance!=='unknown',
      hasWindows:card.hasWindows!=='unknown',
      windowsOpen:card.hasWindows!=='yes'||card.windowsOpen!=='unknown',
      ceilingHeight:card.ceilingHeight!=null,
      ceilingHeightConfirmed:card.ceilingHeightConfirmed==='yes',
      repair:REPAIR_OPTIONS.includes(card.repair),
      competitiveAverage:card.competitive.averageRentPerSqm!=null,
    };
    const checks={
      clusterInside:card.cluster.status==='inside'&&card.cluster.matched&&Boolean(card.cluster.id||card.cluster.name),
      clusterFree:card.cluster.hasSlogiCenter===false,
      clusterTop35:card.competitive.isTop35,
      requiredComplete:Object.values(required).every(Boolean),
    };
    const missingFields=Object.entries(required).filter(([,complete])=>!complete).map(([field])=>field);
    const reasons=[];
    if(!checks.clusterInside)reasons.push(card.cluster.status==='outside'?'cluster_outside':'cluster_not_confirmed');
    if(!checks.clusterFree)reasons.push(card.cluster.hasSlogiCenter===true?'cluster_occupied':'cluster_occupancy_unknown');
    if(!checks.clusterTop35)reasons.push(card.competitive.rank==null?'cluster_rank_unknown':'cluster_not_top35');
    if(missingFields.length)reasons.push('required_fields_incomplete');
    const alreadyInWork=key(card.work&&card.work.status)==='in_work';
    if(alreadyInWork)reasons.push('already_in_work');
    const eligible=Object.values(checks).every(Boolean)&&!alreadyInWork;
    return{eligible,canTakeToWork:eligible,checks,required,missingFields,reasons};
  }

  function normalize(input={}){
    const card=normalizeCore(input),eligibility=evaluate(card);
    return Object.assign(card,{eligibility,canTakeToWork:eligibility.canTakeToWork});
  }

  return{
    CARD_SCHEMA_VERSION,
    YES_NO,
    TRI_STATE,
    REPAIR_OPTIONS,
    CLUSTER_STATUSES,
    normalize,
    evaluate,
  };
});
