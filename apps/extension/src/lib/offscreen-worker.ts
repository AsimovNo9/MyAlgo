const OFFSCREEN_WORKER_URL = 'offscreen-search.html';

let offscreenCreatePromise: Promise<void> | null = null;

export async function ensureWorkerOffscreenDocument(
  justification = 'Run background worker tasks outside the extension service-worker ranking path.',
): Promise<boolean> {
  if (
    typeof chrome === 'undefined'
    || !chrome.offscreen
    || !chrome.runtime?.getContexts
  ) {
    return false;
  }

  const documentUrl = chrome.runtime.getURL(OFFSCREEN_WORKER_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [documentUrl],
  });
  if (contexts.length > 0) return true;

  if (!offscreenCreatePromise) {
    offscreenCreatePromise = chrome.offscreen.createDocument({
      url: OFFSCREEN_WORKER_URL,
      reasons: ['WORKERS'],
      justification,
    }).finally(() => {
      offscreenCreatePromise = null;
    });
  }

  await offscreenCreatePromise;
  return true;
}
