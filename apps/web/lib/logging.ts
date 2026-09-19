const SENSITIVE_KEYS = new Set([
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'client_secret',
  'clientSecret',
  'token',
  'secret',
  'authorization',
  'Authorization',
  'api_key',
  'apiKey',
]);

export function redactSensitiveValues<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValues(item)) as T;
  }

  if (typeof value === 'object') {
    const next: Record<string, unknown> = {};

    for (const [key, childValue] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase();
      if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(normalizedKey)) {
        next[key] = '[REDACTED]';
        continue;
      }

      next[key] = redactSensitiveValues(childValue);
    }

    return next as T;
  }

  return value;
}
