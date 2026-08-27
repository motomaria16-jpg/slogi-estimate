import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { inviteTokenHmacHex } from '../supabase/functions/_shared/workspace-invites.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const apiUrl = String(process.env.SLOGI_LOCAL_API_URL || '');
const publishableKey = String(process.env.SLOGI_LOCAL_PUBLISHABLE_KEY || '');
const dockerPath = String(process.env.SLOGI_LOCAL_DOCKER || '');
const chromePath = String(process.env.SLOGI_LOCAL_CHROME || '');
const nodeModules = String(process.env.SLOGI_NODE_MODULES || '');
const pepper = String(process.env.SLOGI_LOCAL_INVITE_PEPPER || '');
const dbContainer = 'supabase_db_slogi-invite-gate';
const localConfig = {
  supabase: { url: apiUrl, publishableKey },
  sharedWorkspace: {
    inviteJoinEndpoint: apiUrl + '/functions/v1/join-workspace-invite',
    inviteManageEndpoint: apiUrl + '/functions/v1/workspace-invites',
    sessionStorageKey: 'slogi_anonymous_session_v1',
    connectionStorageKey: 'slogi_shared_workspace_connection_v1',
    stateCacheKey: 'slogi_shared_workspace_cache_v1',
  },
};

for (const [name, value] of Object.entries({ apiUrl, publishableKey, dockerPath, chromePath, nodeModules, pepper })) {
  assert.ok(value, `${name}_missing`);
}
assert.match(apiUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.ok(pepper.length >= 32);

const { chromium } = await import(pathToFileURL(join(nodeModules, 'playwright', 'index.mjs')).href);
const clientSource = await readFile(join(root, 'shared-workspace.js'), 'utf8');
const createdUsers = [];
let workspaceId = null;
let browser = null;
let server = null;

function localFetch(path, init = {}) {
  return fetch(apiUrl + path, init);
}

async function signup() {
  const response = await localFetch('/auth/v1/signup', {
    method: 'POST',
    headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 200, 'anonymous_signup_failed');
  const session = await response.json();
  assert.equal(session?.user?.is_anonymous, true);
  assert.ok(session.access_token && session.refresh_token && session.user.id);
  createdUsers.push(session.user.id);
  return session;
}

async function edge(path, session, body) {
  return localFetch('/functions/v1/' + path, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function psql(sql) {
  const result = spawnSync(dockerPath, ['exec', '-i', dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, 'local_sql_failed');
  return String(result.stdout || '').trim();
}

function startFixtureServer() {
  const html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SLOGI local invite gate</title></head><body><main><h1>SLOGI</h1></main><script>window.SLOGI_PHASE0_CONFIG=' + JSON.stringify(localConfig).replace(/</g, '\\u003c') + '</script><script src="/shared-workspace.js"></script></body></html>';
  return new Promise((resolve, reject) => {
    const instance = createServer(async (request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      const path = new URL(request.url || '/', 'http://127.0.0.1').pathname;
      if (path === '/' || path === '/index.html') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(html);
        return;
      }
      const filename = path.slice(1);
      if (!/^[A-Za-z0-9._-]+$/.test(filename)) { response.writeHead(404).end(); return; }
      try {
        const bytes = await readFile(join(root, filename));
        const type = filename.endsWith('.js') ? 'application/javascript; charset=utf-8'
          : filename.endsWith('.css') ? 'text/css; charset=utf-8'
          : filename.endsWith('.html') ? 'text/html; charset=utf-8'
          : filename.endsWith('.svg') ? 'image/svg+xml'
          : 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': type });
        response.end(bytes);
      } catch {
        response.writeHead(404); response.end();
      }
    });
    instance.once('error', reject);
    instance.listen(0, '127.0.0.1', () => resolve(instance));
  });
}

function browserContextOptions(session, viewport) {
  return { viewport, locale: 'ru-RU' };
}

async function openContext(session, viewport) {
  const context = await browser.newContext(browserContextOptions(session, viewport));
  await context.route('**/*', async (route) => {
    const hostname = new URL(route.request().url()).hostname;
    if (hostname === '127.0.0.1' || hostname === 'localhost') await route.continue();
    else await route.abort('blockedbyclient');
  });
  if (session) {
    await context.addInitScript(({ stored }) => {
      localStorage.setItem('slogi_anonymous_session_v1', JSON.stringify(stored));
    }, { stored: session });
  }
  await context.addInitScript(({ config }) => { window.SLOGI_PHASE0_CONFIG = config; }, { config: localConfig });
  const page = await context.newPage();
  const consoleIssues = [];
  page.on('console', (entry) => { if (entry.type() === 'error' || entry.type() === 'warning') consoleIssues.push(entry.type()); });
  page.on('pageerror', () => consoleIssues.push('pageerror'));
  return { context, page, consoleIssues };
}

try {
  const [memberA, memberB, outsider, expiredUser, exhaustedUser, revokedUser] = await Promise.all([
    signup(), signup(), signup(), signup(), signup(), signup(),
  ]);
  const setup = psql(`
    begin;
    with workspace as (
      insert into public.slogi_shared_workspaces(code_hash)
      values (encode(digest('local-invite-e2e-workspace','sha256'),'hex'))
      returning id
    ), state as (
      insert into public.slogi_shared_workspace_state(workspace_id,state)
      select id,'{"locations":[],"workspace":{}}'::jsonb from workspace
      returning workspace_id
    )
    insert into public.slogi_shared_workspace_members(workspace_id,user_id)
    select workspace_id,'${memberA.user.id}'::uuid from state
    returning workspace_id;
    commit;
  `);
  workspaceId = setup.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0] || null;
  assert.match(workspaceId, /^[0-9a-f-]{36}$/i);

  const unauthorizedCreate = await edge('workspace-invites', outsider, { action: 'create' });
  assert.equal(unauthorizedCreate.status, 404);

  server = await startFixtureServer();
  const localOrigin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: chromePath });

  const a = await openContext(memberA, { width: 1440, height: 900 });
  await a.page.goto(localOrigin + '/', { waitUntil: 'domcontentloaded' });
  await a.page.waitForFunction(() => window.SlogiCloud?.ready === true);
  await a.page.getByRole('button', { name: 'Пригласить коллегу' }).click();
  const inviteDialog = a.page.getByRole('dialog', { name: 'Пригласить коллегу' });
  await inviteDialog.waitFor();
  const inviteLink = await inviteDialog.locator('#slogi-invite-link').inputValue();
  assert.match(inviteLink, /#invite=[A-Za-z0-9_-]{43}$/);
  const token = new URL(inviteLink).hash.slice('#invite='.length);
  await inviteDialog.getByRole('button', { name: 'Скопировать ссылку' }).click();
  await inviteDialog.getByRole('button', { name: 'Закрыть' }).click();
  await a.page.waitForFunction(() => document.querySelector('#slogi-invite-link')?.value === '');
  assert.equal(await a.page.locator('#slogi-invite-link').inputValue(), '');

  const b = await openContext(memberB, { width: 1440, height: 900 });
  await b.page.goto(inviteLink, { waitUntil: 'domcontentloaded' });
  assert.equal(new URL(b.page.url()).hash, '');
  await b.page.waitForFunction(() => window.SlogiCloud?.ready === true);
  const tokenPersisted = await b.page.evaluate((rawToken) => Object.values(localStorage).some((value) => String(value).includes(rawToken)), token);
  assert.equal(tokenPersisted, false);
  const membershipCount = await b.page.evaluate(() => window.SlogiCloud?.workspaceId ? 1 : 0);
  assert.equal(membershipCount, 1);

  await a.page.evaluate(async () => {
    localStorage.setItem('slogi_locations_v1', JSON.stringify([{ id: 'local-cross-device', source: 'manual' }]));
    await window.SlogiCloud.sync();
  });
  await b.page.reload({ waitUntil: 'domcontentloaded' });
  await b.page.waitForFunction(() => window.SlogiCloud?.ready === true);
  assert.equal(await b.page.evaluate(() => JSON.parse(localStorage.getItem('slogi_locations_v1') || '[]').some((item) => item.id === 'local-cross-device')), true);

  const digest = await inviteTokenHmacHex(token, pepper);
  assert.equal(psql(`select use_count from public.slogi_shared_workspace_invites where token_hash='${digest}';`), '1');
  assert.equal((await edge('join-workspace-invite', memberB, { token })).status, 200, 'idempotent_join_failed');
  assert.equal(psql(`select use_count from public.slogi_shared_workspace_invites where token_hash='${digest}';`), '1');

  const creatorScoped = await edge('workspace-invites', memberA, { action: 'create' });
  assert.equal(creatorScoped.status, 200);
  const creatorPayload = await creatorScoped.json();
  assert.equal((await edge('workspace-invites', memberB, { action: 'revoke', inviteId: creatorPayload.inviteId })).status, 404);
  assert.equal((await edge('workspace-invites', memberA, { action: 'revoke', inviteId: creatorPayload.inviteId })).status, 200);
  assert.equal((await edge('join-workspace-invite', revokedUser, { token: creatorPayload.inviteToken })).status, 404);

  const expiredResponse = await edge('workspace-invites', memberA, { action: 'create' });
  assert.equal(expiredResponse.status, 200);
  const expiredPayload = await expiredResponse.json();
  const expiredDigest = await inviteTokenHmacHex(expiredPayload.inviteToken, pepper);
  psql(`update public.slogi_shared_workspace_invites set created_at=statement_timestamp()-interval '8 days',expires_at=statement_timestamp()-interval '1 day' where token_hash='${expiredDigest}';`);
  assert.equal((await edge('join-workspace-invite', expiredUser, { token: expiredPayload.inviteToken })).status, 404);

  const exhaustedResponse = await edge('workspace-invites', memberA, { action: 'create' });
  assert.equal(exhaustedResponse.status, 200);
  const exhaustedPayload = await exhaustedResponse.json();
  const exhaustedDigest = await inviteTokenHmacHex(exhaustedPayload.inviteToken, pepper);
  psql(`update public.slogi_shared_workspace_invites set use_count=max_uses where token_hash='${exhaustedDigest}';`);
  assert.equal((await edge('join-workspace-invite', exhaustedUser, { token: exhaustedPayload.inviteToken })).status, 404);

  const mobile = await openContext(outsider, { width: 390, height: 844 });
  await mobile.page.goto(localOrigin + '/team.html', { waitUntil: 'domcontentloaded' });
  const needDialog = mobile.page.getByRole('dialog', { name: 'Нужна ссылка-приглашение' });
  await needDialog.waitFor();
  assert.equal(await needDialog.locator('input').count(), 0);
  assert.equal(await needDialog.getByText('Личный кабинет и ручной ввод данных не требуются.').count(), 1);
  await mobile.page.keyboard.press('Escape');
  await mobile.page.getByRole('button', { name: 'Нужна ссылка-приглашение' }).focus();
  await mobile.page.keyboard.press('Enter');
  await needDialog.waitFor();
  assert.equal(await mobile.page.locator('header.site-header').count(), 1);

  await a.page.goto(localOrigin + '/team.html', { waitUntil: 'domcontentloaded' });
  await a.page.waitForFunction(() => window.SlogiCloud?.ready === true);
  assert.equal(await a.page.getByRole('button', { name: 'Пригласить коллегу' }).count(), 1);
  assert.equal(await a.page.locator('header.site-header').count(), 1);
  const desktopMetrics = await a.page.evaluate(() => ({ overflow: Math.max(0, document.documentElement.scrollWidth-document.documentElement.clientWidth, document.body.scrollWidth-document.body.clientWidth) }));
  const mobileMetrics = await mobile.page.evaluate(() => ({ overflow: Math.max(0, document.documentElement.scrollWidth-document.documentElement.clientWidth, document.body.scrollWidth-document.body.clientWidth) }));
  assert.equal(desktopMetrics.overflow, 0);
  assert.equal(mobileMetrics.overflow, 0);
  assert.deepEqual(a.consoleIssues, []);
  assert.deepEqual(b.consoleIssues, []);
  assert.deepEqual(mobile.consoleIssues, []);

  await Promise.all([a.context.close(), b.context.close(), mobile.context.close()]);
  console.log('local invite Edge/Auth/browser gate: 22/22 PASS');
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
  if (workspaceId || createdUsers.length) {
    const safeWorkspace = workspaceId && /^[0-9a-f-]{36}$/i.test(workspaceId) ? `'${workspaceId}'::uuid` : 'null::uuid';
    const safeUsers = createdUsers.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).map((id) => `'${id}'::uuid`).join(',');
    psql(`begin; delete from public.slogi_shared_workspaces where id=${safeWorkspace}; ${safeUsers ? `delete from auth.users where id in (${safeUsers});` : ''} commit;`);
  }
}
