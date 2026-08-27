import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  generateOpaqueInviteToken,
  inviteTokenHmacHex,
  validInviteToken,
} from '../supabase/functions/_shared/workspace-invites.ts';
import { createJoinWorkspaceInviteHandler } from '../supabase/functions/join-workspace-invite/index.ts';
import { createWorkspaceInvitesHandler } from '../supabase/functions/workspace-invites/index.ts';
import { createJoinWorkspaceHandler } from '../supabase/functions/join-workspace/index.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const baseUrl = 'https://example.supabase.co';
const anonKey = 'a'.repeat(40);
const serviceKey = 'b'.repeat(40);
const pepper = 'p'.repeat(32);
const userId = '11111111-1111-4111-8111-111111111111';
const inviteId = '22222222-2222-4222-8222-222222222222';
const token = 'A'.repeat(43);

function environment() {
  const values = {
    SUPABASE_URL: baseUrl,
    SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    SLOGI_WORKSPACE_INVITE_PEPPER: pepper,
  };
  return { get: (name) => values[name] };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function request(body) {
  return new Request('https://example.supabase.co/functions/v1/test', {
    method: 'POST',
    headers: { Authorization: 'Bearer anonymous-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('opaque tokens contain 256 bits and use canonical base64url', () => {
  const first = generateOpaqueInviteToken(new Uint8Array(32));
  const secondBytes = new Uint8Array(32); secondBytes[31] = 1;
  const second = generateOpaqueInviteToken(secondBytes);
  assert.equal(first.length, 43);
  assert.equal(validInviteToken(first), true);
  assert.equal(validInviteToken(second), true);
  assert.notEqual(first, second);
  assert.throws(() => generateOpaqueInviteToken(new Uint8Array(31)), /invite_random_invalid/);
  assert.equal(validInviteToken('A'.repeat(42)), false);
  assert.equal(validInviteToken('A'.repeat(42) + '='), false);
});

test('HMAC is deterministic, keyed, and rejects invalid inputs', async () => {
  const digest = await inviteTokenHmacHex(token, pepper);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(await inviteTokenHmacHex(token, pepper), digest);
  assert.notEqual(await inviteTokenHmacHex('B'.repeat(43), pepper), digest);
  assert.notEqual(await inviteTokenHmacHex(token, 'q'.repeat(32)), digest);
  await assert.rejects(inviteTokenHmacHex('bad', pepper), /invite_digest_invalid/);
  await assert.rejects(inviteTokenHmacHex(token, 'short'), /invite_digest_invalid/);
});

test('member creates a seven-day, five-use invite without sending raw token to SQL', async () => {
  const calls = [];
  const handler = createWorkspaceInvitesHandler({
    environment: environment(),
    now: () => Date.parse('2026-08-27T10:00:00Z'),
    generateToken: () => token,
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/auth/v1/user')) return json({ id: userId, is_anonymous: true });
      return json([{ invite_id: inviteId, expires_at: '2026-09-03T10:00:00Z' }]);
    },
  });
  const response = await handler(request({ action: 'create' }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(Object.keys(payload).sort(), ['expiresAt', 'inviteId', 'inviteToken', 'status']);
  assert.equal(payload.inviteToken, token);
  assert.equal(calls.length, 2);
  const rpcBody = JSON.parse(calls[1].options.body);
  assert.equal(rpcBody.p_max_uses, 5);
  assert.equal(rpcBody.p_expires_at, '2026-09-03T10:00:00.000Z');
  assert.match(rpcBody.p_token_hash, /^[0-9a-f]{64}$/);
  assert.equal(calls[1].options.body.includes(token), false);
});

test('anonymous invite acceptance sends only its digest and returns no workspace identifier', async () => {
  const calls = [];
  const handler = createJoinWorkspaceInviteHandler({
    environment: environment(),
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/auth/v1/user')) return json({ id: userId, is_anonymous: true });
      return json(true);
    },
  });
  const response = await handler(request({ token }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'connected' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.body.includes(token), false);
  assert.deepEqual(Object.keys(JSON.parse(calls[1].options.body)).sort(), ['p_token_hash', 'p_user_id']);
});

test('unauthorized, expired, revoked, exhausted, and malformed invites fail closed', async () => {
  const rejectedUser = createJoinWorkspaceInviteHandler({
    environment: environment(),
    fetch: async () => json({ id: userId, is_anonymous: false }),
  });
  assert.equal((await rejectedUser(request({ token }))).status, 401);

  for (const status of [400, 404, 409]) {
    let calls = 0;
    const rejectedInvite = createJoinWorkspaceInviteHandler({
      environment: environment(),
      fetch: async (url) => {
        calls += 1;
        return String(url).endsWith('/auth/v1/user')
          ? json({ id: userId, is_anonymous: true })
          : json({ safe: false }, status);
      },
    });
    const response = await rejectedInvite(request({ token }));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { status: 'invite_not_available' });
    assert.equal(calls, 2);
  }
  const malformed = createJoinWorkspaceInviteHandler({ environment: environment(), fetch: async () => { throw new Error('unexpected'); } });
  assert.equal((await malformed(request({ token: 'short' }))).status, 404);
});

test('invite revoke is creator-scoped at RPC boundary and returns safe output', async () => {
  const calls = [];
  const handler = createWorkspaceInvitesHandler({
    environment: environment(),
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return String(url).endsWith('/auth/v1/user')
        ? json({ id: userId, is_anonymous: true })
        : json(true);
    },
  });
  const response = await handler(request({ action: 'revoke', inviteId }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'revoked' });
  assert.deepEqual(Object.keys(JSON.parse(calls[1].options.body)).sort(), ['p_invite_id', 'p_user_id']);
});

test('legacy code endpoint is disabled and never reads a request body', async () => {
  const response = await createJoinWorkspaceHandler()(request({ code: 'legacy' }));
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), { status: 'invite_required', error: 'Используйте ссылку-приглашение.' });
});

test('migration materializes server-only catalog and transactional guards', async () => {
  const sql = await readFile(join(root, 'supabase/migrations/20260827_7615_workspace_invites.sql'), 'utf8');
  const assertions = [
    /create table public\.slogi_shared_workspace_invites/i,
    /enable row level security/i,
    /revoke all on public\.slogi_shared_workspace_invites\s+from public, anon, authenticated, service_role/i,
    /security definer[\s\S]*set search_path = pg_catalog, public/i,
    /for update of invite/i,
    /use_count >= v_invite\.max_uses/i,
    /revoked_at is not null/i,
    /expires_at <= statement_timestamp\(\)/i,
    /auth_user\.is_anonymous is true/i,
    /grant execute[\s\S]*to service_role/i,
    /revoke execute on function public\.slogi_join_shared_workspace_member/i,
  ];
  for (const pattern of assertions) assert.match(sql, pattern);
  assert.equal(/create policy[\s\S]*slogi_shared_workspace_invites/i.test(sql), false);
});

test('frontend scrubs fragment, has no manual code path, and never persists raw invites', async () => {
  const client = await readFile(join(root, 'shared-workspace.js'), 'utf8');
  const config = await readFile(join(root, 'phase0-config.js'), 'utf8');
  assert.match(client, /takeInviteFromFragment\(\)/);
  assert.match(client, /history\.replaceState/);
  assert.match(client, /Нужна ссылка-приглашение/);
  assert.match(client, /Пригласить коллегу/);
  assert.match(client, /navigator\.clipboard\.writeText/);
  assert.equal(/slogi-workspace-code|name=["']code["']|joinEndpoint/.test(client), false);
  assert.equal(/localStorage[^\n]*(inviteToken|pendingInviteToken|activeInvite)/.test(client), false);
  assert.equal(/sessionStorage[^\n]*(inviteToken|pendingInviteToken|activeInvite)/.test(client), false);
  assert.equal(/joinEndpoint/.test(config), false);
  assert.match(config, /inviteJoinEndpoint/);
  assert.match(config, /inviteManageEndpoint/);
});
