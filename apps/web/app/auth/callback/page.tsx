'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '../../../lib/supabase/client';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const finalizeAuth = async () => {
      const client = createSupabaseClient();

      if (!client) {
        router.replace('/');
        return;
      }

      try {
        const {
          data: { session },
          error,
        } = await client.auth.getSession();

        if (error) {
          console.error('Auth callback session error:', error);
          router.replace('/');
          return;
        }

        if (session) {
          await fetch('/api/oauth/youtube/connect', {
            method: 'POST',
            credentials: 'include',
          });
          router.replace('/');
          return;
        }

        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const accessToken = hash.get('access_token');
        const refreshToken = hash.get('refresh_token');

        if (accessToken && refreshToken) {
          const { error: setSessionError } = await client.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (setSessionError) {
            console.error('Failed to set OAuth session:', setSessionError);
          }

          try {
            await fetch('/api/oauth/youtube/connect', {
              method: 'POST',
              credentials: 'include',
            });
          } catch (connectError) {
            console.error('Failed to store YouTube OAuth connection:', connectError);
          }
        }
      } finally {
        router.replace('/');
      }
    };

    void finalizeAuth();
  }, [router]);

  return (
    <main style={{ padding: 24 }}>
      <h1>Signing in…</h1>
      <p>Completing your Supabase OAuth session.</p>
    </main>
  );
}
