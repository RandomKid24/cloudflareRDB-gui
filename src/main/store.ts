import Store from 'electron-store';
import { TunnelConfig, AppSettings } from '../shared/types';

interface Schema {
  tunnels: TunnelConfig[];
  settings: AppSettings;
}

const DEFAULT_SETTINGS: AppSettings = {
  cloudflaredPath: '',
  launchOnStartup: false,
  startMinimizedToTray: false,
  theme: 'dark',
  autoReconnectAttempts: 3,
  forgetPasswordAfterSession: true,
};

export const store = new Store<Schema>({
  name: 'cloudflare-rdp-config',
  schema: {
    tunnels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          hostname: { type: 'string' },
          username: { type: 'string' },
          encryptedPassword: { type: 'string' },
          rememberAfterSession: { type: 'boolean' },
          createdAt: { type: 'string' },
          lastConnectedAt: { type: 'string' },
        },
        required: ['id', 'name', 'hostname', 'username', 'encryptedPassword', 'rememberAfterSession', 'createdAt'],
      },
    },
    settings: {
      type: 'object',
      default: DEFAULT_SETTINGS,
    },
  },
  defaults: {
    tunnels: [],
    settings: DEFAULT_SETTINGS,
  },
});

export function getTunnels(): TunnelConfig[] {
  return store.get('tunnels', []);
}

export function setTunnels(tunnels: TunnelConfig[]): void {
  store.set('tunnels', tunnels);
}

export function getSettings(): AppSettings {
  return store.get('settings', DEFAULT_SETTINGS);
}

export function setSettings(settings: AppSettings): void {
  store.set('settings', settings);
  if ('launchOnStartup' in settings) {
    const { app } = require('electron');
    app.setLoginItemSettings({ openAtLogin: settings.launchOnStartup });
  }
}
