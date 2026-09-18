export type ProviderName = 'google';

export function getProviderConfig(provider: ProviderName) {
  if (provider !== 'google') {
    return null;
  }

  return {
    provider: 'google' as const,
    redirectTo: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
    scopes: 'openid email profile',
  };
}
