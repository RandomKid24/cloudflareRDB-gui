import React, { useState, useEffect } from 'react';
import { Tunnels } from './views/Tunnels';
import { Logs } from './views/Logs';
import { Settings } from './views/Settings';
import { RdpView } from './views/RdpView';
import { useTunnels, TunnelWithState } from './hooks/useTunnels';
import { ThemeMode } from '../shared/types';

type Tab = 'tunnels' | 'logs' | 'settings';

function App() {
  const [tab, setTab] = useState<Tab>('tunnels');
  const [viewingTunnel, setViewingTunnel] = useState<TunnelWithState | null>(null);
  const [selectedLogTunnelId, setSelectedLogTunnelId] = useState<string | undefined>(undefined);
  const { tunnels, loading, add, update, remove, connect, disconnect } = useTunnels();
  const [theme, setTheme] = useState<ThemeMode>('dark');

  useEffect(() => {
    window.cloudflareRdp.settings.get().then((s) => {
      if (s.theme) setTheme(s.theme);
    });
  }, []);

  useEffect(() => {
    if (document.body.classList.contains('transparent') && theme !== 'transparent') {
      document.body.style.background = 'var(--bg-primary)';
    }
    const effective = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    for (const cls of ['dark', 'light', 'transparent', 'nordic', 'sunset']) {
      document.documentElement.classList.toggle(cls, cls === effective);
    }
    if (effective === 'transparent') {
      document.body.style.background = 'transparent';
    } else {
      document.body.style.background = '';
    }
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (theme === 'system') {
        const effective = mq.matches ? 'dark' : 'light';
        for (const cls of ['dark', 'light', 'transparent', 'nordic', 'sunset']) {
          document.documentElement.classList.toggle(cls, cls === effective);
        }
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const navItems: { id: Tab; label: string }[] = [
    { id: 'tunnels', label: 'Tunnels' },
    { id: 'logs', label: 'Logs' },
    { id: 'settings', label: 'Settings' },
  ];

  if (viewingTunnel) {
    return (
      <div style={{ height: '100vh', background: '#000' }}>
        <RdpView tunnel={viewingTunnel} onBack={() => setViewingTunnel(null)} />
      </div>
    );
  }

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
          <div style={{ fontSize: 16, fontWeight: 700 }}>TunnelGate</div>
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
            onViewScreen={setViewingTunnel}
            onViewLogs={(tunnelId) => {
              setSelectedLogTunnelId(tunnelId);
              setTab('logs');
            }}
          />
        )}
        {tab === 'logs' && (
          <Logs
            tunnels={tunnels}
            initialTunnelId={selectedLogTunnelId}
            onClearFilter={() => setSelectedLogTunnelId(undefined)}
          />
        )}
        {tab === 'settings' && <Settings onThemeChange={setTheme} />}
      </main>
    </div>
  );
}

export default App;
