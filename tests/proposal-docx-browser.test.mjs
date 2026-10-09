import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import test from 'node:test';

const root=resolve(dirname(dirname(fileURLToPath(import.meta.url))));
const chromePath=String(process.env.SLOGI_LOCAL_CHROME||'');
const nodeModules=String(process.env.SLOGI_NODE_MODULES||'');
const hasBrowserRuntime=Boolean(chromePath&&nodeModules&&existsSync(chromePath));

test('browser creates a source-fidelity DOCX and changes only word/document.xml',{skip:!hasBrowserRuntime},async()=>{
  const template=readFileSync(join(root,'KP_Slogi_template.docx'));
  assert.equal(createHash('sha256').update(template).digest('hex').toUpperCase(),'C8BD7FECAD8AD0914195F5B88BF732ECC1194CA539FC89C4A9784D501538D2F1');
  const {chromium}=await import(pathToFileURL(join(nodeModules,'playwright','index.mjs')).href),browser=await chromium.launch({headless:true,executablePath:chromePath});
  try{
    const page=await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    for(const file of ['pako-inflate.min.js','office-zip.js','proposal-document.js'])await page.addScriptTag({path:join(root,file)});
    const result=await page.evaluate(async templateBase64=>{
      const binary=atob(templateBase64),source=new Uint8Array(binary.length);
      for(let index=0;index<binary.length;index++)source[index]=binary.charCodeAt(index);
      const project={id:'space-1',address:'Россия, Москва, шоссе Энтузиастов, 3к1',area:125,phase0:{spaceCard:{work:{landlordContact:{name:'Мария'}}}}};
      const terms={rentFreeDays:120,baseRentRate:2500,discountRentRate:2000,discountPeriodDays:20};
      const fields=window.SlogiProposalDocument.buildFields(project,terms),original=await window.OfficeZip.unzip(source.buffer),blob=await window.SlogiProposalDocument.docxBlob(source.buffer,fields,window.OfficeZip),generated=await window.OfficeZip.unzip(await blob.arrayBuffer()),decoder=new TextDecoder();
      const sameBytes=(left,right)=>left.length===right.length&&left.every((value,index)=>value===right[index]);
      const untouched=original.filter(entry=>entry.name!=='word/document.xml').every(entry=>{const next=generated.find(candidate=>candidate.name===entry.name);return Boolean(next&&sameBytes(entry.data,next.data));});
      const documentXml=decoder.decode(generated.find(entry=>entry.name==='word/document.xml').data);
      return{type:blob.type,partCount:generated.length,sameNames:original.map(entry=>entry.name).join('|')===generated.map(entry=>entry.name).join('|'),untouched,hasAddress:documentXml.includes('Россия, Москва, шоссе Энтузиастов, 3к1'),hasTerms:documentXml.includes('2 500')||documentXml.includes('2 500'),hasMarkers:/\[\[SLOGI_FIELD_[A-Z0-9_]+\]\]/.test(documentXml),hasYellow:/<w:highlight\b[^>]*w:val="yellow"/i.test(documentXml),hasSourcePlaceholders:/\[(?:ДД|ФИО|адрес|__|ХХ|этаж|Имя|должность|телефон|email|сайт)[^\]]*\]/i.test(documentXml)};
    },template.toString('base64'));
    assert.equal(result.type,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(result.partCount,19);
    assert.equal(result.sameNames,true);
    assert.equal(result.untouched,true);
    assert.equal(result.hasAddress,true);
    assert.equal(result.hasTerms,true);
    assert.equal(result.hasMarkers,false);
    assert.equal(result.hasYellow,false);
    assert.equal(result.hasSourcePlaceholders,false);
  }finally{await browser.close();}
});
