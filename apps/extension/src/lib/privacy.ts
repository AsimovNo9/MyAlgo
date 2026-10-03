export const PRIVACY_DISCLOSURE_VERSION = 7;

export const PRIVACY_DISCLOSURE = {
  pages: 'YouTube pages you visit while MyAlgo is enabled',
  data: 'visible video IDs, titles, creators, feed/history context, playback progress, selections, explicit feedback, locally extracted semantic concepts, locally derived semantic vectors/similarities, optional bounded YouTube caption excerpts used for local semantic enrichment, and—when optional discovery is enabled—bounded YouTube channel IDs plus graph-derived search terms',
  purpose: 'build your local Personal Algorithm Graph, optionally enrich video semantics from YouTube captions, acquire optional RSS/web-search candidates, score candidates, explain decisions, and enforce your feed controls',
  storage: 'stored in chrome.storage.local in this browser',
  transfer: 'MyAlgo does not send observed activity, evidence, graph state, embeddings, scoring traces, candidate text, captions, history, or feedback to a MyAlgo server or model host; optional transcript enrichment requests an available caption track from YouTube-owned endpoints and stores only a bounded excerpt locally; optional RSS uses YouTube feeds and optional web discovery sends only bounded graph-derived goal/topic queries plus mode intent to YouTube search pages; the optional embedding and concept-extraction models plus runtime are packaged with the extension and inference stays local',
  deletion: 'you can pause observation or delete all locally stored MyAlgo data from Settings',
} as const;

export function isPrivacyDisclosureAccepted(value: unknown): boolean {
  return value === PRIVACY_DISCLOSURE_VERSION;
}
