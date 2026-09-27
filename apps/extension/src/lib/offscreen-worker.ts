const OFFSCREEN_WORKER_URL = 'offscreen-search.html';

let offscreenCreatePromise: Promise<void> | null = null;

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

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
  const contexts = await withTimeout(
    chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [documentUrl],
    }),
    5_000,
    'Timed out while checking for the offscreen worker document.',
  );
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

  await withTimeout(
    offscreenCreatePromise,
    10_000,
    'Timed out while creating the offscreen worker document.',
  );
  return true;
}
