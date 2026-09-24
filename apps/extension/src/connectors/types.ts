export type ProviderCapabilities = {
  search: boolean;
  activity: boolean;
  subscriptions: boolean;
  writeActions: boolean;
  publicContent: boolean;
  userContent: boolean;
};

export type ProviderPresentationContract = {
  candidateLimit: number;
  minimumVisibleScore: number;
  shelfBatchSize: number;
  shelfDomLimit: number;
  horizontalAspectRatio: `${number} / ${number}`;
  verticalAspectRatio: `${number} / ${number}`;
};

export interface PageProviderConnector {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  readonly pageUrlPatterns: readonly string[];
  readonly sync?: {
    alarmName: string;
    path: string;
    periodMinutes: number;
    initialDelayMinutes: number;
  };
  readonly cardSelectors: readonly string[];
  readonly titleSelectors: readonly string[];
  readonly videoLinkSelector: string;
  readonly presentation: ProviderPresentationContract;
  canHandleUrl(href: string): boolean;
  getExternalId(href: string): string | undefined;
  getCanonicalUrl(externalId: string): string;
  getSourceFlags(href: string): { is_short: boolean; is_live: boolean };
  normalizeText(value: string): string;
  getLinkTitle(attributes: { title?: string | null; ariaLabel?: string | null; textContent?: string | null }): string;
  mapPresentationEvent(event: 'opened' | 'revisited'): 'opened' | 'revisited';
}
