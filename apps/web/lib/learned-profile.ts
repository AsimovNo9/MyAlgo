import type { FeedActivitySignal, FeedCandidate, FeedFeedbackSignal } from './feed.ts';

export type LearnedAffinityProfile = {
  topics: Map<string, number>;
  channels: Map<string, number>;
  formats: Map<string, number>;
  languages: Map<string, number>;
  sources: Map<string, number>;
};

export type PersistedAffinityRow = {
  facet: 'topic' | 'channel' | 'format' | 'language' | 'source';
  facet_key: string;
  signed_value: number;
  confidence: number;
  evidence_count: number;
  first_observed_at: string;
  last_observed_at: string;
  source_signals: string[];
  profile_revision: string;
};

type AffinityContribution = { facet: PersistedAffinityRow['facet']; key: string; value: number };

const emptyProfile = (): LearnedAffinityProfile => ({
  topics: new Map(),
  channels: new Map(),
  formats: new Map(),
  languages: new Map(),
  sources: new Map(),
});

function addSignal(map: Map<string, number>, key: string | null | undefined, value: number) {
  const normalized = key?.trim().toLowerCase();
  if (!normalized) return;
  map.set(normalized, Math.max(-1, Math.min(1, (map.get(normalized) ?? 0) + value)));
}

function signalValue(eventType: FeedFeedbackSignal['eventType']): number {
  return eventType === 'more_like_this' ? 1 : -1;
}

function activityValue(signal: FeedActivitySignal): number {
  if (signal.eventType === 'completed') return 0.7;
  if (signal.eventType === 'revisited') return 0.3;
  if (signal.eventType === 'opened') return 0.12;
  if (signal.eventType === 'skipped') return -0.45;
  return Math.min(0.5, Math.max(0, Number(signal.watchSeconds ?? 0) / 600));
}

function addCandidateAffinity(profile: LearnedAffinityProfile, candidate: FeedCandidate, strength: number) {
  for (const contribution of getAffinityContributions(candidate, strength)) {
    const map = contribution.facet === 'topic'
      ? profile.topics
      : contribution.facet === 'channel'
        ? profile.channels
        : contribution.facet === 'format'
          ? profile.formats
          : contribution.facet === 'language'
            ? profile.languages
            : profile.sources;
    addSignal(map, contribution.key, contribution.value);
  }
}

function getAffinityContributions(candidate: FeedCandidate, strength: number): AffinityContribution[] {
  return [
    ...(candidate.topics ?? []).map((topic) => ({ facet: 'topic' as const, key: topic, value: strength * 0.35 })),
    { facet: 'channel', key: candidate.channel_id ?? candidate.channel_name ?? '', value: strength * 0.5 },
    { facet: 'format', key: candidate.format ?? '', value: strength * 0.4 },
    { facet: 'language', key: candidate.language ?? '', value: strength * 0.4 },
    { facet: 'source', key: candidate.source_kind ?? '', value: strength * 0.25 },
  ];
}

export function buildPersistedAffinityRows(
  candidates: FeedCandidate[],
  signals: FeedFeedbackSignal[],
  activitySignals: FeedActivitySignal[] = [],
  profileRevision = new Date().toISOString(),
): PersistedAffinityRow[] {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.external_id, candidate]));
  const rows = new Map<string, PersistedAffinityRow>();

  const record = (candidate: FeedCandidate, strength: number, sourceSignal: string, observedAt?: string | null) => {
    const timestamp = observedAt ?? profileRevision;
    for (const contribution of getAffinityContributions(candidate, strength)) {
      const key = contribution.key.trim().toLowerCase();
      if (!key) continue;
      const rowKey = `${contribution.facet}:${key}`;
      const existing = rows.get(rowKey) ?? {
        facet: contribution.facet,
        facet_key: key,
        signed_value: 0,
        confidence: 0,
        evidence_count: 0,
        first_observed_at: timestamp,
        last_observed_at: timestamp,
        source_signals: [],
        profile_revision: profileRevision,
      };
      existing.signed_value = Math.max(-1, Math.min(1, existing.signed_value + contribution.value));
      existing.evidence_count += 1;
      existing.confidence = Number(Math.min(1, Math.abs(existing.signed_value)).toFixed(4));
      existing.first_observed_at = timestamp < existing.first_observed_at ? timestamp : existing.first_observed_at;
      existing.last_observed_at = timestamp > existing.last_observed_at ? timestamp : existing.last_observed_at;
      if (!existing.source_signals.includes(sourceSignal)) existing.source_signals.push(sourceSignal);
      rows.set(rowKey, existing);
    }
  };

  for (const candidate of candidates) {
    if (candidate.source_kind === 'liked') record(candidate, 0.6, 'liked');
  }
  for (const signal of signals) {
    const candidate = candidatesById.get(signal.external_id);
    if (candidate) record(candidate, signalValue(signal.eventType), signal.eventType, signal.createdAt);
  }
  for (const signal of activitySignals) {
    const candidate = candidatesById.get(signal.external_id);
    if (candidate) record(candidate, activityValue(signal), signal.eventType, signal.occurredAt);
  }

  return [...rows.values()];
}

export function learnedAffinityProfileFromRows(rows: Array<Pick<PersistedAffinityRow, 'facet' | 'facet_key' | 'signed_value'>>): LearnedAffinityProfile {
  const profile = emptyProfile();
  for (const row of rows) {
    const map = row.facet === 'topic'
      ? profile.topics
      : row.facet === 'channel'
        ? profile.channels
        : row.facet === 'format'
          ? profile.formats
          : row.facet === 'language'
            ? profile.languages
            : profile.sources;
    map.set(row.facet_key, Math.max(-1, Math.min(1, row.signed_value)));
  }
  return profile;
}

export function buildLearnedAffinityProfile(
  candidates: FeedCandidate[],
  signals: FeedFeedbackSignal[],
  activitySignals: FeedActivitySignal[] = [],
): LearnedAffinityProfile {
  const profile = emptyProfile();
  const candidatesById = new Map(candidates.map((candidate) => [candidate.external_id, candidate]));

  for (const candidate of candidates) {
    if (candidate.source_kind === 'liked') {
      addCandidateAffinity(profile, candidate, 0.6);
    }
  }

  for (const signal of signals) {
    const candidate = candidatesById.get(signal.external_id);
    const value = signalValue(signal.eventType);
    if (!candidate) continue;

    addCandidateAffinity(profile, candidate, value);
  }

  for (const signal of activitySignals) {
    const candidate = candidatesById.get(signal.external_id);
    if (!candidate) continue;
    addCandidateAffinity(profile, candidate, activityValue(signal));
  }

  return profile;
}

export function getCandidateLearnedAffinity(
  profile: LearnedAffinityProfile,
  candidate: FeedCandidate,
): number {
  const topicAffinity = (candidate.topics ?? []).reduce(
    (sum, topic) => sum + (profile.topics.get(topic.trim().toLowerCase()) ?? 0),
    0,
  );
  const channelKey = (candidate.channel_id ?? candidate.channel_name ?? '').trim().toLowerCase();
  const channelAffinity = profile.channels.get(channelKey) ?? 0;
  const formatAffinity = profile.formats.get(candidate.format?.trim().toLowerCase() ?? '') ?? 0;
  const languageAffinity = profile.languages.get(candidate.language?.trim().toLowerCase() ?? '') ?? 0;
  const sourceAffinity = profile.sources.get(candidate.source_kind?.trim().toLowerCase() ?? '') ?? 0;

  return Math.max(-1, Math.min(1, topicAffinity + channelAffinity + formatAffinity + languageAffinity + sourceAffinity));
}

export function getStrongChannelAffinityTerms(profile: LearnedAffinityProfile, threshold = 0.25): string[] {
  return [...profile.channels.entries()]
    .filter(([, value]) => value >= threshold)
    .sort((left, right) => right[1] - left[1])
    .map(([channel]) => channel);
}
