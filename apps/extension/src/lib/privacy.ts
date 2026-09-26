export const PRIVACY_DISCLOSURE_VERSION = 3;

export const PRIVACY_DISCLOSURE = {
  pages: 'YouTube pages you visit while MyAlgo is enabled',
  data: 'visible video IDs, titles, creators, feed/history context, playback progress, selections, explicit feedback, and—when optional discovery is enabled—bounded YouTube channel IDs plus graph-derived search terms',
  purpose: 'build your local Personal Algorithm Graph, acquire optional RSS/web-search candidates, score candidates, explain decisions, and enforce your feed controls',
  storage: 'stored in chrome.storage.local in this browser',
  transfer: 'MyAlgo does not send observed activity, evidence, graph state, or scoring traces to a MyAlgo server; optional RSS uses YouTube feeds, and optional web discovery sends only bounded graph-derived goal/topic queries plus mode intent to YouTube search pages',
  deletion: 'you can pause observation or delete all locally stored MyAlgo data from Settings',
} as const;

export function isPrivacyDisclosureAccepted(value: unknown): boolean {
  return value === PRIVACY_DISCLOSURE_VERSION;
}
