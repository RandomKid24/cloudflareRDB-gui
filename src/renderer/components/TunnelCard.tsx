import React, { useState, useRef, useEffect } from 'react';
import { TunnelWithState } from '../hooks/useTunnels';

interface Props {
  tunnel: TunnelWithState;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onEdit: (tunnel: TunnelWithState) => void;
  onDelete: (id: string) => void;
  onViewScreen?: () => void;
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

export function TunnelCard({ tunnel, onConnect, onDisconnect, onEdit, onDelete, onViewScreen }: Props) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { runtime } = tunnel;
  const isActive = runtime.status === 'connected' || runtime.status === 'connecting' || runtime.status === 'reconnecting';

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        padding: 16,
        transition: 'border-color 0.2s',
        borderColor: isActive ? statusColors[runtime.status] : undefined,
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
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{tunnel.hostname}</div>
          </div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {statusLabels[runtime.status]}
        </span>
      </div>

      {runtime.localPort && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
          localhost:{runtime.localPort}
        </div>
      )}

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
        transition: 'opacity 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
    >
      {children}
    </button>
  );
}
