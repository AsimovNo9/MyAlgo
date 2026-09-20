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

export function buildLearnedAffinityProfile(
  candidates: FeedCandidate[],
  signals: FeedFeedbackSignal[],
): LearnedAffinityProfile {
  const profile = emptyProfile();
  const candidatesById = new Map(candidates.map((candidate) => [candidate.external_id, candidate]));

  for (const signal of signals) {
    const candidate = candidatesById.get(signal.external_id);
    const value = signalValue(signal.eventType);
    if (!candidate) continue;

    for (const topic of candidate.topics ?? []) addSignal(profile.topics, topic, value * 0.35);
    addSignal(profile.channels, candidate.channel_id ?? candidate.channel_name, value * 0.5);
    addSignal(profile.formats, candidate.format, value * 0.4);
    addSignal(profile.languages, candidate.language, value * 0.4);
    addSignal(profile.sources, candidate.source_kind, value * 0.25);
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
