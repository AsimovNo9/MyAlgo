'use client';

import { useEffect, useState } from 'react';
import { getCurrentSession, signInWithGoogle, signOut } from '@/lib/auth';

export function AuthPanel() {
  const [session, setSession] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getCurrentSession().then((currentSession) => {
      setSession(currentSession);
      setLoading(false);
    });
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

  if (loading) {
    return <div>Loading session…</div>;
  }

  return (
    <section style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: 16, background: 'white' }}>
      <h3 style={{ marginTop: 0 }}>Authentication</h3>
      {session ? (
        <>
          <p>Signed in via Supabase Auth.</p>
          <button onClick={() => void handleSignOut()}>Sign out</button>
        </>
      ) : (
        <>
          <p>Supabase is not configured yet, so this is a stubbed auth placeholder.</p>
          <button onClick={() => void handleSignIn()}>Continue with Google</button>
        </>
      )}
    </section>
  );
}
