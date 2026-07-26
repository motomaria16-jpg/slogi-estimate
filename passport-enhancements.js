(function(){
  'use strict';
  const DAY=86400000;
  let ganttRows=[];
  let paymentRows=[];
  let pendingGeo=null;
  let pendingCluster='';
  let geocodeTimer=null;
  let ymapsPromise=null;

  const el=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num=value=>Number(value)||0;
  const isoDate=date=>{
    const d=new Date(date); if(Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0,10);
  };
  const addDays=(date,days)=>{
    const d=new Date(date); d.setDate(d.getDate()+Number(days||0)); return isoDate(d);
  };
  const daysBetween=(a,b)=>Math.max(1,Math.round((new Date(b)-new Date(a))/DAY)+1);
  const money=value=>Math.round(num(value)).toLocaleString('ru-RU')+' ₽';
  const hasEstimate=()=>Boolean(currentRecord&&currentRecord.model&&Array.isArray(currentRecord.model.categories));
  const stateValue=key=>currentRecord&&currentRecord.state&&Object.prototype.hasOwnProperty.call(currentRecord.state,key)?currentRecord.state[key]:'';
  const yesNo=value=>Number(value)?'Да':'Нет';

  function injectLayout(){
    const style=document.createElement('style');
    style.textContent=`
      .site-header .top{justify-content:flex-start!important}.site-header .header-actions,.menu-toggle{display:none!important}
      .top-actions{margin:0 0 18px!important}.top-actions .main-action{min-height:48px}
      .object-address-card .card-body{display:grid;gap:12px}.cluster-box{padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--teal-pale)}
      .cluster-box span{display:block;color:var(--ink-soft);font-size:11px;font-weight:800;text-transform:uppercase}.cluster-box strong{display:block;margin-top:4px;color:var(--teal-deep);font-size:15px}
      .summary-meta.extended{grid-template-columns:1fr auto}.summary-meta .summary-value-muted{color:var(--ink-soft)}
      .planning-section{margin-top:26px}.planning-title{display:flex;align-items:flex-end;justify-content:space-between;gap:15px;margin-bottom:12px;flex-wrap:wrap}
      .planning-title h2{margin:0;color:var(--teal-deep);font-size:21px}.planning-title p{margin:4px 0 0;color:var(--ink-soft);font-size:12.5px}
      .planning-actions{display:flex;gap:8px;flex-wrap:wrap}.planning-btn{border:1.5px solid var(--teal);border-radius:9px;background:#fff;color:var(--teal-deep);padding:9px 12px;font:inherit;font-size:12px;font-weight:850;cursor:pointer}.planning-btn.primary{background:var(--teal);color:#fff}
      .planning-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:15px;overflow:hidden}.planning-empty{padding:34px 18px;text-align:center;color:var(--ink-soft);border:1px dashed var(--tan);border-radius:12px;background:#fffcfa}
      .edit-table-wrap{overflow:auto}.edit-table{width:100%;border-collapse:separate;border-spacing:0;min-width:850px}.edit-table th{background:var(--teal);color:#fff;padding:10px 9px;font-size:11px;text-align:left}.edit-table td{border-bottom:1px solid var(--line);padding:7px}.edit-table input{width:100%;min-width:90px;border:1px solid var(--line);border-radius:7px;padding:8px;font:inherit;font-size:12px;background:#fff}.edit-table input[type=number]{text-align:right}.row-delete{border:0;background:var(--danger-pale);color:var(--danger);border-radius:7px;width:32px;height:32px;cursor:pointer;font-weight:900}
      .gantt-chart{margin-top:15px;display:grid;gap:8px}.gantt-line{display:grid;grid-template-columns:minmax(170px,260px) 1fr;gap:10px;align-items:center}.gantt-label{font-size:12px;font-weight:800;color:var(--teal-deep);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gantt-track{height:27px;border-radius:8px;background:repeating-linear-gradient(90deg,#F3E9D7 0,#F3E9D7 1px,transparent 1px,transparent 8.333%);position:relative;border:1px solid var(--line);overflow:hidden}.gantt-bar{height:100%;min-width:8px;border-radius:7px;background:linear-gradient(90deg,var(--teal),var(--orange));display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:850;white-space:nowrap}
      .payment-summary{display:flex;justify-content:flex-end;gap:18px;flex-wrap:wrap;margin-top:12px;padding:12px;border-radius:10px;background:var(--teal-pale);font-size:12px}.payment-summary strong{color:var(--teal-deep)}
      .gantt-edit-table{min-width:1500px}.edit-table select{width:100%;min-width:120px;border:1px solid var(--line);border-radius:7px;padding:8px;font:inherit;font-size:12px;background:#fff}.gantt-label{display:grid;gap:2px}.gantt-label small{font-size:9.5px;color:var(--ink-soft);font-weight:650}.gantt-track{height:34px;overflow:visible}.gantt-bar{position:absolute;top:4px;height:12px;background:var(--teal);font-size:8px}.gantt-actual{position:absolute;bottom:4px;height:9px;border-radius:5px;background:var(--orange);min-width:4px}.gantt-legend{display:flex;gap:15px;align-items:center;flex-wrap:wrap;margin-bottom:12px;color:var(--ink-soft);font-size:10.5px}.gantt-legend span{display:flex;align-items:center;gap:6px}.gantt-legend i{width:22px;height:8px;border-radius:5px;background:var(--teal)}.gantt-legend i.actual{background:var(--orange)}.gantt-variance{font-weight:800;color:var(--teal-deep);white-space:nowrap}.gantt-variance.late{color:var(--danger)}
      @media(max-width:760px){.gantt-line{grid-template-columns:1fr}.gantt-track{height:24px}.planning-actions{width:100%}.planning-btn{flex:1}.summary-meta.extended{grid-template-columns:1fr}.summary-meta.extended strong{text-align:left}}
    `;
    document.head.appendChild(style);

    const params=el('params-grid');
    if(params){
      params.remove();
      const card=params.closest('.card');
      if(card) card.classList.add('object-address-card');
    }
    const addressBody=el('location-address')&&el('location-address').closest('.card-body');
    if(addressBody&&!el('cluster-name-box')){
      addressBody.insertAdjacentHTML('beforeend','<div class="cluster-box" id="cluster-name-box"><span>Территориальный кластер</span><strong id="cluster-name-value">Определяется после ввода адреса</strong></div>');
    }

    const actions=document.querySelector('.bottom-actions');
    const intro=document.querySelector('.page-intro');
    if(actions&&intro){actions.classList.add('top-actions');intro.insertAdjacentElement('afterend',actions);}

    const estimateCard=[...document.querySelectorAll('.file-card')].find(card=>card.dataset.type==='estimate');
    if(estimateCard){
      const title=estimateCard.querySelector('h3'); if(title) title.textContent='Смета на ремонт объекта';
      const copy=estimateCard.querySelector('.file-copy p'); if(copy) copy.textContent='Итоговая смета ремонта с редактируемыми позициями и стоимостью.';
    }

    const meta=document.querySelector('.summary-meta');
    if(meta&&!el('summary-area')){
      meta.classList.add('extended');
      meta.insertAdjacentHTML('beforeend',`
        <span>Общая площадь помещения</span><strong id="summary-area">—</strong>
        <span>Количество кабинетов</span><strong id="summary-cabinets">—</strong>
        <span>Количество сан. узлов</span><strong id="summary-toilets">—</strong>
        <span>Высота потолков</span><strong id="summary-ceiling">—</strong>
        <span>Демонтаж</span><strong id="summary-demolition">—</strong>
        <span>Возведение стен</span><strong id="summary-walls">—</strong>
      `);
    }

    const status=el('page-status');
    if(status&&!el('gantt-section')){
      status.insertAdjacentHTML('beforebegin',`
        <section class="planning-section" id="gantt-section">
          <div class="planning-title"><div><h2>Диаграмма Ганта</h2><p>Сроки строительства формируются после создания сметы и могут редактироваться.</p></div><div class="planning-actions"><button class="planning-btn" id="add-gantt-row" type="button">+ Добавить этап</button><button class="planning-btn primary" id="download-gantt" type="button">Скачать Excel</button></div></div>
          <div class="planning-card" id="gantt-content"></div>
        </section>
        <section class="planning-section" id="payments-section">
          <div class="planning-title"><div><h2>График платежей</h2><p>Плановые платежи и фактические оплаты по объекту.</p></div><div class="planning-actions"><button class="planning-btn" id="add-payment-row" type="button">+ Добавить платёж</button><button class="planning-btn primary" id="download-payments" type="button">Скачать Excel</button></div></div>
          <div class="planning-card" id="payments-content"></div>
        </section>
      `);
    }
  }

  function defaultGantt(){
    const start=isoDate(new Date());
    const demolition=Number(stateValue('D10'));
    const walls=Number(stateValue('D11'));
    const stages=[['Покупка заказных позиций',10],['Подготовка объекта',3]];
    if(demolition) stages.push(['Демонтажные работы',5]);
    if(walls) stages.push(['Возведение стен и перегородок',7]);
    stages.push(['Инженерные и черновые работы',8],['Чистовая отделка',12],['Монтаж мебели и оборудования',7],['Финальная приёмка объекта',2]);
    let cursor=start;
    return stages.map((stage,index)=>{
      const row={id:'g'+Date.now()+index,task:stage[0],start:cursor,end:addDays(cursor,stage[1]-1),actualStart:'',actualEnd:'',ownerId:'member-maria',stageStatus:'Не начат',dependency:index?('g'+Date.now()+(index-1)):''};
      cursor=addDays(row.end,1); return row;
    });
  }

  function defaultPayments(){
    const total=num(currentRecord&&currentRecord.total)||num(typeof currentTotal==='function'?currentTotal():0);
    const percents=[30,30,25,15];
    const names=['Аванс и запуск заказных позиций','Оплата после закупки заказных позиций','Оплата после завершения черновых работ','Финальный расчёт после приёмки'];
    const dates=[ganttRows[0]?.start,ganttRows[0]?.end,ganttRows[Math.max(1,Math.floor(ganttRows.length/2))]?.end,ganttRows[ganttRows.length-1]?.end];
    let allocated=0;
    return percents.map((percent,index)=>{
      const planned=index===percents.length-1?Math.max(0,total-allocated):Math.round(total*percent/100);
      allocated+=planned;
      return {id:'p'+Date.now()+index,name:names[index],planDate:dates[index]||isoDate(new Date()),planned,actualDate:'',actual:0};
    });
  }

  function persistExtras(){
    if(!currentLocationId) return;
    const items=readLocations();
    const index=items.findIndex(item=>item&&item.id===currentLocationId);
    if(index<0) return;
    items[index]=Object.assign({},items[index],{
      gantt:ganttRows,
      paymentSchedule:paymentRows,
      geo:pendingGeo||items[index].geo||null,
      clusterName:pendingCluster||items[index].clusterName||'',
      updatedAt:items[index].updatedAt||new Date().toISOString()
    });
    writeLocations(items);
    currentRecord=clonePlain(items[index]);
  }

  function ensurePlanning(){
    if(!hasEstimate()){ganttRows=[];paymentRows=[];return;}
    ganttRows=Array.isArray(currentRecord.gantt)&&currentRecord.gantt.length?clonePlain(currentRecord.gantt):defaultGantt();
    paymentRows=Array.isArray(currentRecord.paymentSchedule)&&currentRecord.paymentSchedule.length?clonePlain(currentRecord.paymentSchedule):defaultPayments();
    persistExtras();
  }

  function renderSummary(){
    const ready=hasEstimate();
    const set=(id,value)=>{const node=el(id);if(node) node.textContent=ready?value:'—';};
    set('summary-area',stateValue('D8')!==''?`${num(stateValue('D8')).toLocaleString('ru-RU')} м²`:'—');
    set('summary-cabinets',stateValue('D6')!==''?String(num(stateValue('D6'))):'—');
    set('summary-toilets',stateValue('D7')!==''?String(num(stateValue('D7'))):'—');
    set('summary-ceiling',stateValue('D9')!==''?`${num(stateValue('D9')).toLocaleString('ru-RU')} м`:'—');
    set('summary-demolition',yesNo(stateValue('D10')));
    set('summary-walls',yesNo(stateValue('D11')));
    const clusterNode=el('cluster-name-value');
    if(clusterNode) clusterNode.textContent=pendingCluster||currentRecord&&currentRecord.clusterName||'Кластер пока не определён';
  }

  function ganttMembers(){return window.SlogiPro?window.SlogiPro.read().members:[];}
  function ganttOwnerName(id){const m=ganttMembers().find(x=>x.id===id);return m?m.name:'Не назначен';}
  function scheduleVariance(row){if(!row.actualEnd)return '—';const value=Math.round((new Date(row.actualEnd)-new Date(row.end))/DAY);return value===0?'0 дн.':(value>0?'+':'')+value+' дн.';}

  function renderGantt(){
    const root=el('gantt-content'); if(!root) return;
    if(!hasEstimate()){
      root.innerHTML='<div class="planning-empty">Сначала сформируйте и сохраните смету на ремонт объекта.</div>';
      el('add-gantt-row').disabled=true; el('download-gantt').disabled=true; return;
    }
    el('add-gantt-row').disabled=false; el('download-gantt').disabled=false;
    if(!ganttRows.length){root.innerHTML='<div class="planning-empty">Этапов пока нет. Нажмите «Добавить этап».</div>';return;}
    ganttRows=ganttRows.map((r,i)=>Object.assign({actualStart:'',actualEnd:'',ownerId:'member-maria',stageStatus:'Не начат',dependency:i?ganttRows[i-1]?.id||'':''},r));
    const starts=ganttRows.flatMap(r=>[r.start,r.actualStart]).filter(Boolean).map(x=>new Date(x).getTime()).filter(Number.isFinite);
    const ends=ganttRows.flatMap(r=>[r.end,r.actualEnd]).filter(Boolean).map(x=>new Date(x).getTime()).filter(Number.isFinite);
    const min=Math.min(...starts),max=Math.max(...ends),span=Math.max(DAY,max-min+DAY);
    const owners=ganttMembers();
    const rows=ganttRows.map((row,index)=>`<tr data-index="${index}"><td><input data-field="task" value="${esc(row.task)}"></td><td><select data-field="ownerId">${owners.map(m=>`<option value="${esc(m.id)}" ${m.id===row.ownerId?'selected':''}>${esc(m.name)}</option>`).join('')}</select></td><td><input data-field="start" type="date" value="${esc(row.start)}"></td><td><input data-field="end" type="date" value="${esc(row.end)}"></td><td><input data-field="actualStart" type="date" value="${esc(row.actualStart)}"></td><td><input data-field="actualEnd" type="date" value="${esc(row.actualEnd)}"></td><td><select data-field="stageStatus">${['Не начат','В работе','Приостановлен','Завершён'].map(s=>`<option ${s===row.stageStatus?'selected':''}>${s}</option>`).join('')}</select></td><td><select data-field="dependency"><option value="">Нет</option>${ganttRows.filter(x=>x.id!==row.id).map(x=>`<option value="${esc(x.id)}" ${x.id===row.dependency?'selected':''}>${esc(x.task)}</option>`).join('')}</select></td><td class="gantt-variance ${String(scheduleVariance(row)).startsWith('+')?'late':''}">${scheduleVariance(row)}</td><td><button class="row-delete" data-delete-gantt="${index}" type="button">×</button></td></tr>`).join('');
    const chart=ganttRows.map(row=>{const left=Math.max(0,((new Date(row.start)-min)/span)*100),width=Math.max(1,((new Date(row.end)-new Date(row.start)+DAY)/span)*100);let actual='';if(row.actualStart){const aEnd=row.actualEnd||isoDate(new Date()),aLeft=Math.max(0,((new Date(row.actualStart)-min)/span)*100),aWidth=Math.max(1,((new Date(aEnd)-new Date(row.actualStart)+DAY)/span)*100);actual=`<div class="gantt-actual" style="margin-left:${aLeft}%;width:${Math.min(aWidth,100-aLeft)}%"></div>`}return`<div class="gantt-line"><div class="gantt-label" title="${esc(row.task)}"><strong>${esc(row.task)}</strong><small>${esc(ganttOwnerName(row.ownerId))} · ${esc(row.stageStatus)}</small></div><div class="gantt-track"><div class="gantt-bar" style="margin-left:${left}%;width:${Math.min(width,100-left)}%">План</div>${actual}</div></div>`}).join('');
    root.innerHTML=`<div class="gantt-legend"><span><i class="plan"></i>План</span><span><i class="actual"></i>Факт</span><span>Отклонение считается по фактической дате завершения</span></div><div class="edit-table-wrap"><table class="edit-table gantt-edit-table"><thead><tr><th>Этап</th><th>Ответственный</th><th>План: начало</th><th>План: окончание</th><th>Факт: начало</th><th>Факт: окончание</th><th>Статус</th><th>Предшественник</th><th>Отклонение</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><div class="gantt-chart">${chart}</div>`;
  }

  function renderPayments(){
    const root=el('payments-content'); if(!root) return;
    if(!hasEstimate()){
      root.innerHTML='<div class="planning-empty">График появится после формирования сметы.</div>';
      el('add-payment-row').disabled=true; el('download-payments').disabled=true; return;
    }
    el('add-payment-row').disabled=false; el('download-payments').disabled=false;
    const rows=paymentRows.map((row,index)=>`<tr data-index="${index}"><td><input data-field="name" value="${esc(row.name)}"></td><td><input data-field="planDate" type="date" value="${esc(row.planDate)}"></td><td><input data-field="planned" type="number" min="0" step="1000" value="${num(row.planned)}"></td><td><input data-field="actualDate" type="date" value="${esc(row.actualDate)}"></td><td><input data-field="actual" type="number" min="0" step="1000" value="${num(row.actual)}"></td><td><button class="row-delete" data-delete-payment="${index}" type="button">×</button></td></tr>`).join('');
    const planned=paymentRows.reduce((sum,row)=>sum+num(row.planned),0);
    const actual=paymentRows.reduce((sum,row)=>sum+num(row.actual),0);
    const balance=Math.max(0,planned-actual);
    const completed=paymentRows.filter(row=>num(row.actual)>0).length;
    const progress=planned>0?Math.max(0,Math.min(100,actual/planned*100)):0;
    root.innerHTML=`<div class="edit-table-wrap"><table class="edit-table"><thead><tr><th>Этап / назначение платежа</th><th>Плановая дата</th><th>План, ₽</th><th>Дата оплаты</th><th>Факт, ₽</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><div class="payment-summary"><div class="payment-summary-card payment-info"><span class="payment-summary-label">Информация</span><strong>${completed} из ${paymentRows.length} платежей</strong><small>Оплачено: ${money(actual)}</small><div class="payment-progress" aria-label="Оплачено ${Math.round(progress)} процентов"><span style="width:${progress}%"></span></div></div><div class="payment-summary-card payment-plan"><span class="payment-summary-label">План</span><strong>${money(planned)}</strong><small>Общая сумма по графику</small></div><div class="payment-summary-card payment-balance"><span class="payment-summary-label">Остаток</span><strong>${money(balance)}</strong><small>${balance>0?'Осталось оплатить':'Все платежи закрыты'}</small></div></div>`;
  }

  function workbookBlob(sheetName,headers,rows,widths){
    const xml=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const col=n=>{let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;};
    const cell=(ref,value,style=0)=>{
      if(typeof value==='number'&&Number.isFinite(value)) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
      return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    };
    const all=[headers,...rows];
    const sheetRows=all.map((row,ri)=>`<row r="${ri+1}">${row.map((value,ci)=>cell(col(ci+1)+(ri+1),value,ri===0?1:0)).join('')}</row>`).join('');
    const cols=(widths||headers.map(()=>18)).map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('');
    const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${col(headers.length)}${all.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:${col(headers.length)}${all.length}"/></worksheet>`;
    const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF37545A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFEAD9CE"/></left><right style="thin"><color rgb="FFEAD9CE"/></right><top style="thin"><color rgb="FFEAD9CE"/></top><bottom style="thin"><color rgb="FFEAD9CE"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Обычный" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const files=[
      {name:'[Content_Types].xml',blob:new Blob([`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],{type:'application/xml'})},
      {name:'_rels/.rels',blob:new Blob([`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],{type:'application/xml'})},
      {name:'xl/workbook.xml',blob:new Blob([`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],{type:'application/xml'})},
      {name:'xl/_rels/workbook.xml.rels',blob:new Blob([`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],{type:'application/xml'})},
      {name:'xl/worksheets/sheet1.xml',blob:new Blob([sheet],{type:'application/xml'})},{name:'xl/styles.xml',blob:new Blob([styles],{type:'application/xml'})}
    ];
    return createZip(files).then(zip=>new Blob([zip],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  }

  function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}

  function clusterFeatures(){const source=window.SLOGI_CLUSTERS_GEOJSON;return source&&Array.isArray(source.features)?source.features:[];}
  function pointInRing(lon,lat,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=Number(ring[i][0]),yi=Number(ring[i][1]),xj=Number(ring[j][0]),yj=Number(ring[j][1]);const hit=((yi>lat)!==(yj>lat))&&(lon<(xj-xi)*(lat-yi)/((yj-yi)||1e-15)+xi);if(hit)inside=!inside;}return inside;}
  function pointInPolygon(lon,lat,polygon){if(!polygon.length||!pointInRing(lon,lat,polygon[0]))return false;for(let i=1;i<polygon.length;i++)if(pointInRing(lon,lat,polygon[i]))return false;return true;}
  function clusterFor(lat,lon){for(const feature of clusterFeatures()){const g=feature.geometry;if(!g)continue;if(g.type==='Polygon'&&pointInPolygon(lon,lat,g.coordinates))return feature.properties?.name||'';if(g.type==='MultiPolygon')for(const poly of g.coordinates)if(pointInPolygon(lon,lat,poly))return feature.properties?.name||'';}return '';}
  function loadYmaps(){
    if(window.ymaps)return Promise.resolve(window.ymaps);
    if(ymapsPromise)return ymapsPromise;
    const key=String(window.SLOGI_CONFIG?.yandexMapsApiKey||'').trim();
    if(!key)return Promise.reject(new Error('NO_KEY'));
    ymapsPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://api-maps.yandex.ru/2.1/?apikey='+encodeURIComponent(key)+'&lang=ru_RU';script.async=true;script.onload=()=>window.ymaps?window.ymaps.ready(()=>resolve(window.ymaps)):reject(new Error('API'));script.onerror=()=>reject(new Error('NETWORK'));document.head.appendChild(script);});
    return ymapsPromise;
  }
  function addressVariants(address){const clean=String(address||'').trim();if(!clean)return[];const values=[clean];if(!/москв|moscow/i.test(clean))values.push('Москва, '+clean);return [...new Set(values)];}
  async function geocodeYandex(address){await loadYmaps();const result=await window.ymaps.geocode(address,{results:1,boundedBy:[[54.6,36.0],[56.8,39.5]],strictBounds:false});const first=result.geoObjects.get(0);return first?first.geometry.getCoordinates():null;}
  async function geocodeNominatim(address){const url='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ru&accept-language=ru&q='+encodeURIComponent(address);const response=await fetch(url,{headers:{'Accept':'application/json','Accept-Language':'ru'}});if(!response.ok)throw new Error('NOMINATIM_'+response.status);const data=await response.json();return data&&data[0]?[Number(data[0].lat),Number(data[0].lon)]:null;}
  async function resolveAddress(address){let lastError=null;for(const variant of addressVariants(address)){try{const coords=await geocodeYandex(variant);if(coords)return{coords,provider:'yandex'};}catch(err){lastError=err;break;}}for(const variant of addressVariants(address)){try{const coords=await geocodeNominatim(variant);if(coords)return{coords,provider:'nominatim'};}catch(err){lastError=err;}}if(lastError)console.warn('Не удалось определить координаты:',lastError);return null;}
  async function detectCluster(){
    const address=String(el('location-address')?.value||'').trim();
    const node=el('cluster-name-value');
    if(!address){pendingGeo=null;pendingCluster='';if(node)node.textContent='Введите адрес помещения';return;}
    if(node)node.textContent='Определяю кластер…';
    try{
      const resolved=await resolveAddress(address);
      if(!resolved)throw new Error('NOT_FOUND');
      const coords=resolved.coords;
      pendingGeo={lat:Number(coords[0]),lng:Number(coords[1]),provider:resolved.provider,address,updatedAt:new Date().toISOString()};
      pendingCluster=clusterFor(pendingGeo.lat,pendingGeo.lng);
      if(node)node.textContent=pendingCluster||'Адрес находится вне заданных кластеров';
      persistExtras();
    }catch(err){
      console.warn('Определение кластера:',err);
      if(node)node.textContent=location.protocol==='file:'?'Откройте сайт через START_SITE.bat для определения кластера':'Адрес не найден. Уточните город, улицу и номер дома';
    }
  }

  function bindEvents(){
    el('gantt-content')?.addEventListener('change',event=>{const input=event.target.closest('[data-field]');if(!input)return;const row=input.closest('tr');const index=Number(row.dataset.index);const field=input.dataset.field;ganttRows[index][field]=input.value;if((field==='start'||field==='end')&&ganttRows[index].dependency){const dep=ganttRows.find(x=>x.id===ganttRows[index].dependency);if(dep&&new Date(ganttRows[index].start)<=new Date(dep.end))ganttRows[index].start=addDays(dep.end,1);}persistExtras();renderGantt();});
    el('gantt-content')?.addEventListener('click',event=>{const btn=event.target.closest('[data-delete-gantt]');if(!btn)return;ganttRows.splice(Number(btn.dataset.deleteGantt),1);persistExtras();renderGantt();});
    el('payments-content')?.addEventListener('change',event=>{const input=event.target.closest('input[data-field]');if(!input)return;const row=input.closest('tr');const index=Number(row.dataset.index);const field=input.dataset.field;paymentRows[index][field]=(field==='planned'||field==='actual')?num(input.value):input.value;persistExtras();renderPayments();});
    el('payments-content')?.addEventListener('click',event=>{const btn=event.target.closest('[data-delete-payment]');if(!btn)return;paymentRows.splice(Number(btn.dataset.deletePayment),1);persistExtras();renderPayments();});
    el('add-gantt-row')?.addEventListener('click',()=>{const previous=ganttRows[ganttRows.length-1],start=previous?addDays(previous.end,1):isoDate(new Date());ganttRows.push({id:'g'+Date.now(),task:'Новый этап',start,end:addDays(start,4),actualStart:'',actualEnd:'',ownerId:'member-maria',stageStatus:'Не начат',dependency:previous?previous.id:''});persistExtras();renderGantt();});
    el('add-payment-row')?.addEventListener('click',()=>{paymentRows.push({id:'p'+Date.now(),name:'Новый платёж',planDate:isoDate(new Date()),planned:0,actualDate:'',actual:0});persistExtras();renderPayments();});
    el('download-gantt')?.addEventListener('click',async()=>{const rows=ganttRows.map((r,i)=>[i+1,r.task,ganttOwnerName(r.ownerId),r.start,r.end,r.actualStart||'',r.actualEnd||'',r.stageStatus,ganttRows.find(x=>x.id===r.dependency)?.task||'',scheduleVariance(r)]);downloadBlob(await workbookBlob('Диаграмма Ганта',['№','Этап','Ответственный','План: начало','План: окончание','Факт: начало','Факт: окончание','Статус','Предшественник','Отклонение'],rows,[6,38,24,15,15,15,15,18,30,14]),'Диаграмма Ганта '+(el('location-address')?.value||'объект')+'.xlsx');});
    el('download-payments')?.addEventListener('click',async()=>{const rows=paymentRows.map((r,i)=>[i+1,r.name,r.planDate,num(r.planned),r.actualDate,num(r.actual),num(r.planned)-num(r.actual)]);downloadBlob(await workbookBlob('График платежей',['№','Этап / назначение','Плановая дата','План, ₽','Дата оплаты','Факт, ₽','Остаток, ₽'],rows,[6,42,16,16,16,16,16]),'График платежей '+(el('location-address')?.value||'объект')+'.xlsx');});
    el('location-address')?.addEventListener('input',()=>{pendingGeo=null;pendingCluster='';const node=el('cluster-name-value');if(node)node.textContent='Ожидаю полный адрес…';clearTimeout(geocodeTimer);geocodeTimer=setTimeout(detectCluster,900);});
  }

  injectLayout();

  try{
    collectState=function(){
      if(currentRecord&&currentRecord.state&&typeof currentRecord.state==='object') return clonePlain(currentRecord.state);
      return {};
    };
  }catch(_){ }

  if(typeof refreshSummary==='function'){
    const baseRefresh=refreshSummary;
    refreshSummary=function(){baseRefresh();renderSummary();};
  }
  if(typeof savePassport==='function'){
    const baseSave=savePassport;
    savePassport=async function(options={}){
      persistExtras();
      const id=await baseSave(options);
      if(id){persistExtras();await detectCluster();renderSummary();}
      return id;
    };
  }

  if(currentRecord?.geo&&(!currentRecord.geo.address||String(currentRecord.geo.address).trim()===String(currentRecord.address||'').trim())){pendingGeo=currentRecord.geo;pendingCluster=currentRecord.clusterName||clusterFor(num(currentRecord.geo.lat),num(currentRecord.geo.lng));}
  ensurePlanning();
  renderSummary();
  renderGantt();
  renderPayments();
  bindEvents();
  if(el('location-address')?.value&&!pendingCluster) detectCluster();
})();
