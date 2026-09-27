export const PRIVACY_DISCLOSURE_VERSION = 5;

export const PRIVACY_DISCLOSURE = {
  pages: 'YouTube pages you visit while MyAlgo is enabled',
  data: 'visible video IDs, titles, creators, feed/history context, playback progress, selections, explicit feedback, locally derived semantic vectors/similarities, and—when optional discovery is enabled—bounded YouTube channel IDs plus graph-derived search terms',
  purpose: 'build your local Personal Algorithm Graph, acquire optional RSS/web-search candidates, score candidates, explain decisions, and enforce your feed controls',
  storage: 'stored in chrome.storage.local in this browser',
  transfer: 'MyAlgo does not send observed activity, evidence, graph state, embeddings, scoring traces, candidate text, history, or feedback to a MyAlgo server or model host; optional RSS uses YouTube feeds and optional web discovery sends only bounded graph-derived goal/topic queries plus mode intent to YouTube search pages; the optional neural model and runtime are packaged with the extension and inference stays local',
  deletion: 'you can pause observation or delete all locally stored MyAlgo data from Settings',
} as const;

export function isPrivacyDisclosureAccepted(value: unknown): boolean {
  return value === PRIVACY_DISCLOSURE_VERSION;
}
