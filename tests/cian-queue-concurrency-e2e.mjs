import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';

assert.equal(process.env.SLOGI_QUEUE_CONCURRENCY_TEST_MODE, 'on', 'queue_concurrency_test_mode_required');
const container = String(process.env.SLOGI_QUEUE_DB_CONTAINER || '');
assert.match(container, /^supabase_db_[a-z0-9._-]+$/i, 'isolated_supabase_db_container_required');

const base = ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'];
const run = (sql) => execFileSync('docker', [...base, '-c', sql], { encoding: 'utf8', windowsHide: true });
const claim = (worker) => new Promise((resolve, reject) => {
  const sql = `select id from public.slogi_claim_listing_fetch_queue('cian','${worker}',2,'2026-08-29 00:00Z','2026-08-28 23:00Z');`;
  const child = spawn('docker', [...base, '-c', sql], { windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', (code) => code === 0 ? resolve(stdout.trim().split(/\s+/).filter(Boolean)) : reject(new Error(stderr || `claim_exit_${code}`)));
});

const seed = `
  truncate table public.slogi_listing_fetch_queue restart identity;
  insert into public.slogi_listing_fetch_queue (
    source, listing_url, priority, status, discovered_at, last_discovered_at,
    next_attempt_at, attempt_count, last_attempt_at, completed_at
  )
  select
    'cian', 'https://www.cian.ru/rent/commercial/' || (700000000 + n)::text,
    'hot', 'completed', '2026-08-27 00:00Z', '2026-08-28 01:00Z',
    '2026-08-28 00:00Z', 9, '2026-08-28 00:00Z', '2026-08-28 00:00Z'
  from pg_catalog.generate_series(1, 4) as n;
`;

try {
  run(seed);
  const [left, right] = await Promise.all([
    claim('77777777-7777-4777-8777-777777777777'),
    claim('88888888-8888-4888-8888-888888888888'),
  ]);
  const claimed = [...left, ...right];
  assert.equal(claimed.length, 2, 'concurrent callers activated more than one bounded batch');
  assert.equal(new Set(claimed).size, 2, 'concurrent callers returned a duplicate row');
  assert.deepEqual([left.length, right.length].sort((a, b) => a - b), [0, 2]);
  assert.equal(
    run(`select
      count(*) filter (where status='processing'),
      count(distinct locked_by) filter (where status='processing'),
      count(*) filter (where status='completed'),
      min(attempt_count) filter (where status='processing'),
      max(attempt_count) filter (where status='processing')
    from public.slogi_listing_fetch_queue;`).trim(),
    '2|1|2|1|1',
  );
  console.log('concurrent queue claims: PASS (2 + 0, unique=2)');
} finally {
  run('truncate table public.slogi_listing_fetch_queue restart identity;');
}
