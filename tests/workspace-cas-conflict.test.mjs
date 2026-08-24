import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const original = await readFile(join(root, 'supabase/migrations/20260823_7611_shared_workspace.sql'), 'utf8');
const hotfix = await readFile(join(root, 'supabase/migrations/20260824_7612_workspace_cas_conflict.sql'), 'utf8');
const client = await readFile(join(root, 'shared-workspace.js'), 'utf8');

const checks = [
  ['original migration remains the immutable 40001 snapshot', /errcode\s*=\s*'40001'/.test(original)],
  ['hotfix uses explicit PostgREST 409', /errcode\s*=\s*'PT409'/.test(hotfix)],
  ['hotfix does not use serialization failure', !/errcode\s*=\s*'40001'/.test(hotfix)],
  ['security definer is preserved', /security\s+definer/i.test(hotfix)],
  ['fixed search_path is preserved', /set\s+search_path\s*=\s*pg_catalog,\s*public/i.test(hotfix)],
  ['authenticated-only execute contract is materialized', /revoke\s+all[\s\S]*from\s+public,\s*anon,\s*authenticated,\s*service_role;[\s\S]*grant\s+execute[\s\S]*to\s+authenticated;/i.test(hotfix)],
  ['browser client recognizes HTTP 409 conflicts', /response\.status\s*===\s*409/.test(client)],
];

for (const [name, passed] of checks) assert.equal(passed, true, name);
console.log(`workspace CAS conflict regression: ${checks.length}/${checks.length} PASS`);
