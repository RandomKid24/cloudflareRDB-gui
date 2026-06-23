import React, { useState } from 'react';
import { TunnelCard } from '../components/TunnelCard';
import { TunnelForm } from '../components/TunnelForm';
import { TunnelWithState } from '../hooks/useTunnels';

interface Props {
  tunnels: TunnelWithState[];
  loading: boolean;
  onAdd: (data: { name: string; hostname: string; port: number; username: string; password: string; rememberAfterSession: boolean }) => void;
  onUpdate: (tunnel: any) => void;
  onDelete: (id: string) => void;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onViewScreen: (tunnel: TunnelWithState) => void;
  onViewLogs: (tunnelId: string) => void;
}

export function Tunnels({ tunnels, loading, onAdd, onUpdate, onDelete, onConnect, onDisconnect, onViewScreen, onViewLogs }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingTunnel, setEditingTunnel] = useState<TunnelWithState | null>(null);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
        Loading...
      </div>
    );
  }

  if (tunnels.length === 0 && !showForm) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <div style={{ fontSize: 16, color: 'var(--text-secondary)' }}>No tunnels configured yet</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 400 }}>
          Add your first Cloudflare Tunnel target to get started with one-click RDP.
        </div>
        <button
          onClick={() => setShowForm(true)}
          style={{
            padding: '10px 24px',
            fontSize: 14,
            fontWeight: 600,
            border: 'none',
            borderRadius: 8,
            background: 'var(--accent-blue)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Add Your First Tunnel
        </button>
      </div>
    );
  }

  const handleFormSubmit = (data: { name: string; hostname: string; port: number; username: string; password: string; rememberAfterSession: boolean }) => {
    if (editingTunnel) {
      onUpdate({ ...editingTunnel, ...data });
    } else {
      onAdd(data);
    }
    setShowForm(false);
    setEditingTunnel(null);
  };

  const handleEdit = (tunnel: TunnelWithState) => {
    setEditingTunnel(tunnel);
    setShowForm(true);
  };

  return (
    <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Tunnels</h1>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              borderRadius: 6,
              background: 'var(--accent-blue)',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            + Add Tunnel
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ marginBottom: 24, padding: 20, background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8 }}>
          <TunnelForm
            tunnel={editingTunnel ?? undefined}
            onSubmit={handleFormSubmit}
            onCancel={() => { setShowForm(false); setEditingTunnel(null); }}
          />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {tunnels.map((tunnel) => (
          <TunnelCard
            key={tunnel.id}
            tunnel={tunnel}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onEdit={handleEdit}
            onDelete={onDelete}
            onViewScreen={() => onViewScreen(tunnel)}
            onViewLogs={() => onViewLogs(tunnel.id)}
          />
        ))}
      </div>
    </div>
  );
}
