const defaultAllowedOrigins = ['http://localhost:3000'];

function configuredAllowedOrigins(): string[] {
  return [
    ...defaultAllowedOrigins,
    process.env.NEXT_PUBLIC_SITE_URL,
    ...(process.env.CORS_ALLOWED_ORIGINS ?? '').split(','),
  ]
    .filter((origin): origin is string => typeof origin === 'string')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = origin.replace(/\/$/, '');
  if (/^chrome-extension:\/\/[a-p]{32}$/i.test(normalizedOrigin)) {
    return true;
  }

  return configuredAllowedOrigins().includes(normalizedOrigin);
}

export function applyCorsHeaders(headers: Headers, origin: string | null): void {
  if (!origin || !isAllowedOrigin(origin)) {
    return;
  }

  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  headers.set('Vary', 'Origin');
}