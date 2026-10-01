export const STORAGE_KEYS = {
  MODE: 'personal-algorithm-mode',
  ACTIVE_MODE_ID: 'personal-algorithm-active-mode-id',
  ACTIVE_MODE_IDS: 'personal-algorithm-active-mode-ids',
  DURABLE_MODE_CATALOG: 'personal-algorithm-durable-mode-catalog',
  DURABLE_MODE_DIAGNOSTICS: 'personal-algorithm-durable-mode-diagnostics',
  ENABLED: 'personal-algorithm-enabled',
  FEED_CACHE: 'personal-algorithm-feed-cache',
  PRESENTATION_CACHE: 'personal-algorithm-presentation-cache',
  FEED_CANDIDATE_POOL: 'personal-algorithm-feed-candidate-pool',
  VIDEO_STORE: 'personal-algorithm-video-store',
  LAST_SYNC: 'personal-algorithm-last-sync',
  SOURCE_FILTERS: 'personal-algorithm-source-filters',
  FEED_REPLACEMENT_PERCENT: 'personal-algorithm-feed-replacement-percent',
  RETRIEVAL_SETTINGS: 'personal-algorithm-retrieval-settings',
  RETRIEVAL_DIAGNOSTICS: 'personal-algorithm-retrieval-diagnostics',
  HISTORY_EVIDENCE: 'personal-algorithm-history-evidence',
  HISTORY_OBSERVATION_ENABLED: 'personal-algorithm-history-observation-enabled',
  HISTORY_METRICS: 'personal-algorithm-history-metrics',
  HOME_OBSERVATION_ENABLED: 'personal-algorithm-home-observation-enabled',
  HOME_OBSERVATIONS: 'personal-algorithm-home-observations',
  HOME_METRICS: 'personal-algorithm-home-metrics',
  SELECTION_EVENTS: 'personal-algorithm-selection-events',
  PERSONAL_ALGORITHM_STATE: 'personal-algorithm-state',
  PERSONAL_ALGORITHM_LOCAL_TRACES: 'personal-algorithm-local-traces',
  SEMANTIC_EMBEDDING_CACHE: 'personal-algorithm-semantic-embedding-cache',
  SEMANTIC_DIAGNOSTICS: 'personal-algorithm-semantic-diagnostics',
  SEMANTIC_CONCEPT_DIAGNOSTICS: 'personal-algorithm-semantic-concept-diagnostics',
  CONCEPT_EXTRACTION_CACHE: 'personal-algorithm-concept-extraction-cache',
  CONCEPT_EXTRACTION_DIAGNOSTICS: 'personal-algorithm-concept-extraction-diagnostics',
  CONCEPT_MODEL_STATUS: 'personal-algorithm-concept-model-status',
  SEMANTIC_FEATURE_CACHE: 'personal-algorithm-semantic-feature-cache',
  SEMANTIC_MODEL_MODE: 'personal-algorithm-semantic-model-mode',
  SEMANTIC_MODEL_STATUS: 'personal-algorithm-semantic-model-status',
  SEMANTIC_NEURAL_BATCH_SIZE: 'personal-algorithm-semantic-neural-batch-size',
  PRIVACY_DISCLOSURE_ACCEPTED_VERSION: 'personal-algorithm-privacy-disclosure-accepted-version',
} as const;

export async function getStorage<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get([key]);
  return (result[key] ?? fallback) as T;
}

export async function setStorage<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function setStorageBatch(values: Record<string, unknown>): Promise<void> {
  if (Object.keys(values).length === 0) return;
  await chrome.storage.local.set(values);
}

export async function removeStorage(keys: string[]): Promise<void> {
  await chrome.storage.local.remove(keys);
}
