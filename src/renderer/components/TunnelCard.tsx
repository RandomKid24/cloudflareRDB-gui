import React, { useState, useRef, useEffect } from 'react';
import { TunnelWithState } from '../hooks/useTunnels';

interface Props {
  tunnel: TunnelWithState;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onEdit: (tunnel: TunnelWithState) => void;
  onDelete: (id: string) => void;
  onViewScreen?: () => void;
  onViewLogs?: () => void;
}

const statusColors: Record<string, string> = {
  disconnected: 'var(--text-muted)',
  connecting: 'var(--accent-amber)',
  connected: 'var(--accent-green)',
  error: 'var(--accent-red)',
  reconnecting: 'var(--accent-amber)',
};

const statusLabels: Record<string, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting...',
  connected: 'Connected',
  error: 'Error',
  reconnecting: 'Reconnecting...',
};

function getRelativeTime(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return '';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins}m ${secs}s`;
}

export function TunnelCard({ tunnel, onConnect, onDisconnect, onEdit, onDelete, onViewScreen, onViewLogs }: Props) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [duration, setDuration] = useState(0);
  const connectedAtRef = useRef<number | null>(null);
  const { runtime } = tunnel;
  const isActive = runtime.status === 'connected' || runtime.status === 'connecting' || runtime.status === 'reconnecting';

  useEffect(() => {
    if (runtime.status === 'connected') {
      connectedAtRef.current = Date.now();
      const tick = () => setDuration(Math.floor((Date.now() - connectedAtRef.current!) / 1000));
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    } else {
      connectedAtRef.current = null;
      setDuration(0);
    }
  }, [runtime.status]);

  return (
    <div
      className="card-enter"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        padding: 16,
        transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.15s',
        borderColor: isActive ? statusColors[runtime.status] : undefined,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.2)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: statusColors[runtime.status],
              flexShrink: 0,
              ...(runtime.status === 'connecting' || runtime.status === 'reconnecting'
                ? { animation: 'pulse-dot 1.5s ease-in-out infinite' }
                : {}),
            }}
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{tunnel.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              {tunnel.hostname}
              {runtime.status === 'connected' && duration > 0 && (
                <span style={{ color: 'var(--accent-green)' }}> &middot; {formatDuration(duration)}</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
              {tunnel.lastConnectedAt
                ? `Last connected: ${getRelativeTime(tunnel.lastConnectedAt)}`
                : 'Never connected'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {runtime.localPort && (
            <span
              title={`Local tunnel port: ${runtime.localPort}`}
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'var(--bg-tertiary)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border-color)',
                fontFamily: 'monospace',
              }}
            >
              :{runtime.localPort}
            </span>
          )}
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {statusLabels[runtime.status]}
          </span>
        </div>
      </div>

      {runtime.lastError && runtime.status === 'error' && (
        <div style={{ fontSize: 12, color: 'var(--accent-red)', marginBottom: 8, padding: '4px 8px', background: 'rgba(239,68,68,0.1)', borderRadius: 4, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
          {runtime.lastError}
        </div>
      )}

      {(runtime.status === 'connecting' || runtime.status === 'reconnecting' || (runtime.status === 'error' && runtime.capturedOutput)) && runtime.capturedOutput ? (
        <LiveOutput capturedOutput={runtime.capturedOutput} />
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {isActive ? (
          <>
            <ActionButton onClick={() => onDisconnect(tunnel.id)} color="var(--accent-red)">
              Disconnect
            </ActionButton>
            {onViewScreen && runtime.status === 'connected' && (
              <ActionButton onClick={onViewScreen} color="var(--accent-blue)">
                View Screen
              </ActionButton>
            )}
          </>
        ) : (
          <ActionButton onClick={() => onConnect(tunnel.id)} color="var(--accent-green)">
            Connect
          </ActionButton>
        )}
        <ActionButton onClick={() => onEdit(tunnel)} color="var(--accent-blue)" variant="secondary">
          Edit
        </ActionButton>
        {onViewLogs && (
          <ActionButton onClick={onViewLogs} color="var(--text-secondary)" variant="secondary">
            Logs
          </ActionButton>
        )}
        {showDeleteConfirm ? (
          <>
            <ActionButton onClick={() => { onDelete(tunnel.id); setShowDeleteConfirm(false); }} color="var(--accent-red)" variant="secondary">
              Confirm
            </ActionButton>
            <ActionButton onClick={() => setShowDeleteConfirm(false)} color="var(--text-muted)" variant="secondary">
              Cancel
            </ActionButton>
          </>
        ) : (
          <ActionButton onClick={() => setShowDeleteConfirm(true)} color="var(--text-muted)" variant="secondary">
            Delete
          </ActionButton>
        )}
      </div>
    </div>
  );
}

function LiveOutput({ capturedOutput }: { capturedOutput: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [capturedOutput]);

  return (
    <pre
      ref={ref}
      style={{
        fontSize: 11,
        lineHeight: 1.4,
        background: 'rgba(0,0,0,0.06)',
        borderRadius: 4,
        padding: 8,
        maxHeight: 150,
        overflowY: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        fontFamily: 'monospace',
        margin: '8px 0 0',
        color: 'var(--text-secondary)',
      }}
    >
      {capturedOutput}
    </pre>
  );
}

function ActionButton({ onClick, color, variant, children }: {
  onClick: () => void;
  color: string;
  variant?: 'primary' | 'secondary';
  children: React.ReactNode;
}) {
  const isPrimary = variant !== 'secondary';
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 12px',
        fontSize: 12,
        fontWeight: 500,
        borderRadius: 4,
        border: isPrimary ? 'none' : `1px solid ${color}`,
        background: isPrimary ? color : 'transparent',
        color: isPrimary ? '#fff' : color,
        cursor: 'pointer',
        transition: 'opacity 0.15s, transform 0.1s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
    >
      {children}
    </button>
  );
}
