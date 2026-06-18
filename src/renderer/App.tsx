import React, { useState } from 'react';
import { Tunnels } from './views/Tunnels';
import { Logs } from './views/Logs';
import { Settings } from './views/Settings';
import { useTunnels } from './hooks/useTunnels';

type Tab = 'tunnels' | 'logs' | 'settings';

function App() {
  const [tab, setTab] = useState<Tab>('tunnels');
  const { tunnels, loading, add, update, remove, connect, disconnect } = useTunnels();

  const navItems: { id: Tab; label: string }[] = [
    { id: 'tunnels', label: 'Tunnels' },
    { id: 'logs', label: 'Logs' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg-primary)' }}>
      <nav style={{
        width: 200,
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 0',
        flexShrink: 0,
      }}>
        <div style={{ padding: '0 16px 20px' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>CloudflareRDP</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>One-click RDP tunnels</div>
        </div>

        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            style={{
              padding: '10px 16px',
              fontSize: 14,
              fontWeight: tab === item.id ? 600 : 400,
              border: 'none',
              borderRight: tab === item.id ? '2px solid var(--accent-blue)' : '2px solid transparent',
              background: tab === item.id ? 'var(--bg-tertiary)' : 'transparent',
              color: tab === item.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s',
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'tunnels' && (
          <Tunnels
            tunnels={tunnels}
            loading={loading}
            onAdd={add}
            onUpdate={update}
            onDelete={remove}
            onConnect={connect}
            onDisconnect={disconnect}
          />
        )}
        {tab === 'logs' && <Logs tunnels={tunnels} />}
        {tab === 'settings' && <Settings />}
      </main>
    </div>
  );
}

export default App;
