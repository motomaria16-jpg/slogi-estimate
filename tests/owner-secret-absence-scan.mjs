import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const secret=process.env.SLOGI_OWNER_PASSWORD;
assert.ok(secret,'owner secret must be injected by a protected environment');
const listing=spawnSync('git',['-c',`safe.directory=${root}`,'ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'buffer',windowsHide:true});
assert.equal(listing.status,0,'repository inventory failed');
const paths=listing.stdout.toString('utf8').split('\0').filter(Boolean);
const needle=Buffer.from(secret,'utf8');
let findings=0;
for(const path of paths){
  const bytes=await readFile(join(root,path));
  if(bytes.indexOf(needle)!==-1)findings+=1;
}
assert.equal(findings,0,'owner secret findings detected');
console.log('owner-secret exact byte scan: 0 findings');
