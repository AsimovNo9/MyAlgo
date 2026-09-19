import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const schema = fs.readFileSync(path.join(process.cwd(), 'packages/db/schema.sql'), 'utf8');
const semanticMigration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260919011000_add_semantic_intent_tables.sql'),
  'utf8',
);

test('classifications table has a unique constraint on content_item_id for upserts', () => {
  assert.match(schema, /create unique index .*public\.classifications.*content_item_id/i);
});

test('semantic intent tables are present in the tracked migration', () => {
  assert.match(semanticMigration, /create table if not exists public\.concept_entries/i);
  assert.match(semanticMigration, /create table if not exists public\.algorithm_intent_profiles/i);
  assert.match(semanticMigration, /alter table public\.concept_entries enable row level security/i);
  assert.match(semanticMigration, /alter table public\.algorithm_intent_profiles enable row level security/i);
});
