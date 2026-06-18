import React, { useState, useEffect, useCallback } from 'react';
import { RdpCanvas } from '../components/RdpCanvas';
import { TunnelWithState } from '../hooks/useTunnels';

interface Props {
  tunnel: TunnelWithState | null;
  onBack: () => void;
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;

export function RdpView({ tunnel, onBack }: Props) {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [addonAvailable, setAddonAvailable] = useState<boolean | null>(null);

  const active = tunnel?.runtime.status === 'connected';

  useEffect(() => {
    window.cloudflareRdp.rdp.isAvailable()
      .then((res) => {
        setAddonAvailable(res.available);
        if (!res.available) {
          setError(res.error || 'Native FreeRDP decoder is not available on this system.');
        }
      })
      .catch(() => {
        setAddonAvailable(false);
        setError('Failed to check RDP addon availability');
      });
  }, []);

  useEffect(() => {
    if (!tunnel || !active) {
      setStatus('disconnected');
      return;
    }

    if (addonAvailable === false) {
      setStatus('error');
      return;
    }
    if (addonAvailable !== true) return;

    const connectView = async () => {
      setStatus('connecting');
      setError('');
      try {
        await window.cloudflareRdp.rdp.connect(tunnel.id);
        setStatus('connected');
      } catch (err: any) {
        setStatus('error');
        setError(err.message || 'Failed to connect RDP view');
      }
    };

    connectView();

    const unsub = window.cloudflareRdp.rdp.onEvent((tunnelId: string, type: string, ...args: any[]) => {
      if (tunnelId !== tunnel.id) return;
      if (type === 'disconnected') setStatus('disconnected');
      if (type === 'error') {
        setStatus('error');
        setError(args[0] || 'RDP connection error');
      }
    });

    return () => {
      unsub();
      window.cloudflareRdp.rdp.disconnect(tunnel.id).catch(() => {});
    };
  }, [tunnel?.id, active, addonAvailable]);

  const handleBack = useCallback(() => {
    if (tunnel) {
      window.cloudflareRdp.rdp.disconnect(tunnel.id).catch(() => {});
    }
    onBack();
  }, [tunnel, onBack]);

  const toggleFullscreen = useCallback(() => {
    setFullscreen((f) => !f);
  }, []);

  if (!tunnel) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
        No tunnel selected
      </div>
    );
  }

  const containerStyle: React.CSSProperties = fullscreen
    ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, background: '#000' }
    : { height: '100%', display: 'flex', flexDirection: 'column', background: '#000' };

  const toolbarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 16px',
    background: fullscreen ? 'rgba(0,0,0,0.8)' : 'var(--bg-secondary)',
    color: '#fff',
    fontSize: 13,
    flexShrink: 0,
  };

  return (
    <div style={containerStyle}>
      <div style={toolbarStyle}>
        <button onClick={handleBack} style={toolbarBtnStyle}>← Back</button>
        <span style={{ fontWeight: 600 }}>{tunnel.name}</span>
        <span style={{ opacity: 0.6 }}>
          {status === 'connecting' ? 'Connecting...' :
           status === 'connected' ? `Connected (${tunnel.hostname})` :
           status === 'error' ? 'Error' : 'Disconnected'}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={toggleFullscreen} style={toolbarBtnStyle}>
          {fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
      </div>

      {status === 'error' && error && (
        <div style={{
          position: 'absolute',
          top: 48, left: 16, right: 16,
          padding: '12px',
          background: 'rgba(239,68,68,0.9)',
          color: '#fff',
          borderRadius: 4,
          fontSize: 12,
          zIndex: 100,
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>RDP View Error</div>
          {error}
          {addonAvailable === false && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  window.cloudflareRdp.tunnels.connect(tunnel.id);
                  handleBack();
                }}
                style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: 600,
                  background: '#fff', color: '#222', border: 'none', borderRadius: 4, cursor: 'pointer',
                }}
              >
                Open Native Client Instead
              </button>
              <button
                onClick={handleBack}
                style={{
                  padding: '6px 14px', fontSize: 12,
                  background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 4, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {status === 'connecting' && (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.5)', fontSize: 14,
        }}>
          Connecting to RDP session...
        </div>
      )}

      {status === 'connected' && (
        <div style={{ flex: 1, position: 'relative' }}>
          <RdpCanvas
            tunnelId={tunnel.id}
            width={DEFAULT_WIDTH}
            height={DEFAULT_HEIGHT}
            connected={true}
          />
        </div>
      )}
    </div>
  );
}

const toolbarBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  background: 'rgba(255,255,255,0.15)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 4,
  color: '#fff',
  cursor: 'pointer',
};
