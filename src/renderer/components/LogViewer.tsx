import React, { useRef, useEffect } from 'react';
import { LogEntry } from '../../shared/types';

interface Props {
  logs: LogEntry[];
  onExport: () => void;
  filterTunnelId?: string;
}

const levelColors: Record<string, string> = {
  info: 'var(--text-secondary)',
  warn: 'var(--accent-amber)',
  error: 'var(--accent-red)',
  debug: 'var(--text-muted)',
};

export function LogViewer({ logs, onExport, filterTunnelId }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = filterTunnelId
    ? logs.filter((l) => l.tunnelId === filterTunnelId)
    : logs;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [filtered.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
          Logs {filterTunnelId ? '(filtered)' : ''} — {filtered.length} entries
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onExport}
            style={{
              padding: '2px 8px',
              fontSize: 11,
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            Export
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 8,
          background: 'var(--bg-primary)',
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
            No log entries yet. Connect a tunnel to see live logs.
          </div>
        ) : (
          filtered.map((entry) => (
            <div
              key={entry.id}
              className="log-entry"
              style={{ color: levelColors[entry.level] || 'var(--text-secondary)' }}
            >
              <span style={{ color: 'var(--text-muted)' }}>
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              {' '}
              <span style={{ fontWeight: 600, color: 'var(--accent-purple)' }}>
                [{entry.tunnelName}]
              </span>
              {' '}
              {entry.message}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
