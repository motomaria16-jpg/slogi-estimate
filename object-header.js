(function(){
  const STORAGE_KEY='slogi_locations_v1';
  function readLocations(){
    try{
      const raw=localStorage.getItem(STORAGE_KEY);
      const data=raw?JSON.parse(raw):[];
      return Array.isArray(data)?data:[];
    }catch(err){return [];}
  }
  function findRecord(id){
    if(!id)return null;
    return readLocations().find(item=>item&&item.id===id)||null;
  }
  function setHeader(id,address){
    const link=document.getElementById('object-header-link');
    if(!link)return;
    const clean=String(address||'').trim();
    if(!id||!clean){
      link.hidden=true;
      link.removeAttribute('href');
      link.textContent='';
      return;
    }
    link.hidden=false;
    link.href='passport.html?location='+encodeURIComponent(id);
    link.textContent=clean;
    link.title='Открыть паспорт объекта: '+clean;
    link.setAttribute('aria-label','Открыть паспорт объекта '+clean);
  }
  function currentId(){
    const select=document.getElementById('location-select');
    if(select&&select.value)return select.value;
    return new URLSearchParams(window.location.search).get('location')||'';
  }
  function refresh(){
    const id=currentId();
    const record=findRecord(id);
    const addressInput=document.getElementById('location-address');
    const address=(addressInput&&addressInput.value.trim())||(record&&record.address)||'';
    setHeader(id,address);
  }
  window.SlogiObjectHeader={
    refresh,
    set:function(id,address){setHeader(id,address);}
  };
  function init(){
    refresh();
    const select=document.getElementById('location-select');
    if(select)select.addEventListener('change',()=>setTimeout(refresh,0));
    const addressInput=document.getElementById('location-address');
    if(addressInput)addressInput.addEventListener('input',refresh);
    window.addEventListener('popstate',refresh);
    window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY)refresh();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
