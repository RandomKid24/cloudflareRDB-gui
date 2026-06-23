import React, { useRef, useEffect, useState, useMemo } from 'react';
import { LogEntry } from '../../shared/types';

interface Props {
  logs: LogEntry[];
  onExport: () => void;
  onClear: () => void;
  filterTunnelId?: string;
}

const levelColors: Record<string, string> = {
  info: 'var(--text-secondary)',
  warn: 'var(--accent-amber)',
  error: 'var(--accent-red)',
  debug: 'var(--text-muted)',
};

const levelBadge: Record<string, { label: string; color: string; bg: string }> = {
  error: { label: 'ERROR', color: '#fff', bg: 'rgba(239,68,68,0.7)' },
  warn: { label: 'WARN', color: '#1a1a1a', bg: 'rgba(245,158,11,0.7)' },
  info: { label: 'INFO', color: '#fff', bg: 'rgba(59,130,246,0.5)' },
  debug: { label: 'DEBUG', color: 'var(--text-muted)', bg: 'transparent' },
};

function formatTime(ts: string): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

export function LogViewer({ logs, onExport, onClear, filterTunnelId }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let result = filterTunnelId
      ? logs.filter((l) => l.tunnelId === filterTunnelId)
      : logs;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((l) =>
        l.message.toLowerCase().includes(q) ||
        l.tunnelName.toLowerCase().includes(q) ||
        l.level.toLowerCase().includes(q)
      );
    }
    return result;
  }, [logs, filterTunnelId, search]);

  const handleClear = () => {
    onClear();
  };

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filtered.length, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
    if (isNearBottom !== autoScroll) {
      setAutoScroll(isNearBottom);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
          Logs {filterTunnelId ? '(filtered)' : ''} — {filtered.length} entries
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            title={autoScroll ? 'Disable auto-scroll' : 'Enable auto-scroll'}
            style={{
              padding: '2px 8px',
              fontSize: 11,
              border: `1px solid ${autoScroll ? 'var(--accent-blue)' : 'var(--border-color)'}`,
              borderRadius: 4,
              background: autoScroll ? 'var(--accent-blue)' : 'transparent',
              color: autoScroll ? '#fff' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            Auto {autoScroll ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={handleClear}
            title="Clear visible logs"
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
            Clear
          </button>
          <button
            onClick={onExport}
            title="Export logs to file"
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
      <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter logs..."
          style={{
            width: '100%',
            padding: '4px 8px',
            fontSize: 12,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: 4,
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
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
            {search ? 'No matching log entries.' : 'No log entries yet. Connect a tunnel to see live logs.'}
          </div>
        ) : (
          filtered.map((entry) => (
            <div
              key={entry.id}
              className="log-entry"
              style={{
                color: levelColors[entry.level] || 'var(--text-secondary)',
                padding: '1px 0',
              }}
            >
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                {formatTime(entry.timestamp)}
              </span>
              {' '}
              <span
                style={{
                  display: 'inline-block',
                  padding: '0 4px',
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 3,
                  color: levelBadge[entry.level]?.color || 'var(--text-muted)',
                  background: levelBadge[entry.level]?.bg || 'transparent',
                  textTransform: 'uppercase',
                }}
              >
                {levelBadge[entry.level]?.label || entry.level}
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
