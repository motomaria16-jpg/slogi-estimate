import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const workflowSource=await readFile(join(root,'workflow-storage.js'),'utf8');
const sharedSource=await readFile(join(root,'shared-workspace.js'),'utf8');

function indexedDbHarness(seed={}){
  const records=new Map(Object.entries(seed));
  const indexedDB={
    open(){
      const request={result:null,error:null};
      queueMicrotask(()=>{
        request.result={
          objectStoreNames:{contains:()=>true},
          transaction(){
            const transaction={error:null,oncomplete:null,onerror:null};
            transaction.objectStore=()=>({
              delete(key){records.delete(String(key));queueMicrotask(()=>transaction.oncomplete?.());},
              get(key){const query={result:null,error:null};queueMicrotask(()=>{query.result=records.get(String(key));query.onsuccess?.();});return query;},
            });
            return transaction;
          },
          close(){},
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
  return{indexedDB,records};
}

function workflowHarness({cloud,indexedDB}={}){
  const window={SlogiCloud:cloud,dispatchEvent(){}};
  const context=vm.createContext({
    window,
    indexedDB,
    localStorage:{getItem(){return null;},setItem(){}},
    location:{search:''},
    URLSearchParams,
    CustomEvent:class{},
    Blob,
    URL,
    document:{createElement(){return{};},body:{appendChild(){}}},
    console,
    setTimeout,
  });
  vm.runInContext(workflowSource,context,{filename:'workflow-storage.js'});
  return window.SlogiWorkflow;
}

test('deleteAttachment removes one local IndexedDB record and delegates the same key to cloud',async()=>{
  const db=indexedDbHarness({
    'room-1:signed-lease':{key:'room-1:signed-lease'},
    'room-1:ownership-document':{key:'room-1:ownership-document'},
  });
  const calls=[];
  const workflow=workflowHarness({indexedDB:db.indexedDB,cloud:{deleteAttachment:async(...args)=>calls.push(args)}});

  assert.equal(await workflow.deleteAttachment('room-1','signed-lease'),true);
  assert.deepEqual(calls,[['room-1','signed-lease']]);
  assert.equal(db.records.has('room-1:signed-lease'),false);
  assert.equal(db.records.has('room-1:ownership-document'),true,'unrelated attachments must remain intact');
});

test('deleteAttachment remains safe when cloud and IndexedDB are unavailable',async()=>{
  const workflow=workflowHarness();
  assert.equal(await workflow.deleteAttachment('room-1','signed-lease'),true);
  assert.equal(await workflow.deleteAttachment('','signed-lease'),false);
});

test('deleteAttachment keeps the local record when cloud deletion fails',async()=>{
  const db=indexedDbHarness({'room-1:signed-lease':{key:'room-1:signed-lease'}});
  const workflow=workflowHarness({indexedDB:db.indexedDB,cloud:{deleteAttachment:async()=>{throw new Error('offline');}}});

  await assert.rejects(workflow.deleteAttachment('room-1','signed-lease'),/offline/);
  assert.equal(db.records.has('room-1:signed-lease'),true);
});

test('shared workspace exposes exact single-attachment cloud cleanup',()=>{
  assert.match(sharedSource,/async function deleteAttachment\(locationId,type\)/);
  assert.match(sharedSource,/attachment_type=eq\.'\+encodeURIComponent\(String\(type\)\)/);
  assert.match(sharedSource,/prefixes:paths/);
  assert.match(sharedSource,/const api=\{[\s\S]*?deleteAttachment,[\s\S]*?deleteAttachments,/);
});
