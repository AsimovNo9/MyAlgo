export const PRIVACY_DISCLOSURE_VERSION = 1;

export const PRIVACY_DISCLOSURE = {
  pages: 'YouTube pages you visit while MyAlgo is enabled',
  data: 'visible video IDs, titles, creators, feed/history context, playback progress, selections, and explicit feedback',
  purpose: 'build your local Personal Algorithm Graph, score visible candidates, explain decisions, and enforce your feed controls',
  storage: 'stored in chrome.storage.local in this browser',
  transfer: 'MyAlgo does not send observed activity, evidence, graph state, or scoring traces to a MyAlgo server or other third party in the local-only MVP',
  deletion: 'you can pause observation or delete all locally stored MyAlgo data from Settings',
} as const;

export function isPrivacyDisclosureAccepted(value: unknown): boolean {
  return value === PRIVACY_DISCLOSURE_VERSION;
}
