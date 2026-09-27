(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SlogiFastNavigation=api;
  if(root&&root.document)api.boot(root);
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const VIEW_PARAM='__slogi_view';
  const FAST_ROUTES=Object.freeze(['available-spaces.html','in-work.html']);

  function routeName(value){
    try{
      const url=value instanceof URL?value:new URL(String(value),'http://slogi.local/');
      const name=url.pathname.split('/').pop().toLowerCase();
      return FAST_ROUTES.includes(name)?name:'';
    }catch(_error){return'';}
  }

  function directory(pathname){const index=String(pathname||'/').lastIndexOf('/');return String(pathname||'/').slice(0,index+1);}

  function cleanUrl(value,base){
    const url=new URL(String(value),base);
    url.searchParams.delete(VIEW_PARAM);
    return url;
  }

  function isFastUrl(value,base){
    try{
      const target=cleanUrl(value,base),current=new URL(base);
      return target.origin===current.origin&&directory(target.pathname)===directory(current.pathname)&&Boolean(routeName(target));
    }catch(_error){return false;}
  }

  function iframeUrl(value,base){const url=cleanUrl(value,base);url.searchParams.set(VIEW_PARAM,'1');return url.href;}

  function clickTarget(event,anchor,currentHref){
    if(!event||!anchor||event.defaultPrevented)return null;
    if(event.button!=null&&event.button!==0)return null;
    if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return null;
    if(anchor.hasAttribute&&anchor.hasAttribute('download'))return null;
    const target=String(anchor.getAttribute&&anchor.getAttribute('target')||'').toLowerCase();
    if(target&&target!=='_self')return null;
    const raw=anchor.getAttribute&&anchor.getAttribute('href');
    if(!raw||String(raw).trim().startsWith('#'))return null;
    let url;try{url=cleanUrl(anchor.href||raw,currentHref);}catch(_error){return null;}
    const current=cleanUrl(currentHref,currentHref);
    if(!['http:','https:'].includes(url.protocol)||!isFastUrl(url,current))return null;
    if(url.pathname===current.pathname&&url.search===current.search&&url.hash)return null;
    return url;
  }

  function viewContractReady(frameDoc,required){
    return Boolean(frameDoc&&frameDoc.documentElement&&frameDoc.documentElement.getAttribute('data-slogi-access')==='granted'&&frameDoc.querySelector(required));
  }

  function createNavigationCoordinator(options={}){
    const initial=cleanUrl(options.initialUrl,options.initialUrl).href;
    let revision=0,current=initial;
    async function navigate(value,mode='push'){
      const target=cleanUrl(value,current),href=target.href;
      if(!isFastUrl(target,initial))return false;
      const token=++revision;
      if(mode==='push'&&typeof options.pushState==='function')options.pushState(href);
      if(typeof options.setBusy==='function')options.setBusy(true);
      try{
        const view=await options.loadView(href);
        if(token!==revision){if(view&&typeof view.dispose==='function')view.dispose();return false;}
        if(typeof options.showView==='function')options.showView(view,href);
        if(typeof options.setActive==='function')options.setActive(href);
        current=href;
        return true;
      }catch(error){
        if(token===revision&&typeof options.hardNavigate==='function')options.hardNavigate(href,error);
        return false;
      }finally{
        if(token===revision&&typeof options.setBusy==='function')options.setBusy(false);
      }
    }
    return{navigate,pop:value=>navigate(value,'pop'),current:()=>current,cancel:()=>{revision++;}};
  }

  function createBoundedViewCache(options={}){
    const maximum=Math.max(1,Math.min(2,Number(options.max)||2)),entries=new Map();let sequence=0;
    function remove(key){
      const entry=entries.get(key);if(!entry)return;
      entries.delete(key);if(entry.value&&typeof options.dispose==='function')options.dispose(entry.value);else entry.promise.then(value=>options.dispose&&options.dispose(value)).catch(()=>{});
    }
    function trim(protectedKey){
      while(entries.size>maximum){
        const candidates=Array.from(entries.values()).filter(entry=>entry.key!==protectedKey).sort((a,b)=>a.used-b.used);
        if(!candidates.length)return;remove(candidates[0].key);
      }
    }
    function get(key,href){
      const existing=entries.get(key);
      if(existing&&existing.href===href){existing.used=++sequence;return existing.promise;}
      if(existing)remove(key);
      const entry={key,href,used:++sequence,value:null,promise:null};
      entry.promise=Promise.resolve().then(()=>options.load(key,href)).then(value=>{entry.value=value;return value;}).catch(error=>{if(entries.get(key)===entry)entries.delete(key);throw error;});
      entries.set(key,entry);trim(key);return entry.promise;
    }
    return{get,has:key=>entries.has(key),size:()=>entries.size,keys:()=>Array.from(entries.keys()),remove,clear:()=>Array.from(entries.keys()).forEach(remove)};
  }

  function bootEmbedded(win){
    const doc=win.document;
    doc.documentElement.setAttribute('data-slogi-fast-view','embedded');
    const onClick=event=>{
      const anchor=event.target&&event.target.closest&&event.target.closest('a[href]');
      if(!anchor)return;
      const target=clickTarget(event,anchor,win.location.href);
      if(target){event.preventDefault();win.parent.postMessage({type:'slogi-fast-navigation',href:target.href},win.location.origin);return;}
      if(event.defaultPrevented||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||anchor.hasAttribute('download'))return;
      const raw=anchor.getAttribute('href')||'';
      if(raw.startsWith('#'))return;
      const declared=String(anchor.getAttribute('target')||'').toLowerCase();
      if(!declared||declared==='_self')anchor.setAttribute('target','_top');
    };
    doc.addEventListener('click',onClick,true);
  }

  function bootHost(win){
    const doc=win.document,initial=cleanUrl(win.location.href,win.location.href).href;
    win.__slogiFastNavigationHost=true;
    doc.documentElement.setAttribute('data-slogi-fast-host','true');

    const start=()=>{
      if(!doc.body||doc.body.classList.contains('slogi-fast-navigation-host'))return;
      doc.body.classList.add('slogi-fast-navigation-host');
      const shell=doc.querySelector('.figma-shell-sidebar');
      if(!shell){win.location.replace(initial);return;}

      const host=doc.createElement('div');host.className='slogi-fast-view-host';host.setAttribute('aria-live','polite');
      const status=doc.createElement('div');status.className='slogi-fast-view-status';status.setAttribute('role','status');status.textContent='Загружаем раздел…';host.appendChild(status);doc.body.appendChild(host);
      let activeFrame=null;

      function createFrame(_route,href){
        return new Promise((resolve,reject)=>{
          const frame=doc.createElement('iframe');frame.className='slogi-fast-view-frame is-preloading';frame.title='Раздел платформы СЛОГИ';frame.setAttribute('aria-hidden','true');
          let settled=false,accessObserver=null;
          const finish=(callback,value)=>{if(settled)return;settled=true;win.clearTimeout(timer);if(accessObserver)accessObserver.disconnect();frame.removeEventListener('load',onLoad);frame.removeEventListener('error',onError);if(callback===reject)frame.remove();callback(value);};
          const onError=()=>finish(reject,new Error('view_load_failed'));
          const onLoad=()=>{
            try{
              const frameDoc=frame.contentDocument,expected=routeName(href),required=expected==='available-spaces.html'?'#cian-main':'#in-work-main';
              if(!frameDoc||!frameDoc.querySelector(required))throw new Error('view_contract_missing');
              const assess=()=>{
                const access=frameDoc.documentElement&&frameDoc.documentElement.getAttribute('data-slogi-access');
                if(access==='denied'){finish(reject,new Error('view_access_denied'));return;}
                if(!viewContractReady(frameDoc,required))return;
                frame.classList.remove('is-preloading');frame.hidden=true;
                finish(resolve,{frame,href,route:expected});
              };
              accessObserver=new win.MutationObserver(assess);
              accessObserver.observe(frameDoc.documentElement,{attributes:true,attributeFilter:['data-slogi-access']});
              assess();
            }catch(error){finish(reject,error);}
          };
          const timer=win.setTimeout(()=>finish(reject,new Error('view_load_timeout')),15000);
          frame.addEventListener('load',onLoad);frame.addEventListener('error',onError);frame.src=iframeUrl(href,initial);host.appendChild(frame);
        });
      }
      const cache=createBoundedViewCache({max:2,load:createFrame,dispose:view=>view&&view.frame&&view.frame.remove()});
      const loadView=href=>cache.get(routeName(href),cleanUrl(href,initial).href);

      function signalView(view,active){
        if(!view||!view.frame||!view.frame.contentWindow)return;
        try{const realm=view.frame.contentWindow;realm.dispatchEvent(new realm.CustomEvent('slogi:view-visibility',{detail:{active}}));if(active)realm.dispatchEvent(new realm.Event('resize'));}catch(_error){}
      }

      function setActive(href){
        const activeRoute=routeName(href);
        doc.querySelectorAll('.figma-shell-nav-link[href]').forEach(link=>{
          const active=routeName(new URL(link.getAttribute('href'),initial))===activeRoute;
          link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
        });
        const title=doc.querySelector('.figma-shell-mobile-title');if(title)title.textContent=activeRoute==='in-work.html'?'Помещения в работе':'Поиск помещений';
        doc.body.dataset.slogiRoute=activeRoute==='in-work.html'?'in-work':'search';
      }

      function showView(view,href){
        const previous=activeFrame;activeFrame=view;activeFrame.frame.hidden=false;activeFrame.frame.setAttribute('aria-hidden','false');
        if(previous&&previous!==activeFrame){signalView(previous,false);previous.frame.hidden=true;previous.frame.setAttribute('aria-hidden','true');}
        signalView(activeFrame,true);
        status.hidden=true;doc.body.classList.add('slogi-fast-navigation-active');
        try{
          const frameDoc=activeFrame.frame.contentDocument,title=frameDoc&&frameDoc.title;
          if(title)doc.title=title;
          const heading=frameDoc&&frameDoc.querySelector('main h1,main [role="heading"]');
          if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});}
          activeFrame.frame.contentWindow.dispatchEvent(new activeFrame.frame.contentWindow.CustomEvent('slogi:locations-updated',{detail:{source:'fast-navigation-activation'}}));
        }catch(_error){}
        setActive(href);
      }

      const coordinator=createNavigationCoordinator({
        initialUrl:initial,loadView,showView,setActive,
        pushState:href=>win.history.pushState(Object.assign({},win.history.state||{},{slogiFastNavigation:true}),'',href),
        hardNavigate:href=>win.location.replace(href),
        setBusy:busy=>{host.setAttribute('aria-busy',String(busy));if(busy){status.hidden=false;status.textContent='Загружаем раздел…';}}
      });

      doc.addEventListener('click',event=>{
        const anchor=event.target&&event.target.closest&&event.target.closest('a[href]'),target=clickTarget(event,anchor,win.location.href);
        if(!target)return;event.preventDefault();coordinator.navigate(target.href,'push');
      },true);
      win.addEventListener('popstate',()=>{if(isFastUrl(win.location.href,initial))coordinator.pop(win.location.href);else win.location.reload();});
      win.addEventListener('message',event=>{
        if(event.origin!==win.location.origin||!event.data||event.data.type!=='slogi-fast-navigation')return;
        if(!activeFrame||event.source!==activeFrame.frame.contentWindow||!isFastUrl(event.data.href,initial))return;
        coordinator.navigate(event.data.href,'push');
      });
      coordinator.navigate(initial,'replace').then(()=>{
        const other=routeName(initial)==='available-spaces.html'?'in-work.html':'available-spaces.html',href=new URL(other,initial).href;
        const preload=()=>loadView(href).then(view=>signalView(view,false)).catch(()=>{});
        if(typeof win.requestIdleCallback==='function')win.requestIdleCallback(preload,{timeout:2500});else win.setTimeout(preload,250);
      });
    };
    const startAfterGrant=()=>{
      if(doc.documentElement.getAttribute('data-slogi-access')==='granted'){start();return;}
      const observer=new win.MutationObserver(()=>{if(doc.documentElement.getAttribute('data-slogi-access')==='granted'){observer.disconnect();start();}});
      observer.observe(doc.documentElement,{attributes:true,attributeFilter:['data-slogi-access']});
    };
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',startAfterGrant,{once:true});else startAfterGrant();
  }

  function boot(win){
    if(win.__slogiFastNavigation76115)return;
    win.__slogiFastNavigation76115=true;
    const url=new URL(win.location.href),embedded=url.searchParams.get(VIEW_PARAM)==='1';
    if(embedded&&win.parent===win){url.searchParams.delete(VIEW_PARAM);win.location.replace(url.href);return;}
    if(embedded){bootEmbedded(win);return;}
    if(!routeName(url))return;
    bootHost(win);
  }

  return{VIEW_PARAM,FAST_ROUTES,routeName,cleanUrl,isFastUrl,iframeUrl,clickTarget,viewContractReady,createNavigationCoordinator,createBoundedViewCache,boot};
});
