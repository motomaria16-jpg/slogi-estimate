import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  base64Url,
  passwordMatches,
  randomOpaqueToken,
  signGrant,
  verifyGrant,
} from '../supabase/functions/_shared/password-gate.ts';
import { createPasswordGateHandler } from '../supabase/functions/password-gate/index.ts';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const baseUrl='https://example.supabase.co';
const anonKey='a'.repeat(40);
const serviceKey='b'.repeat(40);
const userId='11111111-1111-4111-8111-111111111111';
const workspaceId='22222222-2222-4222-8222-222222222222';
const grantId='33333333-3333-4333-8333-333333333333';
const now=Date.parse('2026-08-28T09:00:00Z');
const saltBytes=new Uint8Array(32).fill(7);
const signingBytes=new Uint8Array(32).fill(8);
const rateBytes=new Uint8Array(32).fill(9);

function environment(password){
  const values={
    SUPABASE_URL:baseUrl,
    SUPABASE_ANON_KEY:anonKey,
    SUPABASE_SERVICE_ROLE_KEY:serviceKey,
    SLOGI_GATE_PASSWORD:password,
    SLOGI_GATE_KDF_SALT:base64Url(saltBytes),
    SLOGI_GATE_SIGNING_KEY:base64Url(signingBytes),
    SLOGI_GATE_RATE_LIMIT_KEY:base64Url(rateBytes),
  };
  return{get:name=>values[name]};
}
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});}
function request(body,grant=''){
  const headers={Authorization:'Bearer anonymous-jwt','Content-Type':'application/json','x-forwarded-for':'192.0.2.10'};
  if(grant)headers['x-slogi-device-grant']=grant;
  return new Request(baseUrl+'/functions/v1/password-gate',{method:'POST',headers,body:JSON.stringify(body)});
}
function rpcName(url){return String(url).split('/').pop();}

test('PBKDF2 password verification accepts only the matching synthetic runtime value',async()=>{
  const synthetic=crypto.randomUUID()+crypto.randomUUID();
  assert.equal(await passwordMatches(synthetic,synthetic,saltBytes),true);
  assert.equal(await passwordMatches(crypto.randomUUID(),synthetic,saltBytes),false);
});

test('signed grant verifies, expires, and rejects payload or signature tampering',async()=>{
  const claims={grantId,userId,workspaceId,version:4,issuedAt:Math.floor(now/1000),expiresAt:Math.floor(now/1000)+3600,nonce:randomOpaqueToken(new Uint8Array(32).fill(5))};
  const grant=await signGrant(claims,signingBytes);
  assert.deepEqual(await verifyGrant(grant,signingBytes,now),claims);
  assert.equal(await verifyGrant(grant,signingBytes,(claims.expiresAt+1)*1000),null);
  const parts=grant.split('.');parts[4]='5';
  assert.equal(await verifyGrant(parts.join('.'),signingBytes,now),null);
  const signature=grant.slice(0,-1)+(grant.endsWith('A')?'B':'A');
  assert.equal(await verifyGrant(signature,signingBytes,now),null);
});

test('challenge plus correct password issues one canonical persistent grant without forwarding password to SQL',async()=>{
  const synthetic=crypto.randomUUID()+crypto.randomUUID();
  const calls=[];
  const fetch=async(url,options={})=>{
    const name=rpcName(url);calls.push({name,body:String(options.body||'')});
    if(String(url).endsWith('/auth/v1/user'))return json({id:userId,is_anonymous:true});
    if(name==='slogi_create_password_gate_challenge')return json(true);
    if(name==='slogi_begin_password_gate_attempt')return json(0);
    if(name==='slogi_password_gate_context')return json([{workspace_id:workspaceId,grant_version:4,grant_ttl_seconds:86400}]);
    if(name==='slogi_issue_password_gate_grant')return json(workspaceId);
    if(name==='slogi_clear_password_gate_limits')return json(true);
    throw new Error('unexpected_rpc');
  };
  const handler=createPasswordGateHandler({
    environment:environment(synthetic),fetch,now:()=>now,
    randomToken:()=>randomOpaqueToken(new Uint8Array(32).fill(6)),
    randomUuid:()=>grantId,
  });
  const challengeResponse=await handler(request({action:'challenge'}));
  assert.equal(challengeResponse.status,200);
  const challenge=(await challengeResponse.json()).challenge;
  const unlockResponse=await handler(request({action:'unlock',challenge,password:synthetic}));
  assert.equal(unlockResponse.status,200);
  const payload=await unlockResponse.json();
  assert.equal(payload.status,'granted');
  assert.equal((await verifyGrant(payload.grant,signingBytes,now)).workspaceId,workspaceId);
  assert.equal(calls.some(call=>call.body.includes(synthetic)),false);
  const issue=JSON.parse(calls.find(call=>call.name==='slogi_issue_password_gate_grant').body);
  assert.equal(issue.p_user_id,userId);
  assert.equal(issue.p_grant_id,grantId);
  assert.match(issue.p_token_hash,/^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(issue,'password'),false);
});

test('wrong password, challenge replay, and cooldown fail closed without issuing a grant',async()=>{
  const synthetic=crypto.randomUUID()+crypto.randomUUID();
  let beginStatus=200,beginBody=0,issued=0;
  const fetch=async(url)=>{
    const name=rpcName(url);
    if(String(url).endsWith('/auth/v1/user'))return json({id:userId,is_anonymous:true});
    if(name==='slogi_create_password_gate_challenge')return json(true);
    if(name==='slogi_begin_password_gate_attempt')return json(beginBody,beginStatus);
    if(name==='slogi_issue_password_gate_grant'){issued+=1;return json(workspaceId);}
    return json(true);
  };
  const handler=createPasswordGateHandler({environment:environment(synthetic),fetch,now:()=>now,randomToken:()=>randomOpaqueToken(new Uint8Array(32).fill(3)),randomUuid:()=>grantId});
  const challenge=(await (await handler(request({action:'challenge'}))).json()).challenge;
  assert.equal((await handler(request({action:'unlock',challenge,password:crypto.randomUUID()}))).status,401);
  assert.equal(issued,0);
  beginStatus=401;
  assert.equal((await handler(request({action:'unlock',challenge,password:synthetic}))).status,401);
  beginStatus=200;beginBody=30;
  const cooldown=await handler(request({action:'unlock',challenge,password:synthetic}));
  assert.equal(cooldown.status,429);
  assert.equal(cooldown.headers.get('Retry-After'),'30');
  assert.equal(issued,0);
});

test('status rejects grant replay under another anonymous user and accepts active same-user grant',async()=>{
  const claims={grantId,userId,workspaceId,version:2,issuedAt:Math.floor(now/1000),expiresAt:Math.floor(now/1000)+3600,nonce:randomOpaqueToken(new Uint8Array(32).fill(4))};
  const grant=await signGrant(claims,signingBytes);
  let authUser=userId,validationCalls=0;
  const fetch=async(url)=>{
    if(String(url).endsWith('/auth/v1/user'))return json({id:authUser,is_anonymous:true});
    validationCalls+=1;
    return json([{workspace_id:workspaceId,expires_at:new Date(claims.expiresAt*1000).toISOString(),grant_version:2}]);
  };
  const handler=createPasswordGateHandler({environment:environment(crypto.randomUUID()),fetch,now:()=>now});
  assert.equal((await handler(request({action:'status'},grant))).status,200);
  authUser='44444444-4444-4444-8444-444444444444';
  assert.equal((await handler(request({action:'status'},grant))).status,401);
  assert.equal(validationCalls,1);
});

test('forward migration enforces singleton grant in RLS, Storage and CAS while retaining invite history',async()=>{
  const sql=await readFile(join(root,'supabase','migrations','20260828_7617_password_gate.sql'),'utf8');
  for(const pattern of [
    /create table public\.slogi_password_gate_config/i,
    /constraint slogi_password_gate_config_pkey primary key \(singleton\)/i,
    /create table public\.slogi_password_gate_grants/i,
    /create table public\.slogi_password_gate_challenges/i,
    /create table public\.slogi_password_gate_rate_limits/i,
    /slogi_has_active_password_gate_grant\(workspace_id\)/i,
    /SLOGI shared state select member[\s\S]*slogi_has_active_password_gate_grant/i,
    /SLOGI shared files select member[\s\S]*slogi_has_active_password_gate_grant/i,
    /slogi_update_shared_workspace_state[\s\S]*slogi_has_active_password_gate_grant/i,
    /workspace_revision_conflict/i,
    /update public\.slogi_shared_workspace_invites[\s\S]*revoked_at/i,
    /revoke execute on function public\.slogi_accept_shared_workspace_invite/i,
  ])assert.match(sql,pattern);
  assert.equal(/drop table\s+(?:if exists\s+)?(?:public\.)?slogi_shared_workspace(?:s|_invites)?\b/i.test(sql),false);
  assert.equal(/delete from\s+(?:public\.)?slogi_shared_workspace(?:s|_invites)?\b/i.test(sql),false);
});

test('active frontend has an early fail-closed gate and no invite or personal-account surface',async()=>{
  const shared=await readFile(join(root,'shared-workspace.js'),'utf8');
  const config=await readFile(join(root,'phase0-config.js'),'utf8');
  const shell=await readFile(join(root,'professional-shell.js'),'utf8');
  assert.match(shared,/data-slogi-access','pending'/);
  assert.match(shared,/x-slogi-device-grant/);
  assert.match(shared,/action:'challenge'/);
  assert.match(shared,/action:'unlock'/);
  assert.match(shared,/getDeviceGrant/);
  assert.equal(/invite|приглас|clipboard|join-workspace/i.test(shared+config+shell),false);
  assert.equal(/PBKDF2|deriveBits|subtle|passwordMatches/i.test(shared),false);
  assert.match(config,/passwordGateEndpoint/);
  assert.equal(/inviteJoinEndpoint|inviteManageEndpoint/.test(config),false);
  for(const file of ['index.html','available-spaces.html','passport.html','proposal.html','settings.html','source-specification.html','specification.html','team.html','workspace.html']){
    const html=await readFile(join(root,file),'utf8');
    assert.match(html,/data-slogi-access="pending"/);
    assert.ok(html.indexOf('shared-workspace.js?v=7617')<html.indexOf('</head>'));
    assert.equal((html.match(/shared-workspace\.js/g)||[]).length,1);
  }
});

test('legacy invite Edge routes are absent and current secret template contains names only',async()=>{
  for(const path of [
    ['supabase','functions','workspace-invites','index.ts'],
    ['supabase','functions','join-workspace-invite','index.ts'],
    ['supabase','functions','join-workspace','index.ts'],
  ])await assert.rejects(access(join(root,...path)));
  const template=await readFile(join(root,'.env.example'),'utf8');
  for(const name of ['SLOGI_GATE_PASSWORD','SLOGI_GATE_KDF_SALT','SLOGI_GATE_SIGNING_KEY','SLOGI_GATE_RATE_LIMIT_KEY']){
    assert.match(template,new RegExp('^'+name+'=$','m'));
  }
  assert.equal(/SLOGI_WORKSPACE_INVITE_PEPPER/.test(template),false);
});

test('user-facing listing Edge handlers require the shared server grant validator',async()=>{
  const search=await readFile(join(root,'supabase','functions','search-listings','index.ts'),'utf8');
  const manualImport=await readFile(join(root,'supabase','functions','import-listing','index.ts'),'utf8');
  for(const source of [search,manualImport]){
    assert.match(source,/authorizeDeviceGrant/);
    assert.match(source,/x-slogi-device-grant/);
  }
});
