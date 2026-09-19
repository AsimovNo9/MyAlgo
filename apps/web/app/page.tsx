import DashboardOverviewPageContent from '@/components/DashboardOverviewPageContent';

export default function OverviewPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#eef2ff' }}>
      <nav style={{
        padding: '18px 28px',
        background: '#0b1120',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
        boxShadow: '0 10px 30px rgba(15, 23, 42, 0.12)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #7c3aed, #22c55e)',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 700,
            fontSize: 14,
          }}>
            M
          </div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>MindfulFeed</div>
        </div>

        <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
          <a href="/" style={{ color: '#e2e8f0', textDecoration: 'none', fontSize: 14 }}>Overview</a>
          <a href="/algorithms" style={{ color: '#e2e8f0', textDecoration: 'none', fontSize: 14 }}>Algorithms</a>
        </div>
      </nav>

      <div style={{ padding: '24px' }}>
        <DashboardOverviewPageContent />
      </div>
    </div>
  );
}
