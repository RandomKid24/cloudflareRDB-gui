import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RdpCanvas } from '../components/RdpCanvas';
import { TunnelWithState } from '../hooks/useTunnels';

interface Props {
  tunnel: TunnelWithState | null;
  onBack: () => void;
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;

function getBestRdpSize(containerW: number, containerH: number): { width: number; height: number } {
  // Round down to nearest multiple of 4 (FreeRDP requirement)
  const w = Math.max(800, Math.floor(containerW / 4) * 4);
  const h = Math.max(600, Math.floor(containerH / 4) * 4);
  return { width: w, height: h };
}

function isPasswordExpired(msg: string): boolean {
  return msg.includes('code=131087') || /password.*(expired|must be changed)/i.test(msg);
}

function getFriendlyErrorMessage(msg: string): { title: string; desc: string } {
  if (msg.includes('code=131081') || /authentication failure/i.test(msg)) {
    return {
      title: 'RDP Authentication Failure (Error 131081)',
      desc: 'The remote computer rejected your login credentials. Please verify your Windows Username and Password in the tunnel edit settings and try again.',
    };
  }
  if (msg.includes('code=131085') || /transport layer failed/i.test(msg)) {
    return {
      title: 'Network Transport Failure (Error 131085)',
      desc: 'Could not establish connection to the remote port. Please make sure that:\n1. Your Cloudflare Tunnel is connected and active.\n2. The remote computer is turned on and allows Remote Desktop connections.',
    };
  }
  if (msg.includes('code=131087') || /password.*(expired|must be changed)/i.test(msg)) {
    return {
      title: 'Password Expired (Error 131087)',
      desc: 'Your Windows user password has expired and must be changed before you can log in.',
    };
  }
  if (msg.includes('Cannot find module') && msg.includes('rdp_addon.node')) {
    return {
      title: 'RDP Addon Initialization Failure',
      desc: 'The integrated RDP engine failed to load. Please make sure you have installed the latest version of the app and that your antivirus is not blocking the application modules.',
    };
  }
  return {
    title: 'RDP Connection Error',
    desc: msg || 'An unknown error occurred while establishing the RDP session.',
  };
}

export function RdpView({ tunnel, onBack }: Props) {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [error, setError] = useState('');
  const [addonAvailable, setAddonAvailable] = useState<boolean | null>(null);
  const [passwordUpdateRequired, setPasswordUpdateRequired] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const [showPasswordExpired, setShowPasswordExpired] = useState(false);
  const [canvasWidth, setCanvasWidth] = useState(DEFAULT_WIDTH);
  const [canvasHeight, setCanvasHeight] = useState(DEFAULT_HEIGHT);
  const [connectingStep, setConnectingStep] = useState('Initializing secure tunnel...');
  const active = tunnel?.runtime.status === 'connected';
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const connectSizeRef = useRef({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const connectedRef = useRef(false);

  useEffect(() => {
    if (status !== 'connecting') return;
    const steps = [
      'Initializing secure tunnel...',
      'Connecting to RDP gate...',
      'Negotiating RDP protocols...',
      'Establishing SSL/TLS session...',
      'Performing NLA security handshake...',
      'Authenticating credentials...',
      'Setting up graphics pipeline...',
    ];
    let index = 0;
    setConnectingStep(steps[0]);
    const interval = setInterval(() => {
      index++;
      if (index < steps.length) {
        setConnectingStep(steps[index]);
      }
    }, 450);
    return () => clearInterval(interval);
  }, [status]);

  // Track canvas wrapper size for dynamic RDP resolution
  // connectSizeRef is used for the initial RDP connect (no reconnect on resize)
  // canvasWidth/canvasHeight state is frozen after connect to prevent canvas clearing
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const toolbarEl = toolbarRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { inlineSize, blockSize } = entry.borderBoxSize?.[0] ?? entry.contentBoxSize?.[0] ?? { inlineSize: DEFAULT_WIDTH, blockSize: DEFAULT_HEIGHT };
        const dpr = 1; // Temporarily lock to 1.0 to reduce tunnel bandwidth until native code is recompiled
        const rawW = Math.max(640, Math.min(3840, Math.round(inlineSize * dpr)));
        let rawH = Math.max(480, Math.min(2160, Math.round(blockSize * dpr)));
        if (toolbarEl) {
          rawH = Math.max(480, Math.min(2160, rawH - Math.round(toolbarEl.offsetHeight * dpr)));
        }
        const snapped = getBestRdpSize(rawW, rawH);
        console.log('Container measured:', rawW, rawH, '→ RDP:', snapped.width, snapped.height);
        connectSizeRef.current = snapped;
        // Only update canvas dimensions before connect (after connect, keep RDP resolution)
        if (!connectedRef.current) {
          setCanvasWidth(snapped.width);
          setCanvasHeight(snapped.height);
        }
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

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
      setPasswordUpdateRequired(false);
      try {
        // Wait for ResizeObserver to measure the actual container
        await new Promise(r => setTimeout(r, 150));
        const { width, height } = connectSizeRef.current;
        await window.cloudflareRdp.rdp.connect(tunnel.id, width, height);
        setCanvasWidth(width);
        setCanvasHeight(height);
        connectedRef.current = true;
        setStatus('connected');
      } catch (err: any) {
        const msg = err.message || 'Failed to connect RDP view';
        if (isPasswordExpired(msg)) {
          setPasswordUpdateRequired(true);
          setStatus('disconnected');
        } else {
          setStatus('error');
          setError(msg);
        }
      }
    };

    connectView();

    const unsub = window.cloudflareRdp.rdp.onEvent((tunnelId: string, type: string, ...args: any[]) => {
      if (tunnelId !== tunnel.id) return;
      if (type === 'disconnected') { setStatus('disconnected'); connectedRef.current = false; }
      if (type === 'error') {
        const msg = args[0] || 'RDP connection error';
        if (isPasswordExpired(msg)) {
          setPasswordUpdateRequired(true);
          setStatus('disconnected');
        } else {
          setStatus('error');
          setError(msg);
        }
      }
      if (type === 'resize') {
        const w = args[0];
        const h = args[1];
        if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
          setCanvasWidth(w);
          setCanvasHeight(h);
        }
      }
    });

    return () => {
      connectedRef.current = false;
      unsub();
      window.cloudflareRdp.rdp.disconnect(tunnel.id).catch(() => {});
    };
  }, [tunnel?.id, active, addonAvailable]);

  useEffect(() => {
    if (passwordUpdateRequired && passwordInputRef.current) {
      passwordInputRef.current.focus();
    }
  }, [passwordUpdateRequired]);

  const handleBack = useCallback(() => {
    if (tunnel) {
      window.cloudflareRdp.rdp.disconnect(tunnel.id).catch(() => {});
    }
    onBack();
  }, [tunnel, onBack]);

  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !passwordUpdateRequired) {
        e.stopPropagation();
        handleBack();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleBack, passwordUpdateRequired]);

  const handleUpdatePassword = useCallback(async () => {
    if (!tunnel || !newPassword.trim()) return;
    setUpdatingPassword(true);
    setUpdateError('');
    try {
      await window.cloudflareRdp.rdp.updatePassword(tunnel.id, newPassword.trim(), canvasWidth, canvasHeight);
      setPasswordUpdateRequired(false);
      setNewPassword('');
      setStatus('connected');
    } catch (err: any) {
      const msg = err.message || 'Failed to update password';
      if (isPasswordExpired(msg)) {
        setUpdateError('Password was rejected again. Please verify the new password.');
      } else {
        setUpdateError(msg);
      }
    } finally {
      setUpdatingPassword(false);
    }
  }, [tunnel, newPassword]);

  const handleCancelUpdate = useCallback(() => {
    setPasswordUpdateRequired(false);
    setNewPassword('');
    setUpdateError('');
    handleBack();
  }, [handleBack]);

  const handleRetry = useCallback(async () => {
    if (!tunnel) return;
    setError('');
    setStatus('disconnected');
    await window.cloudflareRdp.rdp.disconnect(tunnel.id).catch(() => {});
    setStatus('connecting');
    try {
      const { width, height } = connectSizeRef.current;
      await window.cloudflareRdp.rdp.connect(tunnel.id, width, height);
      setStatus('connected');
    } catch (err: any) {
      const msg = err.message || 'Failed to connect RDP view';
      if (isPasswordExpired(msg)) {
        setPasswordUpdateRequired(true);
        setStatus('disconnected');
      } else {
        setStatus('error');
        setError(msg);
      }
    }
  }, [tunnel]);

  const handleLaunchNativeClient = useCallback(() => {
    if (!tunnel) return;
    window.cloudflareRdp.rdp.launchNativeClient(tunnel.id);
  }, [tunnel]);

  if (!tunnel) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
        No tunnel selected
      </div>
    );
  }

  const containerStyle: React.CSSProperties = { height: '100%', display: 'flex', flexDirection: 'column', background: '#000' };

  const toolbarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 16px',
    background: 'var(--bg-secondary)',
    color: '#fff',
    fontSize: 13,
    flexShrink: 0,
  };

  return (
    <div ref={containerRef} style={containerStyle}>
      <div ref={toolbarRef} style={toolbarStyle}>
        <button onClick={handleBack} style={toolbarBtnStyle}>← Back</button>
        <span style={{ fontWeight: 600 }}>{tunnel.name}</span>
        <span style={{ opacity: 0.6 }}>
          {status === 'connecting' ? 'Connecting...' :
           status === 'connected' ? `Connected (${tunnel.hostname})` :
           status === 'error' ? 'Error' : 'Disconnected'}
        </span>
        <div style={{ flex: 1 }} />
        {(status === 'connected' || status === 'error') && (
          <button onClick={handleLaunchNativeClient} style={toolbarBtnStyle}>
            Open Native Client
          </button>
        )}
      </div>

      {passwordUpdateRequired && (
        <div style={{
          position: 'absolute',
          top: 48, left: 16, right: 16,
          padding: 16,
          background: 'rgba(245,158,11,0.95)',
          color: '#fff',
          borderRadius: 4,
          fontSize: 13,
          zIndex: 100,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Password Expired</div>
          <div style={{ marginBottom: 12, opacity: 0.9, fontSize: 12 }}>
            The password for <strong>{tunnel.username}</strong> on <strong>{tunnel.hostname}</strong> has expired.
            Enter the new password to reconnect.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                ref={passwordInputRef}
                type={showPasswordExpired ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleUpdatePassword(); }}
                placeholder="New password"
                disabled={updatingPassword}
                style={{
                  padding: '8px 10px', fontSize: 13, borderRadius: 4,
                  border: '1px solid rgba(255,255,255,0.4)',
                  background: 'rgba(255,255,255,0.15)', color: '#fff',
                  outline: 'none', width: '100%', boxSizing: 'border-box',
                  paddingRight: 36,
                }}
              />
              <button
                type="button"
                onClick={() => setShowPasswordExpired((p) => !p)}
                tabIndex={-1}
                style={{
                  position: 'absolute',
                  right: 4,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  fontSize: 16,
                  lineHeight: 1,
                  color: 'rgba(255,255,255,0.6)',
                }}
                aria-label={showPasswordExpired ? 'Hide password' : 'Show password'}
              >
                {showPasswordExpired ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
            {updateError && (
              <div style={{ fontSize: 11, background: 'rgba(239,68,68,0.8)', padding: '6px 8px', borderRadius: 4 }}>
                {updateError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleUpdatePassword}
                disabled={updatingPassword || !newPassword.trim()}
                style={{
                  padding: '8px 16px', fontSize: 12, fontWeight: 600,
                  background: updatingPassword ? 'rgba(255,255,255,0.4)' : '#fff',
                  color: '#222', border: 'none', borderRadius: 4, cursor: updatingPassword ? 'not-allowed' : 'pointer',
                }}
              >
                {updatingPassword ? 'Updating...' : 'Update Password & Reconnect'}
              </button>
              <button
                onClick={handleCancelUpdate}
                disabled={updatingPassword}
                style={{
                  padding: '8px 16px', fontSize: 12,
                  background: 'transparent', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.4)', borderRadius: 4, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {status === 'error' && error && !passwordUpdateRequired && (() => {
        const { title, desc } = getFriendlyErrorMessage(error);
        return (
          <div style={{
            position: 'absolute',
            top: 48, left: 16, right: 16,
            padding: '16px',
            background: 'rgba(220, 38, 38, 0.95)',
            backdropFilter: 'blur(8px)',
            color: '#fff',
            borderRadius: 6,
            fontSize: 13,
            zIndex: 100,
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {title}
            </div>
            <div style={{ opacity: 0.9, lineHeight: 1.5, whiteSpace: 'pre-wrap', marginBottom: 12 }}>{desc}</div>
            {error !== desc && (
              <details style={{ marginTop: 8, fontSize: 11, background: 'rgba(0,0,0,0.2)', padding: '6px 8px', borderRadius: 4 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, userSelect: 'none' }}>Technical Details</summary>
                <div style={{ marginTop: 4, fontFamily: 'monospace', opacity: 0.8, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{error}</div>
              </details>
            )}
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button onClick={handleRetry} style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 600,
                background: '#fff', color: '#222', border: 'none', borderRadius: 4, cursor: 'pointer',
              }}>
                Retry Connection
              </button>
              <button onClick={handleLaunchNativeClient} style={{
                padding: '6px 14px', fontSize: 12,
                background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 4, cursor: 'pointer',
              }}>
                Open Native Client
              </button>
              <button onClick={handleBack} style={{
                padding: '6px 14px', fontSize: 12,
                background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 4, cursor: 'pointer',
              }}>
                Cancel
              </button>
            </div>
          </div>
        );
      })()}

      {status === 'connecting' && (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.5)', fontSize: 14,
        }}>
          {connectingStep}
        </div>
      )}

      {status === 'connected' && (
        <div style={{ flex: 1, position: 'relative', minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          {navigator.userAgent.toLowerCase().includes('win') && (
            <div style={{
              position: 'absolute',
              top: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(30, 41, 59, 0.85)',
              backdropFilter: 'blur(4px)',
              color: '#f8fafc',
              padding: '6px 12px',
              borderRadius: '4px',
              fontSize: '11px',
              zIndex: 10,
              border: '1px solid rgba(255, 255, 255, 0.1)',
              pointerEvents: 'none'
            }}>
              Enter your Windows credentials in the session window to log in.
            </div>
          )}
          <RdpCanvas
            tunnelId={tunnel.id}
            width={canvasWidth}
            height={canvasHeight}
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
