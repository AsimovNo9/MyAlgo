const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export type FetchRetryOptions = {
  maxAttempts?: number;
  timeoutMs?: number;
  backoffMs?: number;
};

export async function fetchWithRetry(
  input: string | URL | Request,
  init: RequestInit | undefined,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const timeoutMs = Math.max(1, options.timeoutMs ?? 10_000);
  const backoffMs = Math.max(0, options.backoffMs ?? 250);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abortCaller = () => controller.abort();
    init?.signal?.addEventListener('abort', abortCaller, { once: true });

    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === maxAttempts) {
        return response;
      }
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
      init?.signal?.removeEventListener('abort', abortCaller);
    }

    await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
  }

  throw new Error('Fetch retry attempts exhausted.');
}