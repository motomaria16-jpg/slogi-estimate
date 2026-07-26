(function(){
'use strict';
function colToNumber(col){
  let n = 0;
  for(const ch of col.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}
function numberToCol(n){
  let s = '';
  for(n = n + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
function decodeCellAddress(addr){
  const m = String(addr || '').match(/^([A-Z]+)(\d+)$/i);
  if(!m) return {r:0,c:0};
  return {r:Number(m[2]) - 1, c:colToNumber(m[1])};
}
function encodeCell(pos){ return numberToCol(pos.c) + (pos.r + 1); }
function decodeRange(ref){
  const parts = String(ref || 'A1').split(':');
  const s = decodeCellAddress(parts[0]);
  const e = decodeCellAddress(parts[1] || parts[0]);
  return {s,e};
}
async function readFileAsArrayBuffer(file){
  // На iOS объект File может стать недоступным, если input очистить раньше времени.
  // Сначала читаем современным способом, затем используем FileReader как резерв.
  if(file && typeof file.arrayBuffer === 'function'){
    try{
      const data = await file.arrayBuffer();
      if(data && data.byteLength) return data;
    }catch(e){}
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if(reader.result && reader.result.byteLength) resolve(reader.result);
      else reject(new Error('Выбранный файл оказался пустым или недоступным для чтения.'));
    };
    reader.onerror = () => reject(reader.error || new Error('Телефон не смог прочитать выбранный файл.'));
    reader.onabort = () => reject(new Error('Чтение файла отменено.'));
    reader.readAsArrayBuffer(file);
  });
}
function textFromXmlNode(node){
  if(!node) return '';
  return Array.from(node.getElementsByTagName('t')).map(x => x.textContent || '').join('');
}
async function unzipXlsx(arrayBuffer){
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  let eocd = -1;
  for(let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--){
    if(view.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  }
  if(eocd < 0) throw new Error('Файл не похож на корректный XLSX-архив.');
  const total = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder('utf-8');
  const entries = new Map();
  for(let i=0; i<total; i++){
    if(view.getUint32(offset, true) !== 0x02014b50) throw new Error('Повреждена структура XLSX-файла.');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLen));
    entries.set(name, {method, compressedSize, localOffset});
    offset += 46 + nameLen + extraLen + commentLen;
  }
  async function getBytes(name){
    const entry = entries.get(name);
    if(!entry) return null;
    const p = entry.localOffset;
    if(view.getUint32(p, true) !== 0x04034b50) throw new Error('Повреждён файл ' + name + '.');
    const nameLen = view.getUint16(p + 26, true);
    const extraLen = view.getUint16(p + 28, true);
    const start = p + 30 + nameLen + extraLen;
    const packed = bytes.slice(start, start + entry.compressedSize);
    if(entry.method === 0) return packed;
    if(entry.method !== 8) throw new Error('Неподдерживаемый способ сжатия XLSX.');
    // Встроенный pako работает в Safari, Chrome, Samsung Internet и встроенных браузерах,
    // в том числе при открытии страницы как локального HTML-файла без интернета.
    if(window.pako && typeof window.pako.inflateRaw === 'function'){
      try { return window.pako.inflateRaw(packed); }
      catch(e){ throw new Error('Не удалось распаковать XLSX-файл. Возможно, файл повреждён.'); }
    }
    // Дополнительный резерв для браузеров с DecompressionStream.
    if(typeof DecompressionStream !== 'undefined'){
      try{
        const stream = new DecompressionStream('deflate-raw');
        const response = new Response(new Blob([packed]).stream().pipeThrough(stream));
        return new Uint8Array(await response.arrayBuffer());
      }catch(e){}
    }
    throw new Error('Этот браузер не смог распаковать XLSX-файл.');
  }
  return {
    has: name => entries.has(name),
    text: async name => {
      const data = await getBytes(name);
      return data ? decoder.decode(data) : null;
    }
  };
}
function xmlDoc(text, label){
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if(doc.getElementsByTagName('parsererror').length) throw new Error('Не удалось разобрать ' + label + ' в XLSX.');
  return doc;
}
function normalizeZipPath(base, target){
  if(target.startsWith('/')) return target.replace(/^\//, '');
  const parts = (base + '/' + target).split('/');
  const out = [];
  for(const p of parts){ if(!p || p === '.') continue; if(p === '..') out.pop(); else out.push(p); }
  return out.join('/');
}
async function parseXlsxStandalone(arrayBuffer){
  const zip = await unzipXlsx(arrayBuffer);
  const workbookText = await zip.text('xl/workbook.xml');
  const relsText = await zip.text('xl/_rels/workbook.xml.rels');
  if(!workbookText || !relsText) throw new Error('В XLSX не найдена структура книги.');
  const wbDoc = xmlDoc(workbookText, 'книгу');
  const relDoc = xmlDoc(relsText, 'связи книги');
  const rels = {};
  Array.from(relDoc.getElementsByTagName('Relationship')).forEach(r => {
    rels[r.getAttribute('Id')] = normalizeZipPath('xl', r.getAttribute('Target') || '');
  });
  let shared = [];
  const sharedText = await zip.text('xl/sharedStrings.xml');
  if(sharedText){
    const shDoc = xmlDoc(sharedText, 'общие строки');
    shared = Array.from(shDoc.getElementsByTagName('si')).map(textFromXmlNode);
  }
  const result = {SheetNames:[], Sheets:{}};
  const sheetNodes = Array.from(wbDoc.getElementsByTagName('sheet'));
  for(const sheetNode of sheetNodes){
    const name = sheetNode.getAttribute('name') || 'Лист';
    const rid = sheetNode.getAttribute('r:id') || sheetNode.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
    const path = rels[rid];
    if(!path) continue;
    const sheetText = await zip.text(path);
    if(!sheetText) continue;
    const doc = xmlDoc(sheetText, 'лист «' + name + '»');
    const ws = {};
    let minR=Infinity,minC=Infinity,maxR=0,maxC=0;
    for(const c of Array.from(doc.getElementsByTagName('c'))){
      const addr = c.getAttribute('r');
      if(!addr) continue;
      const pos = decodeCellAddress(addr);
      minR=Math.min(minR,pos.r); minC=Math.min(minC,pos.c); maxR=Math.max(maxR,pos.r); maxC=Math.max(maxC,pos.c);
      const t = c.getAttribute('t') || '';
      const f = c.getElementsByTagName('f')[0];
      const v = c.getElementsByTagName('v')[0];
      const is = c.getElementsByTagName('is')[0];
      let value;
      if(t === 's') value = shared[Number(v ? v.textContent : 0)] ?? '';
      else if(t === 'inlineStr') value = textFromXmlNode(is);
      else if(t === 'str') value = v ? v.textContent : '';
      else if(t === 'b') value = (v && v.textContent === '1');
      else {
        const raw = v ? v.textContent : '';
        value = raw === '' ? undefined : (Number.isFinite(Number(raw)) ? Number(raw) : raw);
      }
      const cell = {v:value};
      if(f) cell.f = f.textContent || '';
      ws[addr] = cell;
    }
    const dim = doc.getElementsByTagName('dimension')[0];
    ws['!ref'] = dim && dim.getAttribute('ref') ? dim.getAttribute('ref') : (minR === Infinity ? 'A1' : encodeCell({r:minR,c:minC}) + ':' + encodeCell({r:maxR,c:maxC}));
    result.SheetNames.push(name);
    result.Sheets[name] = ws;
  }
  if(!result.SheetNames.length) throw new Error('В XLSX не найдено ни одного листа.');
  return result;
}
async function loadSheetJsFallback(){
  if(window.XLSX && XLSX.read) return true;
  const urls = [
    'https://cdn.sheetjs.com/xlsx-0.18.5/package/dist/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js'
  ];
  for(const url of urls){
    try{
      await new Promise((resolve,reject)=>{
        const sc=document.createElement('script'); sc.src=url; sc.async=true;
        sc.onload=resolve; sc.onerror=reject; document.head.appendChild(sc);
      });
      if(window.XLSX && XLSX.read) return true;
    }catch(e){}
  }
  return false;
}

/* ---------------------------------------------------------------------
   Разбор книги Excel в структуру { params:[{address,label,value}], categories:[...] }
--------------------------------------------------------------------- */
function parseWorkbook(wb){
  const sheetName = wb.SheetNames.find(n => n.includes('Специф')) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if(!ws || !ws['!ref']) throw new Error('Не удалось прочитать лист «' + sheetName + '».');
  const range = decodeRange(ws['!ref']);

  function cellAt(r,c){ return ws[encodeCell({r,c})]; }
  function val(r,c){ const cl = cellAt(r,c); return cl ? cl.v : undefined; }
  function formulaOf(r,c){ const cl = cellAt(r,c); return (cl && cl.f) ? cl.f : undefined; }

  let headerRow = -1;
  for(let r = range.s.r; r <= range.e.r; r++){
    const v = val(r,0);
    if(typeof v === 'string' && v.trim() === '№'){ headerRow = r; break; }
  }
  if(headerRow === -1){
    throw new Error('На листе «' + sheetName + '» не найдена строка заголовков «№ / НАЗВАНИЕ / ЦЕНА / КОЛ-ВО / СТОИМОСТЬ».');
  }

  // входные параметры: строки до заголовка, где в колонке A есть текст,
  // а в колонке D — обычное число (не формула)
  const params = [];
  for(let r = range.s.r; r < headerRow; r++){
    const a = val(r,0);
    const dCell = cellAt(r,3);
    if(a && typeof a === 'string' && dCell && typeof dCell.v === 'number' && !dCell.f){
      params.push({ address: 'D' + (r+1), label: String(a).trim(), value: dCell.v });
    }
  }

  const topRe = /^\d+\.\s/;
  const subRe = /^\d+\.\d+\.?\s/;
  const itogRe = /^итого/i;

  const categories = [];
  let curCat = null, curSub = null, currentGroup = null;

  for(let r = headerRow + 1; r <= range.e.r; r++){
    const a = val(r,0), b = val(r,1), c = val(r,2), d = val(r,3);
    const aStr = (a !== undefined && a !== null) ? String(a).trim() : '';

    if(aStr && itogRe.test(aStr)) continue;

    if(c === undefined || c === null || c === ''){
      if(aStr && subRe.test(aStr)){
        currentGroup = null;
        if(!curCat){ curCat = { top: null, subs: [] }; categories.push(curCat); }
        curSub = { sub: aStr, items: [] };
        curCat.subs.push(curSub);
      } else if(aStr && topRe.test(aStr)){
        curCat = { top: aStr, subs: [] };
        categories.push(curCat);
        curSub = null;
      }
      continue;
    }

    if(b) currentGroup = b;
    if(!curCat){ curCat = { top: null, subs: [] }; categories.push(curCat); }
    if(!curSub){ curSub = { sub: null, items: [] }; curCat.subs.push(curSub); }

    const price = (typeof d === 'number') ? d : 0;
    const f = formulaOf(r,4);
    const rawE = val(r,4);
    const qty_expr = (f !== undefined) ? f : ((typeof rawE === 'number') ? rawE : 0);

    curSub.items.push({
      num: aStr,
      group: currentGroup || null,
      name: String(c),
      price: price,
      qty_expr: qty_expr
    });
  }

  return { params, categories };
}

/* ---------------------------------------------------------------------
   Вычисление формул количества (D6, D6*2, ROUND(3/4*D6,0) и т.п.)
--------------------------------------------------------------------- */
function evalQty(expr, paramValues){
  if (typeof expr === 'number') return expr;
  let e = String(expr).replace(/\$/g, '');
  const addrs = Object.keys(paramValues).sort((x,y)=>y.length-x.length);
  for(const addr of addrs){
    const re = new RegExp('\\b' + addr + '\\b', 'g');
    e = e.replace(re, paramValues[addr]);
  }
  if(!/^[0-9+\-*/(). ,A-Za-z]+$/.test(e)) return 0;
  try{
    return Function('"use strict";function ROUND(x,n){n=n||0;const f=Math.pow(10,n);return Math.round(x*f)/f;}return (' + e + ')')();
  }catch(err){ return 0; }
}

function escapeSpreadsheet(value){
  return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function computeEstimateFor(model, state){
  let grand = 0;
  const cats = (model.categories || []).map(cat => {
    let catSum = 0;
    const subs = (cat.subs || []).map(sb => {
      let subSum = 0;
      const items = (sb.items || []).map(it => {
        const qty = evalQty(it.qty_expr, state || {});
        const cost = Number.isFinite(Number(it.manual_cost)) ? Number(it.manual_cost) : (Number(it.price) || 0) * qty;
        subSum += cost;
        return Object.assign({}, it, {qty, cost});
      });
      catSum += subSum;
      return Object.assign({}, sb, {items, subSum});
    });
    grand += catSum;
    return Object.assign({}, cat, {subs, catSum});
  });
  return {cats, grand};
}


const zipCrcTable=(()=>{const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;table[n]=c>>>0;}return table;})();
function zipCrc32(bytes){let c=0xFFFFFFFF;for(const b of bytes)c=zipCrcTable[(c^b)&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function zipU16(value){const a=new Uint8Array(2);new DataView(a.buffer).setUint16(0,value,true);return a;}
function zipU32(value){const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,value>>>0,true);return a;}
function zipConcat(parts){const length=parts.reduce((s,p)=>s+p.length,0);const out=new Uint8Array(length);let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}return out;}
function zipDosDateTime(date=new Date()){const year=Math.max(1980,date.getFullYear());return {time:(date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1),date:((year-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate()};}
async function createZip(files){
  const encoder=new TextEncoder();const locals=[];const centrals=[];let offset=0;const dt=zipDosDateTime();
  for(const file of files){
    const name=encoder.encode(file.name);const data=new Uint8Array(await file.blob.arrayBuffer());const crc=zipCrc32(data);const flag=0x0800;
    const local=zipConcat([zipU32(0x04034b50),zipU16(20),zipU16(flag),zipU16(0),zipU16(dt.time),zipU16(dt.date),zipU32(crc),zipU32(data.length),zipU32(data.length),zipU16(name.length),zipU16(0),name,data]);
    const central=zipConcat([zipU32(0x02014b50),zipU16(20),zipU16(20),zipU16(flag),zipU16(0),zipU16(dt.time),zipU16(dt.date),zipU32(crc),zipU32(data.length),zipU32(data.length),zipU16(name.length),zipU16(0),zipU16(0),zipU16(0),zipU16(0),zipU32(0),zipU32(offset),name]);
    locals.push(local);centrals.push(central);offset+=local.length;
  }
  const centralData=zipConcat(centrals);const end=zipConcat([zipU32(0x06054b50),zipU16(0),zipU16(0),zipU16(files.length),zipU16(files.length),zipU32(centralData.length),zipU32(offset),zipU16(0)]);
  return new Blob([...locals,centralData,end],{type:'application/zip'});
}


async function createEstimateExcelBlob(model, state, address, title="СМЕТА", sheetName="Смета"){
  const result = computeEstimateFor(model, state);
  const rows = [];
  const merges = ['A1:F1','A2:F2','A3:F3'];
  let rowNo = 1;
  const textCell = (ref, value, style=7) => `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeSpreadsheet(value)}</t></is></c>`;
  const numCell = (ref, value, style=4) => `<c r="${ref}" s="${style}"><v>${Number(value)||0}</v></c>`;
  rows.push(`<row r="${rowNo}" ht="28" customHeight="1">${textCell('A'+rowNo,title,1)}</row>`); rowNo++;
  rows.push(`<row r="${rowNo}">${textCell('A'+rowNo,'Объект: '+(address||'Адрес не указан'),7)}</row>`); rowNo++;
  rows.push(`<row r="${rowNo}">${textCell('A'+rowNo,'Сформировано: '+new Date().toLocaleString('ru-RU'),7)}</row>`); rowNo++;
  rows.push(`<row r="${rowNo}"></row>`); rowNo++;
  merges.push(`A${rowNo}:F${rowNo}`);
  rows.push(`<row r="${rowNo}" ht="22" customHeight="1">${textCell('A'+rowNo,'ВХОДНЫЕ ПАРАМЕТРЫ',2)}</row>`); rowNo++;
  const inputParams = Array.isArray(model.params) ? model.params : [];
  if(inputParams.length){
    inputParams.forEach(param => {
      merges.push(`A${rowNo}:E${rowNo}`);
      const paramValue = Object.prototype.hasOwnProperty.call(state || {}, param.address) ? state[param.address] : param.value;
      const valueCell = paramValue !== '' && Number.isFinite(Number(paramValue))
        ? numCell('F'+rowNo, Number(paramValue), 4)
        : textCell('F'+rowNo, paramValue ?? '', 7);
      rows.push(`<row r="${rowNo}">${textCell('A'+rowNo,param.label || param.address || 'Параметр',7)}${valueCell}</row>`); rowNo++;
    });
  }else{
    merges.push(`A${rowNo}:F${rowNo}`);
    rows.push(`<row r="${rowNo}">${textCell('A'+rowNo,'Входные параметры не заданы',7)}</row>`); rowNo++;
  }
  rows.push(`<row r="${rowNo}"></row>`); rowNo++;
  rows.push(`<row r="${rowNo}" ht="24" customHeight="1">${['№','Тип','Наименование','Цена, ₽','Количество','Стоимость, ₽'].map((v,i)=>textCell(String.fromCharCode(65+i)+rowNo,v,6)).join('')}</row>`);
  const headerRow = rowNo;
  rowNo++;
  result.cats.forEach(cat => {
    merges.push(`A${rowNo}:E${rowNo}`);
    rows.push(`<row r="${rowNo}">${textCell('A'+rowNo,cat.top||'Без раздела',2)}${numCell('F'+rowNo,Math.round(cat.catSum),2)}</row>`); rowNo++;
    cat.subs.forEach(sb => {
      merges.push(`A${rowNo}:E${rowNo}`);
      rows.push(`<row r="${rowNo}">${textCell('A'+rowNo,sb.sub||'',3)}${numCell('F'+rowNo,Math.round(sb.subSum),3)}</row>`); rowNo++;
      sb.items.forEach(it => {
        rows.push(`<row r="${rowNo}">${textCell('A'+rowNo,it.num||'',7)}${textCell('B'+rowNo,it.group||'',7)}${textCell('C'+rowNo,it.name||'',7)}${numCell('D'+rowNo,Number(it.price)||0,4)}${numCell('E'+rowNo,Math.round(it.qty*100)/100,4)}${numCell('F'+rowNo,Math.round(it.cost),4)}</row>`); rowNo++;
      });
    });
  });
  merges.push(`A${rowNo}:E${rowNo}`);
  rows.push(`<row r="${rowNo}" ht="25" customHeight="1">${textCell('A'+rowNo,'ИТОГО',5)}${numCell('F'+rowNo,Math.round(result.grand),5)}</row>`);
  const lastRow = rowNo;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:F${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow+1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="12" customWidth="1"/><col min="2" max="2" width="25" customWidth="1"/><col min="3" max="3" width="70" customWidth="1"/><col min="4" max="6" width="16" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A${headerRow}:F${lastRow}"/><mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="14"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF37545A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7EFEF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3E9D7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE19B2D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFEAD9CE"/></left><right style="thin"><color rgb="FFEAD9CE"/></right><top style="thin"><color rgb="FFEAD9CE"/></top><bottom style="thin"><color rgb="FFEAD9CE"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="4" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="2" fillId="4" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf><xf numFmtId="4" fontId="1" fillId="5" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Обычный" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files = [
    {name:'[Content_Types].xml',blob:new Blob([`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],{type:'application/xml'})},
    {name:'_rels/.rels',blob:new Blob([`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],{type:'application/xml'})},
    {name:'xl/workbook.xml',blob:new Blob([`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeSpreadsheet(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],{type:'application/xml'})},
    {name:'xl/_rels/workbook.xml.rels',blob:new Blob([`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],{type:'application/xml'})},
    {name:'xl/worksheets/sheet1.xml',blob:new Blob([sheet],{type:'application/xml'})},
    {name:'xl/styles.xml',blob:new Blob([styles],{type:'application/xml'})}
  ];
  const zip = await createZip(files);
  return new Blob([zip], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

async function parseXlsx(file){
  const buf=await readFileAsArrayBuffer(file);
  const name=String(file&&file.name||'').toLowerCase();
  let wb;
  if(window.XLSX&&typeof window.XLSX.read==='function') wb=window.XLSX.read(buf,{type:'array',cellFormula:true,cellText:false});
  else if(name.endsWith('.xlsx')) wb=await parseXlsxStandalone(buf);
  else { const ok=await loadSheetJsFallback(); if(!ok) throw new Error('Сохраните файл в формате .xlsx.'); wb=window.XLSX.read(buf,{type:'array',cellFormula:true,cellText:false}); }
  return parseWorkbook(wb);
}
window.SlogiXlsx={parseXlsx,parseSpecification:parseWorkbook,evalQty,computeEstimateFor,makeXlsx:createEstimateExcelBlob};
})();
