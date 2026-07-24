(function(){
  'use strict';

  function normalizeProjectParams(){
    if(typeof MODEL==='undefined' || !MODEL) return;
    if(!Array.isArray(MODEL.params)) MODEL.params=[];
    const byAddress=new Map(MODEL.params.map(p=>[String(p.address),p]));
    const defs=[
      {address:'D6',label:'Количество кабинетов, шт.',value:1,type:'number',step:1},
      {address:'D7',label:'Количество санузлов, шт.',value:1,type:'number',step:1},
      {address:'D8',label:'Общая площадь помещения, м²',value:0,type:'number',step:0.5},
      {address:'D9',label:'Высота потолков, м',value:3,type:'height'},
      {address:'D10',label:'Демонтаж',value:0,type:'boolean'},
      {address:'D11',label:'Необходимость возведения стен',value:0,type:'boolean'}
    ];
    defs.forEach(def=>{
      const current=byAddress.get(def.address);
      if(current){Object.assign(current,def,{value:current.value ?? def.value});}
      else{MODEL.params.push(Object.assign({},def));}
      if(typeof STATE!=='undefined' && !Object.prototype.hasOwnProperty.call(STATE,def.address)) STATE[def.address]=def.value;
    });
    const order=new Map(defs.map((d,i)=>[d.address,i]));
    MODEL.params.sort((a,b)=>(order.has(a.address)?order.get(a.address):100)-(order.has(b.address)?order.get(b.address):100));
  }

  function enhancedRenderParams(){
    normalizeProjectParams();
    const wrap=document.getElementById('params-body');
    if(!wrap) return;
    wrap.innerHTML=MODEL.params.map((p,i)=>{
      const isBoolean=p.type==='boolean' || p.address==='D10' || p.address==='D11';
      const isHeight=p.type==='height' || p.address==='D9' || /высота\s+потол/i.test(String(p.label||''));
      if(isHeight){
        const value=Number(STATE[p.address])===6?6:3;
        STATE[p.address]=value;
        return `<div class="param-row">
          <div class="param-tile tile-${i%3}">${typeof TILE_ICON==='function'?TILE_ICON(p.label):'↕'}</div>
          <div class="param-info"><label>${p.label}</label>
            <select class="project-height-select" data-addr="${p.address}">
              <option value="3" ${value===3?'selected':''}>3 м</option>
              <option value="6" ${value===6?'selected':''}>6 м</option>
            </select>
          </div>
        </div>`;
      }
      if(isBoolean){
        const value=Number(STATE[p.address])?1:0;
        return `<div class="param-row">
          <div class="param-tile tile-${i%3}">${typeof TILE_ICON==='function'?TILE_ICON(p.label):'✓'}</div>
          <div class="param-info"><label>${p.label}</label>
            <select class="project-boolean-select" data-addr="${p.address}">
              <option value="0" ${value?'':'selected'}>Нет</option>
              <option value="1" ${value?'selected':''}>Да</option>
            </select>
          </div>
        </div>`;
      }
      const step=Number(p.step)||((Number.isInteger(Number(p.value)))?1:0.5);
      const value=Object.prototype.hasOwnProperty.call(STATE,p.address)?STATE[p.address]:p.value;
      return `<div class="param-row">
        <div class="param-tile tile-${i%3}">${typeof TILE_ICON==='function'?TILE_ICON(p.label):'•'}</div>
        <div class="param-info"><label>${p.label}</label>
          <div class="stepper">
            <button data-act="dec" data-addr="${p.address}" data-step="${step}" type="button">−</button>
            <input data-addr="${p.address}" type="number" step="${step}" min="0" value="${value ?? 0}">
            <button data-act="inc" data-addr="${p.address}" data-step="${step}" type="button">+</button>
          </div>
        </div>
      </div>`;
    }).join('');

    wrap.querySelectorAll('button[data-act]').forEach(btn=>btn.addEventListener('click',()=>{
      const addr=btn.dataset.addr, step=Number(btn.dataset.step)||1;
      let value=Number(STATE[addr])||0;
      value=btn.dataset.act==='inc'?value+step:Math.max(0,value-step);
      STATE[addr]=Math.round(value*100)/100;
      enhancedRenderParams();
      if(typeof renderMain==='function') renderMain();
    }));
    wrap.querySelectorAll('input[data-addr]').forEach(input=>input.addEventListener('input',()=>{
      const value=Number(input.value);
      STATE[input.dataset.addr]=Number.isFinite(value)?value:0;
      if(typeof renderMain==='function') renderMain();
    }));
    wrap.querySelectorAll('select[data-addr]').forEach(select=>select.addEventListener('change',()=>{
      STATE[select.dataset.addr]=Number(select.value)||0;
      if(typeof renderMain==='function') renderMain();
    }));
  }

  const style=document.createElement('style');
  style.textContent=`
    .project-boolean-select,.project-height-select{width:100%;border:1.5px solid var(--line);border-radius:9px;background:#fff;color:var(--ink);padding:10px 11px;font:inherit;font-size:13px;font-weight:750;outline:none}
    .project-boolean-select:focus,.project-height-select:focus{border-color:var(--teal);box-shadow:0 0 0 3px rgba(75,110,115,.12)}
    .site-header .top{justify-content:flex-start!important}.site-header .header-actions,.menu-toggle{display:none!important}
  `;
  document.head.appendChild(style);

  normalizeProjectParams();
  try{renderParams=enhancedRenderParams;}catch(_){window.renderParams=enhancedRenderParams;}
  enhancedRenderParams();
  if(typeof renderMain==='function') renderMain();
})();
