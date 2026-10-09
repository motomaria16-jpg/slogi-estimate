(function proposalDocumentModule(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SlogiProposalDocument=api;
})(typeof window!=='undefined'?window:globalThis,function proposalDocumentFactory(){
  'use strict';

  const esc=value=>String(value==null?'':value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const money=value=>Number(value).toLocaleString('ru-RU',{maximumFractionDigits:2});
  function projectParam(project,pattern){
    const params=project&&project.estimateModel&&project.estimateModel.params||project&&project.model&&project.model.params||[];
    const state=project&&project.estimateState||project&&project.state||{};
    const item=params.find(value=>pattern.test(String(value.label||'')));
    return item?(state[item.address]??item.value??''):'';
  }
  function buildParagraphs(project,terms,base){
    const paragraphs=(Array.isArray(base)?base:[]).slice(),today=new Date().toLocaleDateString('ru-RU'),area=project.area||projectParam(project,/площад/i)||'—';
    while(paragraphs.length<55)paragraphs.push('');
    const contact=project.phase0&&project.phase0.spaceCard&&project.phase0.spaceCard.work&&project.phase0.spaceCard.work.landlordContact||{};
    paragraphs[2]=`Дата: ${today}     Кому: ${contact.name||'[ФИО / название компании арендодателя]'}     Объект: ${project.address||'[адрес помещения]'}`;
    paragraphs[9]=project.address||'[адрес помещения]';
    paragraphs[11]=`${area} м²`;
    paragraphs[13]=[project.floor,project.separateEntrance?'отдельный вход — да':''].filter(Boolean).join(', ')||'[этаж, отдельный вход — да/нет]';
    paragraphs[19]=`${money(terms.baseRentRate)} ₽ / м² / мес.`;
    paragraphs[21]=`${money(terms.discountRentRate)} ₽ / м² / мес. в течение ${terms.discountPeriodDays} дн.`;
    paragraphs[23]=`${terms.rentFreeDays} дн. на время ремонта`;
    paragraphs[24]=`Предлагаемые условия: базовая ставка ${money(terms.baseRentRate)} ₽/м²/мес.; льготная ставка ${money(terms.discountRentRate)} ₽/м²/мес. действует ${terms.discountPeriodDays} дн.; арендные каникулы — ${terms.rentFreeDays} дн. Окончательные условия фиксируются в договоре аренды.`;
    const gantt=Array.isArray(project.gantt)?project.gantt:[];
    [32,35,38,41].forEach((index,offset)=>{const row=gantt[offset],days=row&&row.start&&row.end?Math.max(1,Math.ceil((new Date(row.end)-new Date(row.start))/86400000)+1):0;paragraphs[index]=(days?Math.max(1,Math.ceil(days/7)):'—')+' нед.';});
    const totalDays=gantt.reduce((sum,row)=>row.start&&row.end?sum+Math.max(1,Math.ceil((new Date(row.end)-new Date(row.start))/86400000)+1):sum,0);
    if(paragraphs[42])paragraphs[42]=paragraphs[42].replace('[ХХ]',String(totalDays?Math.max(1,Math.ceil(totalDays/30)):'—'));
    paragraphs[52]=`${project.signatory||'[Имя Фамилия]'}, ${project.signatoryPosition||'[должность]'}`;
    paragraphs[54]=[project.phone||'[телефон]',project.email||'[email]',project.site||'[сайт]'].join('   ·   ');
    return paragraphs;
  }
  function span(paragraphs,index,cls=''){return`<span${cls?` class="${cls}"`:''}>${esc(paragraphs[index]||'')}</span>`;}
  function header(){const logo=typeof window!=='undefined'&&window.SLOGI_PROPOSAL_LOGO||'proposal-logo.png';return`<div class="kp-letterhead"><img class="kp-logo" src="${logo}" alt="СЛОГИ"><div class="kp-brand-subtitle">ШКОЛА РАЗВИТИЯ РЕЧИ</div></div>`;}
  function footer(){return'<div class="kp-footer">МАЛЕНЬКИЕ ШАГИ К БОЛЬШОЙ РЕЧИ</div>';}
  function pagesHtml(paragraphs,terms){
    const termBoxes=[['Базовая арендная ставка',`${money(terms.baseRentRate)} ₽ / м² / мес.`],['Льготная ставка',`${money(terms.discountRentRate)} ₽ / м² / мес.`],['Льготный период',`${terms.discountPeriodDays} дней`],['Арендные каникулы',`${terms.rentFreeDays} дней`]];
    return`<section class="kp-page">${header()}<h1 class="kp-title">${span(paragraphs,0)}</h1><div class="kp-subtitle">${span(paragraphs,1)}</div><div class="kp-meta">${span(paragraphs,2)}</div><section class="kp-section"><div class="kp-heading"><span class="kp-number">01</span><h2>О нас</h2></div><p>${span(paragraphs,4)}</p><p>${span(paragraphs,5)}</p><p>${span(paragraphs,6)}</p></section><section class="kp-section"><div class="kp-heading"><span class="kp-number">02</span><h2>Интересующий объект</h2></div><div class="object-grid"><div class="kp-box"><div class="kp-label">${span(paragraphs,8)}</div><div class="kp-value">${span(paragraphs,9)}</div></div><div class="kp-box"><div class="kp-label">${span(paragraphs,10)}</div><div class="kp-value">${span(paragraphs,11)}</div></div><div class="kp-box"><div class="kp-label">${span(paragraphs,12)}</div><div class="kp-value">${span(paragraphs,13)}</div></div><div class="kp-box"><div class="kp-label">${span(paragraphs,14)}</div><div class="kp-value">${span(paragraphs,15)}</div></div></div></section><section class="kp-section"><div class="kp-heading"><span class="kp-number">03</span><h2>Коммерческие условия</h2></div><p>${span(paragraphs,17)}</p><div class="terms-grid terms-grid-four">${termBoxes.map(item=>`<div class="kp-box"><div class="kp-label">${esc(item[0])}</div><div class="kp-value">${esc(item[1])}</div></div>`).join('')}</div><p>${span(paragraphs,24)}</p></section>${footer()}</section><section class="kp-page">${header()}<section class="kp-section"><div class="kp-heading"><span class="kp-number">04</span><h2>Сроки ремонтных работ</h2></div><p>${span(paragraphs,26)}</p><table class="schedule-table"><thead><tr><th>${span(paragraphs,27)}</th><th>${span(paragraphs,28)}</th><th>${span(paragraphs,29)}</th></tr></thead><tbody>${[30,33,36,39].map(index=>`<tr><td>${span(paragraphs,index)}</td><td>${span(paragraphs,index+1)}</td><td>${span(paragraphs,index+2)}</td></tr>`).join('')}</tbody></table><p>${span(paragraphs,42)}</p></section><section class="kp-section"><div class="kp-heading"><span class="kp-number">05</span><h2>Почему сотрудничество с нами выгодно</h2></div><ul class="benefits">${[44,45,46,47,48].map(index=>`<li>${span(paragraphs,index)}</li>`).join('')}</ul></section><section class="kp-section"><div class="kp-heading"><span class="kp-number">06</span><h2>Следующий шаг</h2></div><p>${span(paragraphs,50)}</p><div class="signature"><p>${span(paragraphs,51)}<br>${span(paragraphs,52)}<br>${span(paragraphs,53)}<br>${span(paragraphs,54)}</p></div></section>${footer()}</section>`;
  }
  function xmlEsc(value){return String(value==null?'':value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&apos;','"':'&quot;'}[char]));}
  function fillTemplateXml(xml,paragraphs){
    const values=Array.isArray(paragraphs)?paragraphs:[],slotCount=55;
    if(values.length<slotCount)throw new Error('Шаблон КП получил неполный набор данных.');
    let output=String(xml||'');
    for(let index=0;index<slotCount;index++){
      const marker=`[[SLOGI_P_${index}]]`,count=output.split(marker).length-1;
      if(count!==1)throw new Error(`Маркер ${marker} должен встречаться в шаблоне ровно один раз.`);
      output=output.replace(marker,xmlEsc(values[index]));
    }
    if(/\[\[SLOGI_P_\d+\]\]/.test(output))throw new Error('В документе остались незаполненные поля шаблона.');
    return output;
  }
  function fillTemplateEntries(entries,paragraphs){
    const decoder=new TextDecoder('utf-8'),encoder=new TextEncoder();let documentFound=false;
    const result=(Array.isArray(entries)?entries:[]).map(entry=>{
      const copy={name:entry.name,data:entry.data};
      if(entry.name!=='word/document.xml')return copy;
      documentFound=true;
      copy.data=encoder.encode(fillTemplateXml(decoder.decode(entry.data),paragraphs));
      return copy;
    });
    if(!documentFound)throw new Error('В шаблоне КП отсутствует word/document.xml.');
    return result;
  }
  async function docxBlob(templateBuffer,paragraphs,zipApi){
    if(!zipApi||typeof zipApi.unzip!=='function'||typeof zipApi.zip!=='function')throw new Error('Модуль создания Word-документа не загружен.');
    const entries=await zipApi.unzip(templateBuffer),filled=fillTemplateEntries(entries,paragraphs),blob=await zipApi.zip(filled);
    return blob.type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'?blob:new Blob([blob],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
  }
  function loadImage(url){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=url;});}
  function canvasJpeg(canvas){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось отрисовать страницу КП.')),'image/jpeg',.94));}
  function concat(parts){const length=parts.reduce((sum,part)=>sum+part.length,0),output=new Uint8Array(length);let offset=0;parts.forEach(part=>{output.set(part,offset);offset+=part.length;});return output;}
  async function pdfFromImages(images){
    const encoder=new TextEncoder(),pageW='595.28',pageH='841.89',count=images.length,maxObject=2+count*3,chunks=[],offsets=new Array(maxObject+1).fill(0);let length=0;
    const push=bytes=>{chunks.push(bytes);length+=bytes.length;};
    push(Uint8Array.from([37,80,68,70,45,49,46,52,10,37,255,255,255,255,10]));
    const kids=images.map((_image,index)=>`${3+index*3} 0 R`),objects={1:encoder.encode('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),2:encoder.encode(`2 0 obj\n<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${count} >>\nendobj\n`)};
    for(let index=0;index<count;index++){
      const pageObject=3+index*3,imageObject=4+index*3,contentObject=5+index*3,jpeg=new Uint8Array(await images[index].arrayBuffer());
      objects[pageObject]=encoder.encode(`${pageObject} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>\nendobj\n`);
      objects[imageObject]=concat([encoder.encode(`${imageObject} 0 obj\n<< /Type /XObject /Subtype /Image /Width 794 /Height 1123 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,encoder.encode('\nendstream\nendobj\n')]);
      const stream=`q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
      objects[contentObject]=encoder.encode(`${contentObject} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`);
    }
    for(let index=1;index<=maxObject;index++){offsets[index]=length;push(objects[index]);}
    const xrefOffset=length;let xref=`xref\n0 ${maxObject+1}\n0000000000 65535 f \n`;
    for(let index=1;index<=maxObject;index++)xref+=String(offsets[index]).padStart(10,'0')+' 00000 n \n';
    xref+=`trailer\n<< /Size ${maxObject+1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;push(encoder.encode(xref));
    return new Blob([concat(chunks)],{type:'application/pdf'});
  }
  function nodeText(node){return String(node&&node.textContent||'').replace(/\s+/g,' ').trim();}
  function wrapLines(context,value,width){
    const words=nodeText({textContent:value}).split(' ').filter(Boolean),lines=[];let line='';
    words.forEach(word=>{const next=line?`${line} ${word}`:word;if(!line||context.measureText(next).width<=width)line=next;else{lines.push(line);line=word;}});
    if(line)lines.push(line);return lines.length?lines:[''];
  }
  function drawText(context,value,x,y,width,lineHeight,options={}){
    context.font=options.font||'13px Arial';context.fillStyle=options.color||'#33474b';context.textAlign=options.align||'left';
    const anchor=context.textAlign==='center'?x+width/2:context.textAlign==='right'?x+width:x;
    const lines=wrapLines(context,value,width),limit=options.maxLines?Math.min(lines.length,options.maxLines):lines.length;
    for(let index=0;index<limit;index++)context.fillText(lines[index],anchor,y+index*lineHeight);
    return y+limit*lineHeight;
  }
  function drawBrand(context){
    context.fillStyle='#f8ecea';context.fillRect(0,13,275,46);context.fillRect(519,13,275,46);
    const letters=['С','Л','О','Г','И'],colors=['#4b6e73','#4b6e73','#d7b987','#d7b987','#e19b2d'];
    letters.forEach((letter,index)=>{const x=319+index*32;context.fillStyle=colors[index];context.fillRect(x,17,28,28);context.fillStyle='#fff';context.font='bold 18px Arial';context.textAlign='center';context.fillText(letter,x+14,38);});
    context.fillStyle='#40575b';context.font='bold 8px Arial';context.textAlign='center';context.fillText('ШКОЛА РАЗВИТИЯ РЕЧИ',397,55);
  }
  function drawHeading(context,section,x,y,width){
    const number=nodeText(section.querySelector('.kp-number')),title=nodeText(section.querySelector('h2'));
    context.font='bold 17px Georgia';context.fillStyle='#e39b2f';context.textAlign='left';context.fillText(number,x,y);
    context.font='bold 18px Georgia';context.fillStyle='#3a555b';context.fillText(title,x+34,y);
    context.strokeStyle='#ead9ce';context.beginPath();context.moveTo(x,y+9);context.lineTo(x+width,y+9);context.stroke();return y+30;
  }
  function drawBoxes(context,grid,x,y,width){
    const boxes=Array.from(grid.querySelectorAll(':scope > .kp-box')),columns=2,gap=0,boxWidth=(width-gap)/columns,boxHeight=70;
    boxes.forEach((box,index)=>{const col=index%columns,row=Math.floor(index/columns),bx=x+col*(boxWidth+gap),by=y+row*boxHeight;context.fillStyle=grid.classList.contains('terms-grid')?'#fdf3f1':'#fff';context.fillRect(bx,by,boxWidth,boxHeight);context.strokeStyle='#ead9ce';context.strokeRect(bx,by,boxWidth,boxHeight);drawText(context,nodeText(box.querySelector('.kp-label')).toUpperCase(),bx+11,by+17,boxWidth-22,10,{font:'8px Arial',color:'#6b7e82',maxLines:1});drawText(context,nodeText(box.querySelector('.kp-value')),bx+11,by+38,boxWidth-22,16,{font:'bold 13px Georgia',color:'#3a555b',maxLines:2});});
    return y+Math.ceil(boxes.length/columns)*boxHeight+10;
  }
  function drawTable(context,table,x,y,width){
    const rows=Array.from(table.querySelectorAll('tr')),columns=3,widths=[.14,.6,.26].map(ratio=>width*ratio),rowHeight=43;
    rows.forEach((row,rowIndex)=>{let bx=x;Array.from(row.children).forEach((cell,index)=>{context.fillStyle=rowIndex===0?'#3a555b':rowIndex%2?'#fff':'#fdf3f1';context.fillRect(bx,y+rowIndex*rowHeight,widths[index],rowHeight);context.strokeStyle='#ead9ce';context.strokeRect(bx,y+rowIndex*rowHeight,widths[index],rowHeight);drawText(context,nodeText(cell),bx+7,y+rowIndex*rowHeight+16,widths[index]-14,12,{font:rowIndex===0?'bold 9px Arial':'10px Arial',color:rowIndex===0?'#fff':'#33474b',maxLines:2,align:index===0||index===2?'center':'left'});bx+=widths[index];});});
    return y+rows.length*rowHeight+10;
  }
  function drawPdfPage(page){
    const canvas=document.createElement('canvas');canvas.width=794;canvas.height=1123;const context=canvas.getContext('2d'),x=64,width=666;context.fillStyle='#fff';context.fillRect(0,0,794,1123);drawBrand(context);let y=103;
    const title=page.querySelector('.kp-title');if(title){y=drawText(context,nodeText(title),x,y,width,31,{font:'bold 26px Georgia',color:'#3a555b'});const subtitle=page.querySelector('.kp-subtitle');y=drawText(context,nodeText(subtitle),x,y+1,width,23,{font:'italic 17px Georgia',color:'#e39b2f'});const meta=page.querySelector('.kp-meta');y=drawText(context,nodeText(meta),x,y+3,width,13,{font:'9px Arial',color:'#6b6560'})+7;}
    Array.from(page.querySelectorAll(':scope > .kp-section')).forEach(section=>{y=drawHeading(context,section,x,y+12,width);Array.from(section.children).forEach(child=>{if(child.classList&&child.classList.contains('kp-heading'))return;if(child.matches('p'))y=drawText(context,nodeText(child),x,y,width,17,{font:'12px Arial',color:'#33474b'})+5;else if(child.matches('.object-grid,.terms-grid'))y=drawBoxes(context,child,x,y+2,width);else if(child.matches('table'))y=drawTable(context,child,x,y+2,width);else if(child.matches('ul'))Array.from(child.querySelectorAll('li')).forEach(item=>{context.fillStyle='#e39b2f';context.font='bold 13px Arial';context.fillText('—',x,y);y=drawText(context,nodeText(item),x+18,y,width-18,17,{font:'12px Arial'})+3;});else if(child.matches('.signature')){context.strokeStyle='#ead9ce';context.beginPath();context.moveTo(x,y+3);context.lineTo(x+width,y+3);context.stroke();y=drawText(context,nodeText(child),x,y+22,width,17,{font:'12px Arial'})+4;}});});
    context.fillStyle='#f8ecea';context.fillRect(0,1081,794,42);context.fillStyle='#40575b';context.font='bold 8px Arial';context.textAlign='center';context.fillText('МАЛЕНЬКИЕ ШАГИ К БОЛЬШОЙ РЕЧИ',397,1106);return canvas;
  }
  async function pdfBlob(html){
    const host=document.createElement('div');host.className='kp-render-host';host.setAttribute('aria-hidden','true');host.innerHTML=html;document.body.appendChild(host);
    try{const images=[];for(const page of Array.from(host.querySelectorAll('.kp-page')))images.push(await canvasJpeg(drawPdfPage(page)));return pdfFromImages(images);}finally{host.remove();}
  }

  return Object.freeze({buildParagraphs,pagesHtml,pdfBlob,pdfFromImages,fillTemplateXml,fillTemplateEntries,docxBlob});
});
