import type { FeedCandidate, FeedFeedbackSignal } from './feed.ts';

export type LearnedAffinityProfile = {
  topics: Map<string, number>;
  channels: Map<string, number>;
  formats: Map<string, number>;
  languages: Map<string, number>;
  sources: Map<string, number>;
};

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

function addCandidateAffinity(profile: LearnedAffinityProfile, candidate: FeedCandidate, strength: number) {
  for (const topic of candidate.topics ?? []) addSignal(profile.topics, topic, strength * 0.35);
  addSignal(profile.channels, candidate.channel_id ?? candidate.channel_name, strength * 0.5);
  addSignal(profile.formats, candidate.format, strength * 0.4);
  addSignal(profile.languages, candidate.language, strength * 0.4);
  addSignal(profile.sources, candidate.source_kind, strength * 0.25);
}

export function buildLearnedAffinityProfile(
  candidates: FeedCandidate[],
  signals: FeedFeedbackSignal[],
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
