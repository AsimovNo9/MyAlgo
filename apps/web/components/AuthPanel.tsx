'use client';

import { useEffect, useState } from 'react';
import { ensureProfileForSession, getCurrentSession, signInWithGoogle, signOut } from '@/lib/auth';

type SessionLike = {
  user?: {
    email?: string | null;
  } | null;
} | null;

export function AuthPanel() {
  const [session, setSession] = useState<SessionLike>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const currentSession = await getCurrentSession();

      if (currentSession) {
        await ensureProfileForSession(currentSession);
      }

      setSession(currentSession);
      setLoading(false);
    })();
  }, []);

  const handleSignIn = async () => {
    const { error } = await signInWithGoogle();
    if (error) {
      console.error(error);
    }
  };

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      console.error(error);
    }
    setSession(null);
  };

  const userEmail = session?.user?.email ?? null;

  if (loading) {
    return <div>Loading session…</div>;
  }

  return (
    <section style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: 16, background: 'white' }}>
      <h3 style={{ marginTop: 0 }}>Authentication</h3>
      {session ? (
        <>
          <p>Signed in via Supabase Auth{userEmail ? ` as ${userEmail}` : ''}.</p>
          <button onClick={() => void handleSignOut()}>Sign out</button>
        </>
      ) : (
        <>
          <p>Continue with Google to create your profile.</p>
          <button onClick={() => void handleSignIn()}>Continue with Google</button>
        </>
      )}
    </section>
  );
}
