import { loadEnvFile } from './load-env-file.mjs';

loadEnvFile(new URL('../apps/web/.env.local', import.meta.url));

const baseUrl = (process.env.DEPLOYMENT_URL ?? 'https://my-algo-web.vercel.app').replace(/\/$/, '');
const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();

if (!accessToken) {
  console.error('Production baseline requires SUPABASE_ACCESS_TOKEN; no token was supplied.');
  process.exit(2);
}

const headers = { Authorization: `Bearer ${accessToken}` };
const feedResponse = await fetch(`${baseUrl}/api/feed`, { headers });
if (!feedResponse.ok) {
  console.error(`Feed baseline request failed with status ${feedResponse.status}.`);
  process.exit(1);
}

const feed = await feedResponse.json();
const items = Array.isArray(feed.items) ? feed.items : [];
const metrics = feed.metrics && typeof feed.metrics === 'object' ? feed.metrics : {};
const visible = items.filter((item) => item.visible !== false);
const lanes = Object.fromEntries(['matched', 'discovery', 'explore'].map((lane) => [lane, visible.filter((item) => item.lane === lane).length]));
const sources = Object.fromEntries([...new Set(visible.map((item) => item.source_kind ?? 'unknown'))].map((source) => [source, visible.filter((item) => (item.source_kind ?? 'unknown') === source).length]));
const channels = new Set(visible.map((item) => item.channel_id ?? item.channel_name ?? '').filter(Boolean));
const watchedReasons = items.filter((item) => /already watched/i.test(item.reason ?? '')).length;
const semanticMatches = visible.filter((item) => /semantically close/i.test(item.reason ?? '')).length;
const topicCoverage = metrics.topicCoverage && typeof metrics.topicCoverage === 'object' ? metrics.topicCoverage : {};
const qualifiedCandidateRate = Number.isFinite(Number(metrics.candidateCount)) && Number(metrics.candidateCount) > 0
  ? Number((visible.length / Number(metrics.candidateCount)).toFixed(4))
  : 0;

const rankResponse = await fetch(`${baseUrl}/api/rank`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mode: 'Work',
    candidates: [
      { external_id: 'baseline-1', title: 'AI systems engineering tutorial', channel_name: 'Baseline Channel' },
      { external_id: 'baseline-2', title: 'Unrelated celebrity gossip recap', channel_name: 'Baseline Channel' },
    ],
  }),
});

console.log(JSON.stringify({
  deployment: baseUrl,
  feedStatus: feedResponse.status,
  rankStatus: rankResponse.status,
  candidateCount: items.length,
  visibleCount: visible.length,
  hiddenCount: items.length - visible.length,
  lanes,
  sources,
  channelDiversity: channels.size,
  watchedExclusionsReported: watchedReasons,
  relevantCandidateRate: qualifiedCandidateRate,
  qualifiedCandidateRate,
  semanticRetrievalHitRate: visible.length > 0 ? Number((semanticMatches / visible.length).toFixed(4)) : 0,
  topicCoverage,
}, null, 2));

if (!rankResponse.ok) process.exit(1);
