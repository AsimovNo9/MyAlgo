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
const discoveryRunsMigration = fs.readFileSync(
  path.join(packageDirectory, '../../supabase/migrations/20260920020000_add_topic_discovery_runs.sql'),
  'utf8',
);
const algorithmConsistencyMigration = fs.readFileSync(
  path.join(packageDirectory, '../../supabase/migrations/20260920030000_enforce_algorithm_consistency.sql'),
  'utf8',
);
const retrievalPreferencesMigration = fs.readFileSync(
  path.join(packageDirectory, '../../supabase/migrations/20260920040000_add_algorithm_retrieval_preferences.sql'),
  'utf8',
);
const classificationFacetsMigration = fs.readFileSync(
  path.join(packageDirectory, '../../supabase/migrations/20260920050000_add_classification_facets.sql'),
  'utf8',
);
const likedContentSourceMigration = fs.readFileSync(
  path.join(packageDirectory, '../../supabase/migrations/20260920060000_add_liked_content_source.sql'),
  'utf8',
);
const activityEventsMigration = fs.readFileSync(
  path.join(packageDirectory, '../../supabase/migrations/20260920070000_add_activity_events.sql'),
  'utf8',
);
const classificationConfidenceMigration = fs.readFileSync(
  path.join(packageDirectory, '../../supabase/migrations/20260920080000_add_classification_confidence.sql'),
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

test('topic discovery runs are tracked for shared cold-start deduplication', () => {
  assert.match(discoveryRunsMigration, /create table if not exists public\.topic_discovery_runs/i);
  assert.match(discoveryRunsMigration, /topic text primary key/i);
  assert.match(discoveryRunsMigration, /enable row level security/i);
});

test('algorithm consistency migration deduplicates names and enforces one active row', () => {
  assert.match(algorithmConsistencyMigration, /partition by user_id, lower\(btrim\(name\)\)/i);
  assert.match(algorithmConsistencyMigration, /algorithms_one_name_per_user/i);
  assert.match(algorithmConsistencyMigration, /algorithms_one_active_per_user/i);
});

test('algorithm retrieval preferences are tracked in schema and migration', () => {
  assert.match(schema, /language text/i);
  assert.match(schema, /preferred_formats text\[\] not null default '\{\}'/i);
  assert.match(retrievalPreferencesMigration, /add column if not exists language text/i);
  assert.match(retrievalPreferencesMigration, /add column if not exists preferred_formats text\[\] not null default '\{\}'/i);
});

test('classification language and format facets are tracked in schema and migration', () => {
  assert.match(schema, /create table public\.classifications[\s\S]*language text/i);
  assert.match(schema, /create table public\.classifications[\s\S]*format text/i);
  assert.match(classificationFacetsMigration, /add column if not exists language text/i);
  assert.match(classificationFacetsMigration, /add column if not exists format text/i);
});

test('liked content source is tracked in schema and migration', () => {
  assert.match(schema, /source_kind text not null default 'subscription' check \(source_kind in \('subscription', 'discovery', 'liked'\)\)/i);
  assert.match(likedContentSourceMigration, /source_kind in \('subscription', 'discovery', 'liked'\)/i);
});

test('activity events are tracked with bounded watch duration and RLS', () => {
  assert.match(schema, /create table public\.activity_events[\s\S]*watch_seconds integer[\s\S]*enable row level security/i);
  assert.match(activityEventsMigration, /create table if not exists public\.activity_events/i);
  assert.match(activityEventsMigration, /watch_seconds integer check/i);
  assert.match(activityEventsMigration, /enable row level security/i);
});

test('classification confidence is bounded and tracked in schema and migration', () => {
  assert.match(schema, /confidence numeric check \(confidence is null or \(confidence >= 0 and confidence <= 1\)\)/i);
  assert.match(classificationConfidenceMigration, /add column if not exists confidence numeric/i);
  assert.match(classificationConfidenceMigration, /confidence >= 0 and confidence <= 1/i);
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
