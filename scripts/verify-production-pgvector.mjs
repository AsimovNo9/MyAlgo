import { loadEnvFile } from './load-env-file.mjs';

loadEnvFile(new URL('../apps/web/.env.local', import.meta.url));

const baseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!baseUrl || !serviceRoleKey) {
  console.error('Production pgvector verification requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
};

async function checkTable(table) {
  const response = await fetch(`${baseUrl}/rest/v1/${table}?select=*&limit=1`, { headers });
  return { name: table, status: response.status, ok: response.ok };
}

const checks = await Promise.all([
  checkTable('concept_entries'),
  checkTable('concept_relations'),
  checkTable('content_concepts'),
  checkTable('content_embeddings'),
  checkTable('concept_embeddings'),
]);

const vectorResponse = await fetch(`${baseUrl}/rest/v1/rpc/match_content_embeddings`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    query_embedding: Array.from({ length: 1536 }, () => 0),
    match_threshold: 1,
    match_count: 1,
    requested_model_version: null,
  }),
});
checks.push({ name: 'match_content_embeddings', status: vectorResponse.status, ok: vectorResponse.ok });

for (const check of checks) {
  console.log(`${check.name}: ${check.ok ? 'PASS' : 'FAIL'} (${check.status})`);
}

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  console.error(`Production pgvector verification failed for ${failed.length} check(s).`);
  process.exit(1);
}

console.log('Production pgvector tables and RPC are available.');
