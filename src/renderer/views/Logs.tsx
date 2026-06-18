import React, { useState } from 'react';
import { LogViewer } from '../components/LogViewer';
import { LogEntry } from '../../shared/types';
import { useLogs } from '../hooks/useLogs';
import { TunnelWithState } from '../hooks/useTunnels';

interface Props {
  tunnels: TunnelWithState[];
}

export function Logs({ tunnels }: Props) {
  const { logs, autoScroll, setAutoScroll, exportLogs } = useLogs();
  const [filterTunnelId, setFilterTunnelId] = useState<string | undefined>(undefined);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Logs</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <FilterChip active={!filterTunnelId} onClick={() => setFilterTunnelId(undefined)}>
            All Tunnels
          </FilterChip>
          {tunnels.map((t) => (
            <FilterChip key={t.id} active={filterTunnelId === t.id} onClick={() => setFilterTunnelId(t.id)}>
              {t.name}
            </FilterChip>
          ))}
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <LogViewer
          logs={logs}
          autoScroll={autoScroll}
          setAutoScroll={setAutoScroll}
          onExport={() => exportLogs(filterTunnelId)}
          filterTunnelId={filterTunnelId}
        />
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 12px',
        fontSize: 12,
        fontWeight: 500,
        border: '1px solid var(--border-color)',
        borderRadius: 12,
        background: active ? 'var(--accent-blue)' : 'transparent',
        color: active ? '#fff' : 'var(--text-secondary)',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}
