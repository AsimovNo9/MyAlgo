import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.join(packageDirectory, 'schema.sql'), 'utf8');
const semanticMigration = fs.readFileSync(
  path.join(packageDirectory, '../../supabase/migrations/20260919011000_add_semantic_intent_tables.sql'),
  'utf8',
);
const seedChannelsMigration = fs.readFileSync(
  path.join(packageDirectory, '../../supabase/migrations/20260920000000_add_topic_seed_channels.sql'),
  'utf8',
);
const seedDiscoveryMigration = fs.readFileSync(
  path.join(packageDirectory, '../../supabase/migrations/20260920010000_add_seed_channel_discovery_review.sql'),
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

test('topic seed channels table is present in the tracked migration with a unique topic+channel constraint', () => {
  assert.match(seedChannelsMigration, /create table if not exists public\.topic_seed_channels/i);
  assert.match(seedChannelsMigration, /alter table public\.topic_seed_channels enable row level security/i);
  assert.match(seedChannelsMigration, /unique \(topic, channel_id\)/i);
});

test('seed channel discovery review metadata is tracked', () => {
  assert.match(seedDiscoveryMigration, /add column if not exists status/i);
  assert.match(seedDiscoveryMigration, /pending.*approved.*rejected/i);
  assert.match(seedDiscoveryMigration, /confidence numeric/i);
});

test('schema enables RLS and defines a policy for every application table', () => {
  const applicationTables = [...schema.matchAll(/create table(?: if not exists)? public\.([a-z_][a-z0-9_]*)/gi)]
    .map((match) => match[1]);

  assert.ok(applicationTables.length > 0, 'schema must define application tables');

  for (const table of applicationTables) {
    const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(schema, new RegExp(`alter table public\\.${escapedTable}\\s+enable\\s+row level security\\b`, 'i'), `${table} must enable RLS`);
    assert.match(schema, new RegExp(`create policy [^\\n]+ on public\\.${escapedTable}(?=\\s|$)`, 'i'), `${table} must define a policy`);
  }
});
