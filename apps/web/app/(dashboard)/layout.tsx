import type { ReactNode } from 'react';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6' }}>
      <nav style={{ padding: '16px 24px', background: '#111827', color: 'white', display: 'flex', gap: 16 }}>
        <a href="/" style={{ color: 'white', textDecoration: 'none' }}>Overview</a>
        <a href="/algorithms" style={{ color: 'white', textDecoration: 'none' }}>Algorithms</a>
        <a href="/rules" style={{ color: 'white', textDecoration: 'none' }}>Rules</a>
      </nav>
      {children}
    </div>
  );
}
