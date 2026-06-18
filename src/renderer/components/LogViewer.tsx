import React, { useRef, useEffect, useCallback } from 'react';
import { LogEntry } from '../../shared/types';

interface Props {
  logs: LogEntry[];
  autoScroll: boolean;
  setAutoScroll: (v: boolean) => void;
  onExport: () => void;
  filterTunnelId?: string;
}

const levelColors: Record<string, string> = {
  info: 'var(--text-secondary)',
  warn: 'var(--accent-amber)',
  error: 'var(--accent-red)',
  debug: 'var(--text-muted)',
};

export function LogViewer({ logs, autoScroll, setAutoScroll, onExport, filterTunnelId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = filterTunnelId
    ? logs.filter((l) => l.tunnelId === filterTunnelId)
    : logs;

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    if (!atBottom && autoScroll) {
      setAutoScroll(false);
    } else if (atBottom && !autoScroll) {
      setAutoScroll(true);
    }
  }, [autoScroll, setAutoScroll]);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
          Logs {filterTunnelId ? '(filtered)' : ''} — {filtered.length} entries
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            style={{
              padding: '2px 8px',
              fontSize: 11,
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              background: autoScroll ? 'var(--accent-blue)' : 'transparent',
              color: autoScroll ? '#fff' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            {autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
          </button>
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
        onScroll={handleScroll}
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
      </div>
    </div>
  );
}
