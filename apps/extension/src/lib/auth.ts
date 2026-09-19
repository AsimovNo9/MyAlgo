import { createClient, type Session } from '@supabase/supabase-js';
import { getStorage, setStorage } from './storage';

const ACCESS_TOKEN_KEY = 'personal-algorithm-access-token';
const REFRESH_TOKEN_KEY = 'personal-algorithm-refresh-token';
const EXPIRES_AT_KEY = 'personal-algorithm-access-token-expires-at';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null;

let signInInFlight: Promise<void> | null = null;

async function storeSession(session: Session | null) {
  if (!session) {
    return;
  }

  await Promise.all([
    setStorage(ACCESS_TOKEN_KEY, session.access_token),
    setStorage(REFRESH_TOKEN_KEY, session.refresh_token),
    setStorage(EXPIRES_AT_KEY, session.expires_at ?? 0),
  ]);
}

export async function getExtensionAccessToken(): Promise<string | null> {
  const accessToken = await getStorage<string | null>(ACCESS_TOKEN_KEY, null);
  const expiresAt = await getStorage<number>(EXPIRES_AT_KEY, 0);

  if (!accessToken) {
    return null;
  }

  if (expiresAt && expiresAt * 1000 <= Date.now() + 60_000) {
    return refreshExtensionSession();
  }

  return accessToken;
}

async function refreshExtensionSession(): Promise<string | null> {
  if (!supabase) {
    return null;
  }

  const refreshToken = await getStorage<string | null>(REFRESH_TOKEN_KEY, null);
  if (!refreshToken) {
    return null;
  }

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    return null;
  }

  await storeSession(data.session);
  return data.session.access_token;
}

async function startGoogleSignIn(): Promise<void> {
  if (!supabase) {
    throw new Error('Extension Supabase configuration is missing.');
  }

  const redirectTo = chrome.identity.getRedirectURL('supabase-auth');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      scopes: 'https://www.googleapis.com/auth/youtube.readonly',
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  });

  if (error || !data.url) {
    throw new Error(error?.message ?? 'Unable to start Google sign-in.');
  }

  const callbackUrl = await new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true }, (responseUrl) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError || !responseUrl) {
        reject(new Error(runtimeError?.message ?? 'Google sign-in was cancelled.'));
        return;
      }
      resolve(responseUrl);
    });
  });

  const callback = new URL(callbackUrl);
  const code = callback.searchParams.get('code');
  if (code) {
    const { data: exchanged, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError || !exchanged.session) {
      throw new Error(exchangeError?.message ?? 'Unable to finish Google sign-in.');
    }
    await storeSession(exchanged.session);
    return;
  }

  const hash = new URLSearchParams(callback.hash.replace(/^#/, ''));
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  if (!accessToken || !refreshToken) {
    throw new Error('Google sign-in returned no session.');
  }

  await Promise.all([
    setStorage(ACCESS_TOKEN_KEY, accessToken),
    setStorage(REFRESH_TOKEN_KEY, refreshToken),
    setStorage(EXPIRES_AT_KEY, Number(hash.get('expires_at') ?? 0)),
  ]);
}

export function signInWithGoogle(): Promise<void> {
  if (!signInInFlight) {
    signInInFlight = startGoogleSignIn().finally(() => {
      signInInFlight = null;
    });
  }

  return signInInFlight;
}

export async function signOutExtension(): Promise<void> {
  await Promise.all([
    setStorage(ACCESS_TOKEN_KEY, null),
    setStorage(REFRESH_TOKEN_KEY, null),
    setStorage(EXPIRES_AT_KEY, 0),
  ]);
}
