(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SlogiFastNavigation=api;
  if(root&&root.document)api.boot(root);
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const VIEW_PARAM='__slogi_view';
  const FALLBACK_KEY='slogi_fast_navigation_fallback_until_v1';
  const FAST_ROUTES=Object.freeze(['available-spaces.html','in-work.html','proposal.html']);

  function workspaceReady(win){
    try{return win.document.documentElement.getAttribute('data-slogi-access')==='granted'&&Boolean(win.SlogiCloud&&win.SlogiCloud.ready===true);}catch(_error){return false;}
  }

  function fallbackActive(win){
    try{
      const until=Number(win.sessionStorage.getItem(FALLBACK_KEY)||0);
      if(until>Date.now())return true;
      win.sessionStorage.removeItem(FALLBACK_KEY);
    }catch(_error){}
    return false;
  }

  function disableFastNavigation(win,duration=10*60*1000){
    try{win.sessionStorage.setItem(FALLBACK_KEY,String(Date.now()+Math.max(30000,Number(duration)||0)));}catch(_error){}
  }

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
    function disposeEntry(entry){
      if(!entry)return;
      if(entry.value){if(typeof options.dispose==='function')options.dispose(entry.value);return;}
      entry.promise.then(value=>options.dispose&&options.dispose(value)).catch(()=>{});
    }
    function remove(key){
      const entry=entries.get(key);if(!entry)return;
      entries.delete(key);disposeEntry(entry);
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
      const entry={key,href,used:++sequence,value:null,promise:null};
      entry.promise=Promise.resolve().then(()=>options.load(key,href)).then(value=>{
        entry.value=value;
        if(entries.get(key)===entry){disposeEntry(existing);return value;}
        if(typeof options.dispose==='function')options.dispose(value);
        return value;
      }).catch(error=>{
        if(entries.get(key)===entry){if(existing){existing.used=++sequence;entries.set(key,existing);}else entries.delete(key);}
        throw error;
      });
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

    const start=()=>{
      if(!doc.body||doc.body.classList.contains('slogi-fast-navigation-host'))return;
      doc.documentElement.setAttribute('data-slogi-fast-host','true');
      doc.body.classList.add('slogi-fast-navigation-host');
      const shell=doc.querySelector('.figma-shell-sidebar');
      if(!shell){disableFastNavigation(win);win.location.replace(initial);return;}

      const host=doc.createElement('div');host.className='slogi-fast-view-host';host.setAttribute('aria-live','polite');
      const status=doc.createElement('div');status.className='slogi-fast-view-status';status.setAttribute('role','status');
      const statusMessage=doc.createElement('span');statusMessage.textContent='Загружаем раздел…';
      const fallbackLink=doc.createElement('a');fallbackLink.hidden=true;fallbackLink.textContent='Открыть раздел обычным способом';
      status.appendChild(statusMessage);status.appendChild(fallbackLink);host.appendChild(status);doc.body.appendChild(host);
      let activeFrame=null,fallbackVisible=false;

      function createFrame(_route,href){
        return new Promise((resolve,reject)=>{
          const frame=doc.createElement('iframe');frame.className='slogi-fast-view-frame is-preloading';frame.title='Раздел платформы СЛОГИ';frame.setAttribute('aria-hidden','true');
          let settled=false,accessObserver=null;
          const finish=(callback,value)=>{if(settled)return;settled=true;win.clearTimeout(timer);if(accessObserver)accessObserver.disconnect();frame.removeEventListener('load',onLoad);frame.removeEventListener('error',onError);if(callback===reject)frame.remove();callback(value);};
          const onError=()=>finish(reject,new Error('view_load_failed'));
          const onLoad=()=>{
            try{
              const frameDoc=frame.contentDocument,expected=routeName(href),required=expected==='available-spaces.html'?'#cian-main':expected==='in-work.html'?'#in-work-main':'#proposal-main';
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
          const timer=win.setTimeout(()=>finish(reject,new Error('view_load_timeout')),8000);
          frame.addEventListener('load',onLoad);frame.addEventListener('error',onError);frame.src=iframeUrl(href,initial);host.appendChild(frame);
        });
      }
      const cache=createBoundedViewCache({max:2,load:createFrame,dispose:view=>view&&view.frame&&view.frame.remove()});
      const loadView=href=>{
        const cleanHref=cleanUrl(href,initial).href;
        if(cleanHref===initial)return Promise.resolve({native:true,href:cleanHref,route:routeName(cleanHref)});
        return cache.get(routeName(cleanHref),cleanHref);
      };

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
        const routeMeta=activeRoute==='in-work.html'?{title:'Помещения в работе',id:'in-work'}:activeRoute==='proposal.html'?{title:'КП',id:'kp'}:{title:'Поиск помещений',id:'search'};
        const title=doc.querySelector('.figma-shell-mobile-title');if(title)title.textContent=routeMeta.title;
        doc.body.dataset.slogiRoute=routeMeta.id;
      }

      function showView(view,href){
        const previous=activeFrame;
        if(view&&view.native){
          if(previous){signalView(previous,false);previous.frame.hidden=true;previous.frame.setAttribute('aria-hidden','true');}
          activeFrame=null;
          try{win.dispatchEvent(new win.CustomEvent('slogi:view-visibility',{detail:{active:true}}));win.dispatchEvent(new win.Event('resize'));}catch(_error){}
          fallbackVisible=false;fallbackLink.hidden=true;status.hidden=true;doc.body.classList.remove('slogi-fast-navigation-active');
          setActive(href);
          return;
        }
        activeFrame=view;activeFrame.frame.hidden=false;activeFrame.frame.setAttribute('aria-hidden','false');
        if(previous&&previous!==activeFrame){signalView(previous,false);previous.frame.hidden=true;previous.frame.setAttribute('aria-hidden','true');}
        try{win.dispatchEvent(new win.CustomEvent('slogi:view-visibility',{detail:{active:false}}));}catch(_error){}
        signalView(activeFrame,true);
        fallbackVisible=false;fallbackLink.hidden=true;status.hidden=true;doc.body.classList.add('slogi-fast-navigation-active');
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
        hardNavigate:href=>{
          disableFastNavigation(win);
          fallbackVisible=true;statusMessage.textContent='Раздел не удалось загрузить.';fallbackLink.href=href;fallbackLink.hidden=false;status.hidden=false;doc.body.classList.add('slogi-fast-navigation-active');
          try{win.location.replace(href);}catch(_error){}
        },
        setBusy:busy=>{
          host.setAttribute('aria-busy',String(busy));
          if(busy&&!activeFrame&&!fallbackVisible){statusMessage.textContent='Загружаем раздел…';fallbackLink.hidden=true;status.hidden=false;}
          if(!busy&&!fallbackVisible)status.hidden=true;
        }
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
      setActive(initial);
    };
    const startAfterGrant=()=>{
      let readinessTimer=null,scheduled=false;
      const observer=new win.MutationObserver(assess);
      const cleanup=()=>{observer.disconnect();if(readinessTimer)win.clearInterval(readinessTimer);win.removeEventListener('slogi:shared-workspace-ready',assess);};
      function launch(){if(scheduled)return;scheduled=true;cleanup();if(doc.readyState==='complete')start();else win.addEventListener('load',start,{once:true});}
      function assess(){if(workspaceReady(win))launch();}
      observer.observe(doc.documentElement,{attributes:true,attributeFilter:['data-slogi-access']});
      win.addEventListener('slogi:shared-workspace-ready',assess);
      readinessTimer=win.setInterval(assess,100);
      assess();
    };
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',startAfterGrant,{once:true});else startAfterGrant();
  }

  function boot(win){
    if(win.__slogiFastNavigation76115)return;
    win.__slogiFastNavigation76115=true;
    if(!(win.SLOGI_PHASE0_CONFIG&&win.SLOGI_PHASE0_CONFIG.fastNavigation&&win.SLOGI_PHASE0_CONFIG.fastNavigation.enabled===true))return;
    const url=new URL(win.location.href),embedded=url.searchParams.get(VIEW_PARAM)==='1';
    if(embedded&&win.parent===win){url.searchParams.delete(VIEW_PARAM);win.location.replace(url.href);return;}
    if(embedded){bootEmbedded(win);return;}
    if(!routeName(url))return;
    if(fallbackActive(win))return;
    bootHost(win);
  }

  return{VIEW_PARAM,FALLBACK_KEY,FAST_ROUTES,routeName,cleanUrl,isFastUrl,iframeUrl,clickTarget,viewContractReady,workspaceReady,fallbackActive,disableFastNavigation,createNavigationCoordinator,createBoundedViewCache,boot};
});
