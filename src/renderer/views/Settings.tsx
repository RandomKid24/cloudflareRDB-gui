import React, { useEffect, useState } from 'react';
import { AppSettings } from '../../shared/types';

const DEFAULT_SETTINGS: AppSettings = {
  cloudflaredPath: '',
  launchOnStartup: false,
  startMinimizedToTray: false,
  theme: 'dark',
  autoReconnectAttempts: 3,
  forgetPasswordAfterSession: true,
};

export function Settings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [cloudflaredStatus, setCloudflaredStatus] = useState<{ found: boolean; path: string | null } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.cloudflareRdp.settings.get().then(setSettings);
    window.cloudflareRdp.app.checkCloudflared().then(setCloudflaredStatus);
  }, []);

  const update = async (partial: Partial<AppSettings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    setSaving(true);
    await window.cloudflareRdp.settings.set(next);
    setSaving(false);
  };

  const browseCloudflared = async () => {
    const path = await window.cloudflareRdp.app.selectFile();
    if (path) {
      await update({ cloudflaredPath: path });
      const status = await window.cloudflareRdp.app.checkCloudflared();
      setCloudflaredStatus(status);
    }
  };

  const isDark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, marginBottom: 24 }}>Settings</h1>

      <Section title="Cloudflared">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: cloudflaredStatus?.found ? 'var(--accent-green)' : 'var(--accent-red)' }}>
              {cloudflaredStatus?.found ? '● Found' : '○ Not found'}
            </span>
            {cloudflaredStatus?.path && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                {cloudflaredStatus.path}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={settings.cloudflaredPath}
              onChange={(e) => update({ cloudflaredPath: e.target.value })}
              placeholder="Path to cloudflared.exe (auto-detected if empty)"
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: 13,
                fontFamily: 'monospace',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 6,
                color: 'var(--text-primary)',
                outline: 'none',
              }}
            />
            <button onClick={browseCloudflared} style={secondaryBtnStyle}>Browse</button>
          </div>
        </div>
      </Section>

      <Section title="Startup & Behavior">
        <Toggle checked={settings.launchOnStartup} onChange={(v) => update({ launchOnStartup: v })} label="Launch on system startup" />
        <Toggle checked={settings.startMinimizedToTray} onChange={(v) => update({ startMinimizedToTray: v })} label="Start minimized to tray" />
        <Toggle checked={settings.forgetPasswordAfterSession} onChange={(v) => update({ forgetPasswordAfterSession: v })} label="Forget password after each session" />
      </Section>

      <Section title="Connection">
        <Field label="Auto-reconnect attempts">
          <input
            type="number"
            min={0}
            max={10}
            value={settings.autoReconnectAttempts}
            onChange={(e) => update({ autoReconnectAttempts: Math.max(0, Math.min(10, parseInt(e.target.value) || 0)) })}
            style={{
              width: 80,
              padding: '6px 10px',
              fontSize: 13,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 6,
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
        </Field>
      </Section>

      <Section title="Appearance">
        <select
          value={settings.theme}
          onChange={(e) => update({ theme: e.target.value as AppSettings['theme'] })}
          style={{
            padding: '8px 12px',
            fontSize: 13,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            color: 'var(--text-primary)',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="system">System</option>
        </select>
      </Section>

      {saving && (
        <div style={{ position: 'fixed', bottom: 16, right: 16, padding: '8px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
          Saving...
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{label}</span>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: 'var(--accent-blue)', width: 16, height: 16 }}
      />
      {label}
    </label>
  );
}

const secondaryBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 500,
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
};
