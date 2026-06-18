import React, { useState } from 'react';
import { TunnelConfig } from '../../shared/types';

interface Props {
  tunnel?: TunnelConfig;
  onSubmit: (data: { name: string; hostname: string; port: number; username: string; password: string; rememberAfterSession: boolean }) => void;
  onCancel: () => void;
}

export function TunnelForm({ tunnel, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(tunnel?.name ?? '');
  const [hostname, setHostname] = useState(tunnel?.hostname ?? '');
  const [port, setPort] = useState(tunnel?.port ?? 3389);
  const [username, setUsername] = useState(tunnel?.username ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(tunnel?.rememberAfterSession ?? true);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) { setError('Display name is required'); return; }
    if (!hostname.trim()) { setError('Hostname is required'); return; }
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) { setError('Port must be a number between 1 and 65535'); return; }
    if (!username.trim()) { setError('Username is required'); return; }
    if (!tunnel && !password.trim()) { setError('Password is required'); return; }

    const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
    if (!hostnameRegex.test(hostname.trim())) {
      setError('Invalid hostname format (e.g., tunnel.example.com)');
      return;
    }

    onSubmit({
      name: name.trim(),
      hostname: hostname.trim(),
      port: portNum,
      username: username.trim(),
      password,
      rememberAfterSession: remember,
    });
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
        {tunnel ? 'Edit Tunnel' : 'Add Tunnel'}
      </h2>

      <Field label="Display Name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Work PC"
          style={inputStyle}
        />
      </Field>

      <Field label="Cloudflare Tunnel Hostname">
        <input
          type="text"
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          placeholder="rdp-tunnel.example.com"
          style={{ ...inputStyle, fontFamily: 'monospace' }}
        />
      </Field>

      <Field label="Local RDP Port">
        <input
          type="number"
          value={port}
          onChange={(e) => setPort(parseInt(e.target.value) || 3389)}
          placeholder="3389"
          min={1}
          max={65535}
          style={{ ...inputStyle, width: 120 }}
        />
      </Field>

      <Field label="Windows Username">
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="CORP\\user or user@domain.com"
          style={inputStyle}
        />
      </Field>

      <Field label={tunnel ? 'Password (leave blank to keep existing)' : 'Password'}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          style={inputStyle}
        />
      </Field>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          style={{ accentColor: 'var(--accent-blue)' }}
        />
        Remember password after session
      </label>

      {error && (
        <div style={{ fontSize: 12, color: 'var(--accent-red)', padding: '4px 8px', background: 'rgba(239,68,68,0.1)', borderRadius: 4 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
        <button type="submit" style={primaryBtnStyle}>{tunnel ? 'Save Changes' : 'Add Tunnel'}</button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 13,
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  outline: 'none',
  transition: 'border-color 0.15s',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  background: 'var(--accent-blue)',
  color: '#fff',
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 13,
  fontWeight: 500,
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
};
