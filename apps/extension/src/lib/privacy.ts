export const PRIVACY_DISCLOSURE_VERSION = 2;

export const PRIVACY_DISCLOSURE = {
  pages: 'YouTube pages you visit while MyAlgo is enabled',
  data: 'visible video IDs, titles, creators, feed/history context, playback progress, selections, explicit feedback, and—when RSS discovery is enabled—recently observed YouTube channel IDs used to request YouTube RSS updates',
  purpose: 'build your local Personal Algorithm Graph, acquire optional RSS candidates, score candidates, explain decisions, and enforce your feed controls',
  storage: 'stored in chrome.storage.local in this browser',
  transfer: 'MyAlgo does not send observed activity, evidence, graph state, or scoring traces to a MyAlgo server; optional RSS discovery sends only bounded channel-feed requests to YouTube-owned HTTPS endpoints',
  deletion: 'you can pause observation or delete all locally stored MyAlgo data from Settings',
} as const;

export function isPrivacyDisclosureAccepted(value: unknown): boolean {
  return value === PRIVACY_DISCLOSURE_VERSION;
}
