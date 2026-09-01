import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migration = read('supabase/migrations/20260829_7618_cian_bounded_revalidation.sql');

test('historical queue migration is frozen and the forward migration replaces only enqueue and claim', () => {
  const historical = read('supabase/migrations/20260821_7610_listing_refresh.sql');
  assert.equal(createHash('sha256').update(historical).digest('hex'), 'efdeb03e49eb8ae93b19ab4fdf0000f2d2b47e45368e68a1f1cdf227fd820f25');
  assert.deepEqual(
    [...migration.matchAll(/create or replace function public\.(\w+)/g)].map((match) => match[1]),
    ['slogi_enqueue_listing_fetches', 'slogi_claim_listing_fetch_queue'],
  );
  assert.doesNotMatch(migration, /\b(?:alter|create|drop)\s+table\b|\bcreate\s+(?:unique\s+)?index\b/i);
});

test('rediscovery updates observations only and never requeues lifecycle state', () => {
  const existingUpdate = migration.match(/update public\.slogi_listing_fetch_queue as q\s+set([\s\S]*?)where q\.source = p_source and q\.listing_url = v_url/i)?.[1] || '';
  assert.match(existingUpdate, /external_id\s*=/);
  assert.match(existingUpdate, /priority\s*=\s*p_priority/);
  assert.match(existingUpdate, /last_discovered_at\s*=\s*p_discovered_at/);
  assert.doesNotMatch(existingUpdate, /\b(?:status|next_attempt_at|locked_at|locked_by|completed_at|attempt_count|last_attempt_at)\s*=/);
});

test('claim contract serializes zero-backlog activation and resets only a new terminal cycle', () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /status = any \(array\['pending'::text, 'retry'::text, 'processing'::text\]\)/);
  assert.match(migration, /if v_has_nonterminal then[\s\S]*status = any \(array\['pending'::text, 'retry'::text\]\)[\s\S]*attempt_count = q\.attempt_count \+ 1/);
  assert.match(migration, /completed_at <= p_claimed_at - interval '24 hours'[\s\S]*last_discovered_at > q\.completed_at/);
  assert.match(migration, /discarded_unknown_date[\s\S]*interval '7 days'[\s\S]*last_discovered_at > q\.last_attempt_at/);
  assert.match(migration, /discarded_old[\s\S]*q\.priority = 'hot'[\s\S]*interval '7 days'/);
  assert.match(migration, /status = any \(array\['failed'::text, 'blocked'::text\]\)[\s\S]*interval '24 hours'[\s\S]*next_attempt_at <= p_claimed_at/);
  assert.match(migration, /order by case q\.priority when 'hot' then 0 else 1 end, q\.last_attempt_at, q\.id/);
  assert.match(migration, /attempt_count = 1/);
  assert.equal((migration.match(/for update skip locked/g) || []).length, 2);
  assert.equal((migration.match(/least\(2,/g) || []).length, 1);
});

test('queue RPCs retain owner, fixed search_path and service-role-only execute ACL', () => {
  for (const name of ['slogi_enqueue_listing_fetches', 'slogi_claim_listing_fetch_queue']) {
    assert.match(migration, new RegExp(`create or replace function public\\.${name}[\\s\\S]*?security definer[\\s\\S]*?set search_path = pg_catalog, public`, 'i'));
    assert.match(migration, new RegExp(`alter function public\\.${name}\\([^;]+\\) owner to postgres`, 'i'));
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}\\([^;]+\\)[\\s\\S]*?from public, anon, authenticated, service_role`, 'i'));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}\\([^;]+\\)[\\s\\S]*?to service_role`, 'i'));
  }
});

test('refresh observability calls known URLs observedExisting without implying queue delta', () => {
  const source = read('supabase/functions/refresh-listings/index.ts');
  assert.match(source, /observedExisting/);
  assert.doesNotMatch(source, /queuedExisting/);
  assert.match(source, /queued_existing:\s*counts\.observedExisting/);
});

test('static provider budget remains at most 14 Browserless calls per UTC day', () => {
  const refresh = read('supabase/functions/refresh-listings/index.ts');
  const hydrate = read('supabase/functions/hydrate-listings/index.ts');
  const number = (source, name) => Number(source.match(new RegExp(`${name}:\\s*(\\d+)`))?.[1]);
  const discovery = (24 / number(refresh, 'runSlotHours')) * number(refresh, 'browserlessCalls');
  const hydration = (24 * 60 / number(hydrate, 'runSlotMinutes')) * number(hydrate, 'hardBatch') * number(hydrate, 'browserlessCallsPerItem');
  assert.equal(discovery, 2);
  assert.equal(hydration, 12);
  assert.equal(discovery + hydration, 14);
});

test('daily discovery and two-hourly single hydration converge without requeue growth', () => {
  const rows = Array.from({ length: 48 }, (_, id) => ({ id, status: 'pending', attempts: 0, completedHour: null, observedHour: 0 }));
  const backlog = [];
  let maxActivatedAfterDrain = 0;
  for (let hour = 0; hour <= 96; hour += 1) {
    if (hour % 24 === 0) {
      for (const row of rows.slice(0, 27)) row.observedHour = hour;
    }
    const nonterminal = rows.filter((row) => row.status === 'pending' || row.status === 'retry' || row.status === 'processing');
    let claimed = hour % 2 === 0
      ? nonterminal.filter((row) => row.status === 'pending' || row.status === 'retry').slice(0, 1)
      : [];
    if (!nonterminal.length) {
      claimed = rows
        .filter((row) => row.status === 'completed' && hour - row.completedHour >= 24 && row.observedHour > row.completedHour)
        .sort((left, right) => left.completedHour - right.completedHour || left.id - right.id)
        .slice(0, 1);
      maxActivatedAfterDrain = Math.max(maxActivatedAfterDrain, claimed.length);
      for (const row of claimed) row.attempts = 0;
    }
    for (const row of claimed) {
      row.status = 'processing';
      row.attempts += 1;
      row.status = 'completed';
      row.completedHour = hour;
    }
    backlog.push(rows.filter((row) => row.status === 'pending' || row.status === 'retry' || row.status === 'processing').length);
  }
  assert.deepEqual(backlog.slice(0, 10), [47,47,46,46,45,45,44,44,43,43]);
  assert.ok(backlog.slice(94).every((value) => value === 0));
  assert.equal(maxActivatedAfterDrain, 1);
  assert.equal(rows.length, 48);
});
