(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SlogiClusterGeometry=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const DEFAULT_EPSILON=1e-10;

  function coordinate(value){
    if(value==null||String(value).trim()==='')return null;
    const parsed=Number(value);
    return Number.isFinite(parsed)?parsed:null;
  }

  function validPoint(point){
    return Array.isArray(point)&&point.length>=2&&coordinate(point[0])!=null&&coordinate(point[1])!=null;
  }

  function pointOnSegment(point,start,end,epsilon=DEFAULT_EPSILON){
    if(!validPoint(point)||!validPoint(start)||!validPoint(end))return false;
    const px=Number(point[0]),py=Number(point[1]),ax=Number(start[0]),ay=Number(start[1]),bx=Number(end[0]),by=Number(end[1]);
    const dx=bx-ax,dy=by-ay,cross=(px-ax)*dy-(py-ay)*dx;
    const scale=Math.max(1,Math.abs(dx),Math.abs(dy));
    if(Math.abs(cross)>Number(epsilon)*scale)return false;
    const dot=(px-ax)*(px-bx)+(py-ay)*(py-by);
    return dot<=Number(epsilon)*scale*scale;
  }

  function ringPosition(point,ring,epsilon=DEFAULT_EPSILON){
    if(!validPoint(point)||!Array.isArray(ring)||ring.length<3)return'outside';
    let inside=false;
    for(let index=0,previous=ring.length-1;index<ring.length;previous=index++){
      const currentPoint=ring[index],previousPoint=ring[previous];
      if(pointOnSegment(point,previousPoint,currentPoint,epsilon))return'boundary';
      const x=Number(point[0]),y=Number(point[1]),xi=Number(currentPoint[0]),yi=Number(currentPoint[1]),xj=Number(previousPoint[0]),yj=Number(previousPoint[1]);
      const intersects=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi);
      if(intersects)inside=!inside;
    }
    return inside?'inside':'outside';
  }

  // Boundary rule: every polygon boundary is owned by the polygon. When two
  // canonical polygons share a boundary, their source order is the tie-breaker.
  function polygonPosition(point,polygon,epsilon=DEFAULT_EPSILON){
    if(!Array.isArray(polygon)||!polygon.length)return'outside';
    const outer=ringPosition(point,polygon[0],epsilon);
    if(outer==='outside')return'outside';
    if(outer==='boundary')return'boundary';
    for(let index=1;index<polygon.length;index++){
      const hole=ringPosition(point,polygon[index],epsilon);
      if(hole==='boundary')return'boundary';
      if(hole==='inside')return'outside';
    }
    return'inside';
  }

  function featurePosition(feature,latitude,longitude,epsilon=DEFAULT_EPSILON){
    const lat=coordinate(latitude),lng=coordinate(longitude),geometry=feature&&feature.geometry;
    if(lat==null||lng==null||lat>90||lat< -90||lng>180||lng< -180||!geometry)return'invalid';
    const point=[lng,lat];
    if(geometry.type==='Polygon')return polygonPosition(point,geometry.coordinates,epsilon);
    if(geometry.type==='MultiPolygon'){
      let boundary=false;
      for(const polygon of geometry.coordinates||[]){
        const position=polygonPosition(point,polygon,epsilon);
        if(position==='inside')return'inside';
        if(position==='boundary')boundary=true;
      }
      return boundary?'boundary':'outside';
    }
    return'invalid';
  }

  function idOf(feature){
    const properties=feature&&feature.properties||{};
    return String(properties.id||properties.clusterId||properties.name||'').trim();
  }

  function nameOf(feature){return String(feature&&feature.properties&&feature.properties.name||'').trim();}

  function list(collection){
    const features=collection&&Array.isArray(collection.features)?collection.features:[];
    return features.map((feature,index)=>({id:idOf(feature),name:nameOf(feature),feature,canonicalIndex:index})).filter(item=>item.id&&item.name);
  }

  function locate(collection,latitude,longitude,epsilon=DEFAULT_EPSILON){
    const lat=coordinate(latitude),lng=coordinate(longitude);
    if(lat==null||lng==null||lat>90||lat< -90||lng>180||lng< -180)return{status:'invalid',clusterId:'',clusterName:'',boundary:false,feature:null};
    for(const item of list(collection)){
      const position=featurePosition(item.feature,lat,lng,epsilon);
      if(position==='inside'||position==='boundary')return{status:'inside',clusterId:item.id,clusterName:item.name,boundary:position==='boundary',feature:item.feature,canonicalIndex:item.canonicalIndex};
    }
    return{status:'outside',clusterId:'',clusterName:'',boundary:false,feature:null};
  }

  return{DEFAULT_EPSILON,pointOnSegment,ringPosition,polygonPosition,featurePosition,idOf,nameOf,list,locate};
});
