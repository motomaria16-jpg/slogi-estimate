(function(){
  'use strict';
  const STORAGE_KEY='slogi_locations_v1';
  const API_KEY=String(window.SLOGI_API_KEY||'');
  let enabled=false;
  let internalWrite=false;
  const apiHeaders=extra=>Object.assign(API_KEY?{'X-Slogi-Key':API_KEY}:{},extra||{});
  function nativeSet(key,value){internalWrite=true;try{localStorage.setItem(key,value);}finally{internalWrite=false;}}
  function initialSync(){
    try{
      const localRaw=localStorage.getItem(STORAGE_KEY)||'[]';
      const local=JSON.parse(localRaw); 
      const xhr=new XMLHttpRequest();
      xhr.open('GET','api/locations',false);
      if(API_KEY)xhr.setRequestHeader('X-Slogi-Key',API_KEY);
      xhr.send();
      if(xhr.status!==200)return;
      const remote=JSON.parse(xhr.responseText||'[]');
      if(!Array.isArray(remote))return;
      enabled=true;
      if(remote.length){nativeSet(STORAGE_KEY,JSON.stringify(remote));}
      else if(Array.isArray(local)&&local.length){
        const up=new XMLHttpRequest();up.open('PUT','api/locations',false);up.setRequestHeader('Content-Type','application/json;charset=utf-8');if(API_KEY)up.setRequestHeader('X-Slogi-Key',API_KEY);up.send(JSON.stringify(local));
      }else nativeSet(STORAGE_KEY,'[]');
    }catch(err){enabled=false;}
  }
  initialSync();
  const originalSet=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){
    originalSet.call(this,key,value);
    if(internalWrite||this!==localStorage||key!==STORAGE_KEY||!enabled)return;
    fetch('api/locations',{method:'PUT',headers:apiHeaders({'Content-Type':'application/json;charset=utf-8'}),body:String(value)}).catch(()=>{});
  };
  function endpoint(locationId,type){return 'api/attachments/'+encodeURIComponent(locationId)+'/'+encodeURIComponent(type);}
  window.SlogiCloud={
    get enabled(){return enabled;},
    async getAttachment(locationId,type){
      if(!enabled||!locationId||!type)return null;
      try{
        const response=await fetch(endpoint(locationId,type),{headers:apiHeaders()});
        if(response.status===404)return null;
        if(!response.ok)throw new Error('HTTP '+response.status);
        const blob=await response.blob();
        const encoded=response.headers.get('X-File-Name')||'';
        let name='Файл';try{name=decodeURIComponent(encoded)||name;}catch(err){}
        return {key:locationId+':'+type,locationId,type,name,mime:response.headers.get('Content-Type')||blob.type||'application/octet-stream',blob,updatedAt:response.headers.get('X-Updated-At')||''};
      }catch(err){return null;}
    },
    async saveAttachment(locationId,type,blob,name){
      if(!enabled||!locationId||!type||!blob)return false;
      try{
        const response=await fetch(endpoint(locationId,type),{method:'PUT',headers:apiHeaders({'Content-Type':blob.type||'application/octet-stream','X-File-Name':encodeURIComponent(name||'Файл')}),body:blob});
        return response.ok;
      }catch(err){return false;}
    },
    async deleteAttachments(locationId){
      if(!enabled||!locationId)return false;
      try{return (await fetch('api/attachments/'+encodeURIComponent(locationId),{method:'DELETE',headers:apiHeaders()})).ok;}catch(err){return false;}
    }
  };
})();
