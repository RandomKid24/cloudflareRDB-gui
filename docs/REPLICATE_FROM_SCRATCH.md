# TunnelGate — Complete Replication Guide

> **Purpose:** Build a cross-platform Electron app that provides one-click RDP connections through Cloudflare Zero Trust TCP tunnels, with an in-app FreeRDP-based native viewer rendered to `<canvas>`.
>
> **Stack:** Electron 31 + React 18 + TypeScript + Vite 5 + C++17 (FreeRDP 3) + N-API (node-addon-api)
>
> **Platforms:** Windows x64, macOS ARM64, Linux x64

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Project Scaffolding](#3-project-scaffolding)
4. [Shared Layer: Types &amp; IPC Channels](#4-shared-layer-types--ipc-channels)
5. [Main Process: Store &amp; Logger](#5-main-process-store--logger)
6. [Main Process: Credential Store](#6-main-process-credential-store)
7. [Main Process: Tunnel Manager (cloudflared)](#7-main-process-tunnel-manager-cloudflared)
8. [Main Process: RDP View Manager (Addon Bridge)](#8-main-process-rdp-view-manager-addon-bridge)
9. [Main Process: IPC Handlers](#9-main-process-ipc-handlers)
10. [Main Process: App Entry (Window + Tray)](#10-main-process-app-entry-window--tray)
11. [Preload Bridge](#11-preload-bridge)
12. [Native C++ Addon: CMakeLists.txt](#12-native-c-addon-cmakeliststxt)
13. [Native C++ Addon: rdp_session.h](#13-native-c-addon-rdp_sessionh)
14. [Native C++ Addon: rdp_session.cpp](#14-native-c-addon-rdp_sessioncpp)
15. [Native C++ Addon: rdp_module.cpp](#15-native-c-addon-rdp_modulecpp)
16. [Windows OpenSSL Legacy Provider (CRITICAL)](#16-windows-openssl-legacy-provider-critical)
17. [Build Script: build-native.js](#17-build-script-build-nativejs)
18. [Electron-Builder Packaging](#18-electron-builder-packaging)
19. [Renderer Entry &amp; App Shell](#19-renderer-entry--app-shell)
20. [Renderer: Hooks](#20-renderer-hooks)
21. [Renderer: Views](#21-renderer-views)
22. [Renderer: RdpCanvas Component](#22-renderer-rdpcanvas-component)
23. [Dynamic RDP Resolution &amp; Fullscreen](#23-dynamic-rdp-resolution--fullscreen)
24. [Canvas Rendering Pipeline](#24-canvas-rendering-pipeline)
25. [Platform Differences](#25-platform-differences)
26. [Build &amp; CI/CD Pipeline](#26-build--cicd-pipeline)
27. [Complete Error Reference](#27-complete-error-reference)
28. [All Known Bugs &amp; Fixes](#28-all-known-bugs--fixes)
29. [File Reference Summary](#29-file-reference-summary)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  Renderer Process (React 18 + Vite 5)                    │
│  ┌────────────┐ ┌────────────┐ ┌───────┐ ┌────────────┐  │
│  │ Tunnels    │ │ RdpView    │ │ Logs  │ │ Settings   │  │
│  │ View       │ │ (Canvas)   │ │ View  │ │ View       │  │
│  └──────┬─────┘ └─────┬──────┘ └──┬────┘ └──────┬─────┘  │
│         │             │           │              │        │
│  ┌──────┴─────────────┴───────────┴──────────────┴──────┐ │
│  │            window.cloudflareRdp (contextBridge)       │ │
│  └──────────────────────┬───────────────────────────────┘ │
└─────────────────────────┼─────────────────────────────────┘
                          │ IPC (contextIsolated)
┌─────────────────────────┼─────────────────────────────────┐
│  Main Process (Node.js + Electron)                        │
│  ┌─────────────┐ ┌──────────────┐ ┌───────────────────┐   │
│  │ Tunnel      │ │ RdpView      │ │ CredentialStore   │   │
│  │ Manager     │ │ Manager      │ │ (safeStorage)     │   │
│  └──────┬──────┘ └──────┬───────┘ └───────────────────┘   │
│         │               │                                  │
│  ┌──────┴───────────────┴──────────────────────────────┐   │
│  │                  ipcHandlers.ts                      │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                  │
│  ┌──────────────────────┴──────────────────────────────┐   │
│  │          Native Addon (C++ N-API)                    │   │
│  │   rdp_addon.node                                    │   │
│  │     ├── rdp_module.cpp  (N-API exports)              │   │
│  │     └── rdp_session.cpp (FreeRDP 3)                 │   │
│  │                    ↕                                 │   │
│  │         FreeRDP 3 Library (freerdp3/winpr3)          │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow for a Frame

```
C++ endPaint → BGR→RGBA swap → Napi::Buffer::Copy()
  → ThreadSafeFunction BlockingCall
    → Main Process JS callback (forwardFrame)
      → webContents.send('rdp:frame', tunnelId, rect, Buffer)
        → Preload ipcRenderer.on('rdp:frame')
          → contextBridge → React RdpCanvas (frameHandler)
            → Push to pendingRef queue
              → requestAnimationFrame(paint)
                → Offscreen canvas putImageData
                  → Visible canvas drawImage
```

---

## 2. Prerequisites

### Required Tools

| Tool              | Version                                                    | Purpose                |
| ----------------- | ---------------------------------------------------------- | ---------------------- |
| Node.js           | 18+                                                        | Runtime & build        |
| npm               | 9+                                                         | Package manager        |
| cmake             | 3.20+                                                      | C++ addon build        |
| C++ compiler      | VS 2022/2026 BuildTools (Win) / Apple Clang (Mac) / GCC (Linux) | C++17 compilation      |
| FreeRDP           | 3.x (dev headers)                                          | RDP protocol library   |
| OpenSSL           | 3.x (dev headers)                                          | Cryptography (for RC4) |

### Platform-Specific Setup

**Windows (PowerShell as Administrator):**

```powershell
# 1. Install Visual Studio Build Tools (MSVC compiler)
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.Windows11SDK.22621 --includeRecommended --passive"

# 2. Install CMake
winget install Kitware.CMake

# 3. Install vcpkg
git clone https://github.com/Microsoft/vcpkg.git C:\vcpkg
C:\vcpkg\bootstrap-vcpkg.bat

# 4. Install FreeRDP 3 and OpenSSL (compiles from source, ~15min)
C:\vcpkg\vcpkg install freerdp:x64-windows

# 5. Set environment variable (optional, cmake-js auto-detects)
[System.Environment]::SetEnvironmentVariable("VCPKG_ROOT", "C:\vcpkg", "Machine")

# 6. Clone and build the addon
cd C:\path\to\TunnelGate
npm install
$env:CMAKE_GENERATOR = "Visual Studio 17 2022"
npm run build:native
```

**macOS:**

```bash
brew install cmake freerdp openssl
```

**Linux (Ubuntu/Debian):**

```bash
sudo apt-get install cmake libfreerdp-dev libssl-dev build-essential
# For FreeRDP 3:
sudo apt-get install freerdp3-dev
```

---

## 3. Project Scaffolding

### 3.1 package.json

```json
{
  "name": "tunnelgate",
  "version": "1.0.0",
  "main": "dist/main/index.js",
  "scripts": {
    "dev:renderer": "vite",
    "dev:main": "tsc -p tsconfig.main.json && electron .",
    "dev": "concurrently \"npm run dev:renderer\" \"npm run dev:main\"",
    "build:renderer": "vite build",
    "build:main": "tsc -p tsconfig.main.json",
    "build:preload": "tsc -p tsconfig.preload.json",
    "build:native": "node scripts/build-native.js",
    "build": "npm run build:main && npm run build:preload && npm run build:renderer",
    "build:all": "npm run build:native && npm run build",
    "electron:build": "npm run build:all && electron-builder",
    "electron:build:linux": "npm run build:native && npm run build && electron-builder --linux",
    "electron:build:mac": "npm run build:native && npm run build && electron-builder --mac",
    "pack": "npm run build:all && electron-builder --win",
    "pack:dir": "npm run build && electron-builder --win --dir"
  },
  "dependencies": {
    "electron-log": "^5.1.1",
    "electron-store": "^8.2.0",
    "node-addon-api": "^8.0.0",
    "tree-kill": "^1.2.2",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/uuid": "^9.0.8",
    "@vitejs/plugin-react": "^4.3.0",
    "concurrently": "^8.2.2",
    "electron": "31.7.7",
    "electron-builder": "^24.13.0",
    "cmake-js": "^7.3.0",
    "@electron/rebuild": "^3.6.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
```

### 3.2 TypeScript Configs

**tsconfig.json** (renderer + shared):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "paths": { "@shared/*": ["./src/shared/*"] }
  },
  "include": ["src/renderer/**/*", "src/shared/**/*", "src/renderer/types.d.ts"]
}
```

**tsconfig.main.json** (main process):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "sourceMap": true
  },
  "include": ["src/main/**/*", "src/shared/**/*"]
}
```

**tsconfig.preload.json** (preload):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "sourceMap": true
  },
  "include": ["src/preload/**/*", "src/shared/**/*"]
}
```

### 3.3 Vite Config

**vite.config.ts:**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  build: { outDir: 'dist/renderer', emptyOutDir: true },
  server: { port: 5173, strictPort: false },
  resolve: { alias: { '@shared': path.resolve(__dirname, 'src/shared') } },
});
```

### 3.4 index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';" />
  <title>TunnelGate</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/renderer/main.tsx"></script>
</body>
</html>
```

### 3.5 .gitignore

```
node_modules/
dist/
release/
*.blockmap
.DS_Store
Thumbs.db
*.log
native/rdp-addon/build/
src/native/rdp-addon/build/
```

---

## 4. Shared Layer: Types & IPC Channels

**`src/shared/types.ts`:**

```ts
export const DEFAULT_RDP_PORT = 3389;

export interface TunnelConfig {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  encryptedPassword: string;   // base64 of safeStorage.encryptString()
  rememberAfterSession: boolean;
  createdAt: string;            // ISO 8601
  lastConnectedAt?: string;
}

export interface TunnelFormData {
  name: string;
  hostname: string;
  port: number;
  username: string;
  password: string;            // plaintext (never persisted)
  rememberAfterSession: boolean;
}

export type TunnelStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting';

export interface TunnelRuntimeState {
  tunnelId: string;
  pid?: number;
  localPort?: number;
  status: TunnelStatus;
  lastError?: string;
  capturedOutput?: string;
}

export interface LogEntry {
  id: string;
  tunnelId: string;
  tunnelName: string;
  timestamp: string;          // ISO 8601
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export interface AppSettings {
  cloudflaredPath: string;
  launchOnStartup: boolean;
  startMinimizedToTray: boolean;
  autoReconnectAttempts: number;       // default 3
  forgetPasswordAfterSession: boolean; // default true
}

export const IPC_CHANNELS = {
  TUNNELS_LIST: 'tunnels:list',
  TUNNELS_ADD: 'tunnels:add',
  TUNNELS_UPDATE: 'tunnels:update',
  TUNNELS_DELETE: 'tunnels:delete',
  TUNNEL_CONNECT: 'tunnel:connect',
  TUNNEL_DISCONNECT: 'tunnel:disconnect',
  TUNNEL_STATUS_CHANGE: 'tunnel:status-change',
  TUNNEL_LOG: 'tunnel:log',
  TUNNELS_EXPORT_LOGS: 'tunnels:export-logs',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  APP_GET_VERSION: 'app:get-version',
  DIALOG_SELECT_FILE: 'dialog:select-file',
  CHECK_CLOUDFLARED: 'check:cloudflared',
  RDP_VIEW_CONNECT: 'rdp:view-connect',
  RDP_VIEW_DISCONNECT: 'rdp:view-disconnect',
  RDP_VIEW_FRAME: 'rdp:frame',
  RDP_VIEW_EVENT: 'rdp:event',
  RDP_VIEW_MOUSE: 'rdp:view-mouse',
  RDP_VIEW_KEYBOARD: 'rdp:view-keyboard',
  RDP_AVAILABLE: 'rdp:available',
  RDP_VIEW_UPDATE_PASSWORD: 'rdp:view-update-password',
  LAUNCH_NATIVE_CLIENT: 'rdp:launch-native-client',
} as const;

export type RdpViewStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
```

---

## 5. Main Process: Store & Logger

### Store (`src/main/store.ts`)

Uses `electron-store` for JSON-persisted config with schema validation.

```ts
import Store from 'electron-store';

interface Schema { tunnels: TunnelConfig[]; settings: AppSettings; }

const DEFAULT_SETTINGS: AppSettings = {
  cloudflaredPath: '', launchOnStartup: false, startMinimizedToTray: false,
  autoReconnectAttempts: 3, forgetPasswordAfterSession: true,
};

export const store = new Store<Schema>({
  name: 'tunnelgate-config',
  schema: {
    tunnels: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, name: { type: 'string' }, hostname: { type: 'string' },
      port: { type: 'number', default: 3389 }, username: { type: 'string' },
      encryptedPassword: { type: 'string' }, rememberAfterSession: { type: 'boolean' },
      createdAt: { type: 'string' }, lastConnectedAt: { type: 'string' },
    }, required: ['id','name','hostname','username','encryptedPassword','rememberAfterSession','createdAt'] } },
    settings: { type: 'object', default: DEFAULT_SETTINGS },
  },
  defaults: { tunnels: [], settings: DEFAULT_SETTINGS },
});

export function getTunnels(): TunnelConfig[] { return store.get('tunnels', []); }
export function setTunnels(tunnels: TunnelConfig[]): void { store.set('tunnels', tunnels); }
export function getSettings(): AppSettings { return store.get('settings', DEFAULT_SETTINGS); }
export function setSettings(settings: AppSettings): void {
  store.set('settings', settings);
  if ('launchOnStartup' in settings) {
    require('electron').app.setLoginItemSettings({ openAtLogin: settings.launchOnStartup });
  }
}
```

### Logger (`src/main/logger.ts`)

Uses `electron-log` for file output + in-memory 500-entry ring buffer for UI display. All credentials scrubbed.

```ts
import log from 'electron-log';
import { v4 as uuidv4 } from 'uuid';

const MAX_RING_BUFFER = 500;
const logRingBuffer: LogEntry[] = [];

log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : false;

export function writeLog(tunnelId: string, tunnelName: string, level: string, message: string): void {
  const entry: LogEntry = {
    id: uuidv4(), tunnelId, tunnelName,
    timestamp: new Date().toISOString(), level,
    message: message.replace(/(password|pass|pwd)[=:]\s*\S+/gi, '$1=***'),
  };
  logRingBuffer.push(entry);
  if (logRingBuffer.length > MAX_RING_BUFFER) logRingBuffer.shift();

  const logFn = level === 'error' ? log.error : level === 'warn' ? log.warn
    : level === 'debug' ? log.debug : log.info;
  logFn(`[${tunnelName}] ${message}`);
}

export function getLogs(tunnelId?: string): LogEntry[] {
  return tunnelId ? logRingBuffer.filter((e) => e.tunnelId === tunnelId) : [...logRingBuffer];
}
export function getCombinedLogs(): LogEntry[] { return [...logRingBuffer]; }
export function clearLogs(): void { logRingBuffer.length = 0; }
```

---

## 6. Main Process: Credential Store

**`src/main/credentialStore.ts`:**

Uses Electron `safeStorage` for encryption (AES-256-GCM on each platform) and Windows `cmdkey` for native RDP credential injection.

```ts
import { safeStorage } from 'electron';
import { spawn } from 'child_process';

const isWin = process.platform === 'win32';

export class CredentialStore {
  encrypt(password: string): string {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Encryption unavailable');
    return safeStorage.encryptString(password).toString('base64');
  }

  decrypt(encryptedBase64: string): string {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Decryption unavailable');
    return safeStorage.decryptString(Buffer.from(encryptedBase64, 'base64'));
  }

  async injectCredential(tunnelId: string, tunnelName: string, username: string,
                          password: string, port: number): Promise<void> {
    // Windows only: injects into Windows Credential Manager for mstsc
    // Uses cmdkey /generic:TERMSRV/localhost:<port> /user:<user> /pass:<pass>
    // Also injects for 127.0.0.1 since cloudflared binds to both
  }

  async clearCredential(tunnelId: string, tunnelName: string, port: number): Promise<void> {
    // Windows only: cmdkey /delete:TERMSRV/localhost:<port>
    // and /delete:TERMSRV/127.0.0.1:<port>
  }

  isEncryptionAvailable(): boolean { return safeStorage.isEncryptionAvailable(); }
}
```

**Key details:**

- On Windows, credentials are injected into `TERMSRV/localhost:<port>` AND `TERMSRV/127.0.0.1:<port>`
- Credentials are cleared after session if `forgetPasswordAfterSession` setting is true
- On macOS/Linux, credential injection is skipped (log message only)

---

## 7. Main Process: Tunnel Manager (cloudflared)

**`src/main/tunnelManager.ts`:**

Manages the lifecycle of `cloudflared access tcp` processes.

### Port Selection

```ts
function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(preferred, '127.0.0.1', () => {
      const port = (server.address() as any).port;
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(findFreePort(preferred + 1)));
  });
}
```

### Cloudflared Search Order

1. User-specified path from Settings
2. Common install directories:
   - Windows: `%LOCALAPPDATA%\cloudflared\`, `%PROGRAMFILES%\cloudflared\`
   - macOS: `/usr/local/bin/`, `/opt/homebrew/bin/`
   - Linux: `/usr/local/bin/`, `/usr/bin/`
3. System PATH (`where`/`which`)
4. Bundled in `resources/cloudflared*`

### Spawning cloudflared

```ts
const args = [
  'access', 'tcp',
  '--hostname', config.hostname,
  '--url', `localhost:${port}`,
  '--loglevel', 'debug',
];
const proc = spawn(cloudflaredPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
```

### Ready Detection

`waitForReady()` monitors stdout/stderr for keywords: `ready`, `listening`, `connection registered`, `Started serving`, `Start Websocket listener`. Times out after 30 seconds.

### Reconnection

Exponential backoff: `min(1000 × 2^(n-1), 15000)` ms, max attempts from settings (default 3). Clears stderr/stdout buffers before each retry.

### Disconnect

Uses `tree-kill` (SIGTERM) to kill the process tree. Clears Windows credentials if `forgetPasswordAfterSession` is enabled.

### Launch Native RDP Client

- **Windows**: `mstsc.exe /v:localhost:<port>` (injects credential first via cmdkey)
- **macOS**: `open -b com.microsoft.rdc.macos --args full address:s:localhost:<port>`
- **Linux**: Tries `xfreerdp /v:localhost:<port>` then `remmina --connect rdp://...`

---

## 8. Main Process: RDP View Manager (Addon Bridge)

**`src/main/rdpViewManager.ts`:**

Bridges between the Electron main process and the native C++ addon.

### Addon Loading

```ts
const addonDir = path.join(process.resourcesPath, 'native', 'rdp-addon', 'build', 'Release');
const addonPath = path.join(addonDir, 'rdp_addon.node');

// Windows OpenSSL setup (MUST happen before require())
if (isWin) {
  process.env.PATH = `${addonDir};${process.env.PATH}`;
  process.env.OPENSSL_MODULES = path.join(addonDir, 'ossl-modules');
  // Write openssl.cnf if it doesn't exist, then set OPENSSL_CONF
  process.env.OPENSSL_CONF = path.join(addonDir, 'openssl.cnf');
}

this.addon = require(addonPath);  // Loads the .node (DLL/dylib/so)
```

### Session Lifecycle

```ts
interface RdpAddon {
  createSession(host: string, port: number, width: number, height: number,
    username: string, password: string,
    onBitmap: (x: number, y: number, w: number, h: number, buf: Buffer) => void,
    onEvent: (type: string, ...args: any[]) => void
  ): number;
  destroySession(id: number): void;
  sendPointerEvent(id: number, flags: number, x: number, y: number): void;
  sendKeyboardEvent(id: number, flags: number, code: number): void;
}
```

**connectView():**

1. Checks addon is loaded
2. Destroys existing session for same tunnelId if present
3. Sets FreeRDP log env vars (`WLOG_*`)
4. Uses stored dimensions if width/height not provided
5. Calls `addon.createSession()` to connect to `127.0.0.1:<port>`
6. Stores connection dimensions in `lastDimensions` map

**Dimension management:**

```ts
private lastDimensions = new Map<string, { width: number; height: number }>();

// When connecting without explicit dimensions, use stored values:
if (width === undefined || height === undefined) {
  const stored = this.lastDimensions.get(tunnelId);
  width = stored?.width ?? DEFAULT_WIDTH;
  height = stored?.height ?? DEFAULT_HEIGHT;
}
```

**Events forwarded to renderer:**

- `rdp:frame` — bitmap updates from `forwardFrame()`
- `rdp:event` — disconnect, error, resize, password-expired from `handleEvent()`

**Windows 131087 password-expired false positive interception:**

```ts
// In the connectView() catch block:
if (isWin && rawMsg.includes('code=131087')) {
  throw new Error('Failed to create RDP session: RDP authentication failed (NLA compatibility issue)');
}
```

---

## 9. Main Process: IPC Handlers

**`src/main/ipcHandlers.ts`:**

Registers all `ipcMain.handle()` calls. Key handlers:

| Channel                      | Handler                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `tunnels:add`              | Validate hostname regex, encrypt password with safeStorage, generate UUID, save to store                                   |
| `tunnel:connect`           | Decrypt password, call `tunnelManager.connect()`                                                                         |
| `rdp:view-connect`         | Clear existing Windows credential, decrypt password, re-inject credential (Windows), call `rdpViewManager.connectView()` |
| `rdp:view-update-password` | Re-encrypt password in config store, re-inject Windows credential (if Win), disconnect view, reconnect with new password   |
| `rdp:launch-native-client` | Forward to `tunnelManager.launchNativeClient()`                                                                          |
| `check:cloudflared`        | Search all paths + system PATH                                                                                             |

**Hostname validation regex:**

```
/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/
```

---

## 10. Main Process: App Entry (Window + Tray)

**`src/main/index.ts`:**

### Window Creation

```ts
function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: Math.min(1000, screen.getPrimaryDisplay().workAreaSize.width),
    height: Math.min(700, screen.getPrimaryDisplay().workAreaSize.height),
    minWidth: 900, minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,     // REQUIRED for security
      nodeIntegration: false,     // REQUIRED for security
      sandbox: false,             // Required for preload access
    },
  });

  rdpViewManager?.setWindow(mainWindow);  // CRITICAL: must be AFTER window creation

  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Close hides to tray (PREVENT_WINDOW_CLOSE = true)
  mainWindow.on('close', (event) => {
    if (!isQuitting) { event.preventDefault(); mainWindow?.hide(); }
  });
}
```

### Bug 2 — setWindow Before Window Created

**MUST call `rdpViewManager.setWindow(mainWindow)` AFTER `new BrowserWindow()`**. If called before, `mainWindow` is still null and frames never reach the renderer (black screen).

### Tray

4 programmatic 16x16 RGBA tray icons (gray, yellow, green, red) generated from Buffer. Context menu shows tunnel list with connect/disconnect actions, "Open Dashboard", "Quit". Menu updated every 2 seconds.

### Initialization Order

```ts
app.whenReady().then(() => {
  createTray();         // Creates TunnelManager + RdpViewManager internally
  createMainWindow();   // Window + setWindow + load page
});
```

---

## 11. Preload Bridge

**`src/preload/index.ts`:**

Uses `contextBridge.exposeInMainWorld()` to safely expose IPC calls to the renderer. All communication typed through the shared `IPC_CHANNELS` constants.

```ts
contextBridge.exposeInMainWorld('cloudflareRdp', {
  tunnels: {
    list, add, update, delete, connect, disconnect,
    exportLogs, getLogs, decryptPassword,
    onStatusChange, onLog, onTrayConnect,
  },
  settings: { get, set },
  app: { getVersion, selectFile, checkCloudflared },
  rdp: {
    isAvailable, launchNativeClient,
    connect, disconnect, sendMouse, sendKeyboard,
    onFrame, onEvent, updatePassword,
  },
});
```

**Renderer side type declaration (`src/renderer/types.d.ts`):**

```ts
declare global {
  interface Window { cloudflareRdp: { /* full API shape */ }; }
}
```

**Security:** `contextIsolation: true`, `nodeIntegration: false`, CSP in HTML.

---

## 12. Native C++ Addon: CMakeLists.txt

**`src/native/rdp-addon/CMakeLists.txt`:**

```cmake
cmake_minimum_required(VERSION 3.20)
project(rdp_addon LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# FREERDP_ROOT is set via -D from build-native.js per platform
find_path(FREERDP_INCLUDE_DIR freerdp/freerdp.h
  HINTS ${FREERDP_ROOT} PATH_SUFFIXES include include/freerdp2 include/freerdp3)
find_path(WINPR_INCLUDE_DIR winpr/winpr.h
  HINTS ${FREERDP_ROOT} PATH_SUFFIXES include include/winpr2 include/winpr3)

find_library(FREERDP_LIBRARY NAMES freerdp3 freerdp2 freerdp HINTS ${FREERDP_ROOT} PATH_SUFFIXES lib)
find_library(FREERDP_CLIENT_LIBRARY NAMES freerdp-client3 freerdp-client2 freerdp-client HINTS ${FREERDP_ROOT} PATH_SUFFIXES lib)
find_library(WINPR_LIBRARY NAMES winpr3 winpr2 winpr HINTS ${FREERDP_ROOT} PATH_SUFFIXES lib)
find_library(LIBCRYPTO_LIBRARY NAMES crypto libcrypto HINTS ${FREERDP_ROOT} PATH_SUFFIXES lib)
find_path(OPENSSL_INCLUDE_DIR openssl/provider.h HINTS ${FREERDP_ROOT} PATH_SUFFIXES include)

add_library(rdp_addon SHARED rdp_module.cpp rdp_session.cpp ${CMAKE_JS_SRC})
target_include_directories(rdp_addon PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR} ${CMAKE_JS_INC} ${NAPI_DIR}
  ${FREERDP_INCLUDE_DIR} ${WINPR_INCLUDE_DIR} ${OPENSSL_INCLUDE_DIR})
target_link_libraries(rdp_addon PRIVATE
  ${FREERDP_LIBRARY} ${FREERDP_CLIENT_LIBRARY} ${WINPR_LIBRARY} ${LIBCRYPTO_LIBRARY} ${CMAKE_JS_LIB})
set_target_properties(rdp_addon PROPERTIES PREFIX "" SUFFIX ".node")
```

**Critical — Bug 7: CRT Runtime Mismatch (`/MT` vs `/MD`):**

- FreeRDP DLLs are built with `/MD` (dynamic CRT)
- The addon MUST also use `/MD` to share the CRT heap
- In `build-native.js`, this is set via: `-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDLL`
- Without this, allocations in FreeRDP that are freed by the addon (or vice versa) cause heap corruption

---

## 13. Native C++ Addon: rdp_session.h

**`src/native/rdp-addon/rdp_session.h`:**

```cpp
#pragma once
#include <napi.h>
#include <freerdp/freerdp.h>
// ... other FreeRDP headers

// Interface for frame/event callbacks (implemented by JsFrameListener in rdp_module.cpp)
class RdpFrameListener {
public:
  virtual ~RdpFrameListener() = default;
  virtual void onBitmapUpdate(int x, int y, int w, int h, const void* data, size_t size) = 0;
  virtual void onResize(int w, int h) = 0;
  virtual void onDisconnect(const char* reason) = 0;
  virtual void onError(const char* msg) = 0;
};

class RdpSession {
public:
  RdpSession(const std::string& host, int port, int width, int height,
             const std::string& username, const std::string& password,
             RdpFrameListener* listener);
  ~RdpSession();

  bool connect();
  void disconnect();
  bool isConnected() const { return connected_; }
  const std::string& lastError() const { return lastError_; }

  void sendPointerEvent(int flags, int x, int y);
  void sendKeyboardEvent(int flags, UINT16 code);
  void resize(int width, int height);

private:
  // Static callbacks (FreeRDP 3 API — see Bug 6)
  static BOOL beginPaint(rdpContext* ctx);
  static BOOL endPaint(rdpContext* ctx);
  static BOOL desktopResize(rdpContext* ctx);
  static BOOL postConnectCallback(freerdp* instance);

  freerdp* instance_ = nullptr;
  rdpContext* context_ = nullptr;
  std::thread* updateThread_ = nullptr;
  std::atomic<bool> connected_{false};
  std::atomic<bool> running_{false};
  RdpFrameListener* listener_ = nullptr;
  // ... host_, port_, width_, height_, username_, password_ members

  void pump();
  static RdpSession* getSelf(rdpContext* ctx);
};
```

### The `RdpSessionContext` Pattern

```cpp
struct RdpSessionContext : public rdpContext {
  RdpSession* session;
};
```

Used in static callbacks to recover the `RdpSession` instance:

```cpp
static RdpSession* getSelf(rdpContext* ctx) {
  return ((RdpSessionContext*)ctx)->session;
}
```

---

## 14. Native C++ Addon: rdp_session.cpp

**`src/native/rdp-addon/rdp_session.cpp`:**

### connect() — Step by Step

1. **On Windows only: Call `ensureLegacyProvider()`** (see Section 16)
2. **Create FreeRDP instance:**

   ```cpp
   instance_ = freerdp_new();
   instance_->ContextSize = sizeof(RdpSessionContext);
   freerdp_context_new(instance_);
   ((RdpSessionContext*)context_)->session = this;
   ```
3. **Set connection settings:**

   ```cpp
   rdpSettings* settings = context_->settings;  // FreeRDP 3: instance->context->settings
   freerdp_settings_set_string(settings, FreeRDP_ServerHostname, host_.c_str());
   freerdp_settings_set_uint32(settings, FreeRDP_ServerPort, port_);
   freerdp_settings_set_uint32(settings, FreeRDP_DesktopWidth, width_);
   freerdp_settings_set_uint32(settings, FreeRDP_DesktopHeight, height_);
   freerdp_settings_set_uint32(settings, FreeRDP_ColorDepth, 32);
   ```
4. **Set credentials with domain parsing:**

   ```cpp
   // Forward slash → backslash for domain\user format
   std::string normUsername = username_;
   for (char& c : normUsername) { if (c == '/') c = '\\'; }
   freerdp_settings_set_string(settings, FreeRDP_Username, normUsername.c_str());
   freerdp_settings_set_string(settings, FreeRDP_Password, password_.c_str());

   // Parse domain from username (e.g., "DOMAIN\user")
   char* parsedUser = nullptr, *parsedDomain = nullptr;
   if (freerdp_parse_username(normUsername.c_str(), &parsedUser, &parsedDomain)) {
     // Set parsed user and domain separately
   }
   ```
5. **Security settings:**

   ```cpp
   // Enable all security protocols — server chooses HYBRID (NLA + TLS)
   freerdp_settings_set_bool(settings, FreeRDP_NlaSecurity, TRUE);
   freerdp_settings_set_bool(settings, FreeRDP_TlsSecurity, TRUE);
   freerdp_settings_set_bool(settings, FreeRDP_RdpSecurity, TRUE);
   freerdp_settings_set_uint32(settings, FreeRDP_TlsSecLevel, 1);  // Allow self-signed certs
   freerdp_settings_set_bool(settings, FreeRDP_IgnoreCertificate, TRUE);
   freerdp_settings_set_bool(settings, FreeRDP_Authentication, TRUE);
   freerdp_settings_set_bool(settings, FreeRDP_NSCodec, TRUE);
   freerdp_settings_set_bool(settings, FreeRDP_RemoteFxCodec, TRUE);
   freerdp_settings_set_bool(settings, FreeRDP_FastPathOutput, TRUE);
   ```
6. **Set callbacks:**

   ```cpp
   instance_->VerifyCertificate = verifyCertificateCallback;
   instance_->VerifyChangedCertificate = verifyChangedCertificateCallback;
   instance_->PostConnect = postConnectCallback;
   ```
7. **Loopback cert trust** — `verifyCertificateCallback` trusts certs for `127.0.0.1` and `localhost` but rejects any other host (security through tunnel).
8. **Enable debug logging:**

   ```cpp
   WLog_SetLogLevel(WLog_Get("com.freerdp.core.tls"), WLOG_TRACE);
   WLog_SetLogLevel(WLog_GetRoot(), WLOG_TRACE);
   ```
9. **Connect:** `freerdp_connect(instance_)` — on failure, capture error code + string.
10. **On success:** Start pump thread: `updateThread_ = new std::thread(&RdpSession::pump, this);`

### postConnectCallback

```cpp
static BOOL postConnectCallback(freerdp* instance) {
  // 1. Initialize GDI with BGRX32 pixel format
  gdi_init(instance, PIXEL_FORMAT_BGRX32);

  // 2. Register paint/resize callbacks
  self->context_->update->BeginPaint = beginPaint;
  self->context_->update->EndPaint = endPaint;
  self->context_->update->DesktopResize = desktopResize;
}
```

### Pump Thread

```cpp
void pump() {
  while (running_ && connected_) {
    HANDLE handles[64];
    DWORD ncount = freerdp_get_event_handles(context_, handles, 64);
    if (ncount == 0) { Sleep(10); continue; }

    if (!freerdp_check_event_handles(context_)) {
      // On failure: check shall_disconnect, or count consecutive failures
      // After 50 consecutive failures → force disconnect
    }

    Sleep(10);  // usleep(10000) on non-Windows
  }
}
```

### endPaint — Pixel Conversion (BGRX32 → RGBA)

```cpp
static BOOL endPaint(rdpContext* ctx) {
  rdpGdi* gdi = ctx->gdi;
  HGDI_WND wnd = gdi->primary->hdc->hwnd;
  if (wnd->invalid->null) return TRUE;

  int x = wnd->invalid->x, y = wnd->invalid->y;
  int w = wnd->invalid->w, h = wnd->invalid->h;
  int fullW = gdi->width;
  int stride = gdi->stride;  // stride may be > width * 4 (alignment padding!)

  const BYTE* src = gdi->primary_buffer;
  std::vector<uint8_t> rgba(w * h * 4);

  for (int row = 0; row < h; row++) {
    const BYTE* srcRow = src + (y + row) * stride + x * 4;
    uint8_t* dstRow = rgba.data() + row * w * 4;
    for (int col = 0; col < w; col++) {
      dstRow[col * 4 + 0] = srcRow[col * 4 + 2];  // R = B
      dstRow[col * 4 + 1] = srcRow[col * 4 + 1];  // G = G
      dstRow[col * 4 + 2] = srcRow[col * 4 + 0];  // B = R
      dstRow[col * 4 + 3] = 255;                   // A
    }
  }

  self->listener_->onBitmapUpdate(x, y, w, h, rgba.data(), rgba.size());
  wnd->invalid->null = TRUE;
}
```

**Stride note:** `gdi->stride` may include alignment padding. Source indexing uses `(y + row) * stride + x * 4`. Destination uses `row * w * 4` (tightly packed RGBA).

### desktopResize

```cpp
static BOOL desktopResize(rdpContext* ctx) {
  int newW = freerdp_settings_get_uint32(ctx->settings, FreeRDP_DesktopWidth);
  int newH = freerdp_settings_get_uint32(ctx->settings, FreeRDP_DesktopHeight);
  self->listener_->onResize(newW, newH);  // Forwarded to JS
}
```

---

## 15. Native C++ Addon: rdp_module.cpp

**`src/native/rdp-addon/rdp_module.cpp`:**

### N-API Exports

```cpp
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("createSession", Napi::Function::New(env, CreateSession));
  exports.Set("destroySession", Napi::Function::New(env, DestroySession));
  exports.Set("sendPointerEvent", Napi::Function::New(env, SendPointerEvent));
  exports.Set("sendKeyboardEvent", Napi::Function::New(env, SendKeyboardEvent));
  return exports;
}
NODE_API_MODULE(rdp_addon, Init)
```

### Session Registry

```cpp
static std::map<int, SessionHolder> sessions_;
static std::mutex sessionsMutex_;
static int nextId_ = 1;
```

Thread-safe map of session ID → {RdpSession*, JsFrameListener*}. Mutex-guarded for all operations.

### JsFrameListener — ThreadSafeFunction Bridge

Uses 4 `Napi::ThreadSafeFunction` instances (queue size 1):

- `bitmapCb_` — for `onBitmapUpdate`
- `resizeCb_`, `disconnectCb_`, `errorCb_` — all share the same JS onEvent callback

**onBitmapUpdate:**

```cpp
void onBitmapUpdate(int x, int y, int w, int h, const void* data, size_t size) override {
  auto copy = std::make_shared<std::vector<uint8_t>>(
    static_cast<const uint8_t*>(data),
    static_cast<const uint8_t*>(data) + size);
  bitmapCb_.BlockingCall([x, y, w, h, copy](Napi::Env env, Napi::Function jsCallback) {
    auto buf = Napi::Buffer<uint8_t>::Copy(env, copy->data(), copy->size());
    jsCallback.Call({Napi::Number::New(env, x), Napi::Number::New(env, y),
                     Napi::Number::New(env, w), Napi::Number::New(env, h), buf});
  });
}
```

**onEvent (resize/disconnect/error):**

```cpp
void onResize(int w, int h) override {
  resizeCb_.BlockingCall([w, h](Napi::Env env, Napi::Function jsCallback) {
    jsCallback.Call({Napi::String::New(env, "resize"),
                     Napi::Number::New(env, w), Napi::Number::New(env, h)});
  });
}
```

### CreateSession Flow

```cpp
static Napi::Value CreateSession(const Napi::CallbackInfo& info) {
  // 1. Parse 8 arguments: host, port, width, height, username, password, onBitmap, onEvent
  // 2. Create 4 ThreadSafeFunctions (bitmap, resize, disconnect, error)
  // 3. Create JsFrameListener with the TSFns
  // 4. Create RdpSession with host/port/width/height/username/password + listener
  // 5. Call session->connect()
  // 6. If fail: delete session + listener, throw Napi::Error
  // 7. If success: store in sessions_ map with auto-incrementing ID
  // 8. Return session ID
}
```

---

## 16. Windows OpenSSL Legacy Provider (CRITICAL)

### Why This Is Needed

FreeRDP on Windows uses OpenSSL 3.x, which ships RC4 in the **legacy** provider (not the default provider). RC4 is required during the RDP licensing negotiation phase. Without it, the connection fails with "Failed to allocate RC4" and the session never finishes connecting.

### The Stack (All Must Work)

```
Node.js process.env.OPENSSL_MODULES + OPENSSL_CONF   (JS level)
         ↓
C++ EnvVarInitializer (static global at DLL load)     (C++ _putenv_s)
         ↓
ensureLegacyProvider()                                (C++ OSSL_PROVIDER_load)
         ↓
OSSL_PROVIDER_load(NULL, "legacy")                    (Loads legacy.dll)
         ↓
EVP_rc4() != NULL                                     (Verification)
         ↓
WinPR RC4 init sequence OK                            (Full simulation)
```

### Bug 5: The `\\?\` Path Prefix

**Root cause:** `GetModuleFileNameA` on Windows returns paths with a `\\?\` extended-length prefix (e.g., `\\?\C:\Users\...\rdp_addon.node`). OpenSSL's DSO module loader does NOT understand this prefix.

**Fix — `normalizePath()`:**

```cpp
static std::string normalizePath(const std::string& path) {
  if (path.size() >= 4 && path[0] == '\\' && path[1] == '\\'
      && path[2] == '?' && path[3] == '\\') {
    return path.substr(4);  // Strip \\?\ prefix
  }
  return path;
}
```

### EnvVarInitializer — Static Global Constructor

```cpp
struct EnvVarInitializer {
  EnvVarInitializer() {
    // Get path of rdp_addon.node DLL
    HMODULE hMod = GetModuleHandleA("rdp_addon.node");
    char dllPath[MAX_PATH];
    GetModuleFileNameA(hMod, dllPath, MAX_PATH);

    // Normalize path, get directory
    std::string dir = normalizePath(std::string(dllPath));
    dir = dir.substr(0, dir.find_last_of('\\'));

    // Set environment variables (overrides Node.js process.env)
    _putenv_s("OPENSSL_MODULES", dir.c_str());

    // Write openssl.cnf if it doesn't exist
    std::string cnfPath = dir + "\\openssl.cnf";
    // ... write config file ...
    _putenv_s("OPENSSL_CONF", cnfPath.c_str());
  }
};
static EnvVarInitializer s_envInit;  // Runs at DLL load time
```

**Why `_putenv_s` instead of `setenv` or `process.env`:**

- `_putenv_s` updates BOTH the CRT cache AND the OS environment block
- Since the addon uses `/MD` (dynamic CRT), FreeRDP shares this CRT cache
- Node.js `process.env` also reads from the OS block, but `_putenv_s` writes override them
- The C++ initializer runs AFTER JS `process.env` setup (since it fires on `require()`), so C++ wins

### ensureLegacyProvider() — Full Verification

```cpp
static void ensureLegacyProvider() {
  // 1. Get addon directory path (for logging and fallback path loading)
  // 2. Log OPENSSL_MODULES and OPENSSL_CONF env vars
  // 3. OSSL_PROVIDER_load(NULL, "legacy")
  // 4. OSSL_PROVIDER_load(NULL, "default")
  // 5. Try loading legacy again (to verify it's cached)
  // 6. Check EVP_rc4() != NULL
  // 7. Full WinPR RC4 init simulation:
  //    - EVP_CIPHER_CTX_new()
  //    - EVP_EncryptInit_ex(ctx, EVP_rc4(), NULL, NULL, NULL)  // set cipher only
  //    - EVP_CIPHER_CTX_set_flags(ctx, EVP_CIPH_FLAG_NON_FIPS_ALLOW)
  //    - EVP_CIPHER_CTX_set_key_length(ctx, 16)
  //    - EVP_EncryptInit_ex(ctx, NULL, NULL, testKey, NULL)    // set actual key
}
```

### Deployment of legacy.dll

The `build-native.js` script copies `legacy.dll` to TWO locations:

- `<addonDir>/legacy.dll` — flat directory (matches `OPENSSL_MODULES=addonDir`)
- `<addonDir>/ossl-modules/legacy.dll` — OpenSSL default provider path

### openssl.cnf Content

```ini
openssl_conf = openssl_init

[openssl_init]
providers = provider_sect

[provider_sect]
default = default_sect
legacy = legacy_sect

[default_sect]
activate = 1

[legacy_sect]
activate = 1
```

---

## 17. Build Script: build-native.js

**`scripts/build-native.js`:**

### Visual Studio Auto-Detection

On Windows, the script uses `detectVs()` to find the installed Visual Studio instance:

1. **Scans known paths** for `vcvarsall.bat` (VS 2022 BuildTools, VS 2026 Enterprise, etc.)
2. **Maps each path** to its correct CMake generator string (e.g., `2022\BuildTools` → `Visual Studio 17 2022`, `18\Enterprise` → `Visual Studio 18 2026`)
3. **Captures the VS environment** by running `vcvarsall.bat x64 >nul && set`, parses the output, and spawns cmake with the merged environment

This replaced the old `vswhere`-based detection which broke when:
- `ProgramFiles(x86)` env var had a non-standard value (missing space)
- vswhere returned no instances on some CI machines

### Steps

1. **Download Electron headers**: `cmake-js install --runtime=electron --runtime-version=31.7.7 --arch=arm64/x64`
2. **Clear old build dirs**, create fresh `build/` and `native/rdp-addon/build/Release/`
3. **Determine FreeRDP root per platform:**
   - **Windows**: `VCPKG_ROOT/installed/x64-windows` (default `C:\vcpkg`)
   - **macOS**: `brew --prefix freerdp` output
   - **Linux**: `/usr`
4. **cmake configure** with platform-specific flags
5. **cmake build**
6. **Copy `rdp_addon.node`** to output dir
7. **Copy platform libraries:**

### Windows DLL Deployment

```js
// FreeRDP DLLs
['freerdp2.dll', 'freerdp-client2.dll', 'winpr2.dll']
// OpenSSL DLLs
['libcrypto-3-x64.dll', 'libssl-3-x64.dll', 'zlib1.dll']
// Legacy provider (to BOTH locations!)
legacy.dll → <addonOutDir>/legacy.dll
legacy.dll → <addonOutDir>/ossl-modules/legacy.dll
// openssl.cnf
```

### macOS Dylib Management

1. Copy FreeRDP dylibs (`libfreerdp3.3.dylib`, `libfreerdp-client3.3.dylib`, `libwinpr3.3.dylib`)
2. Fix install names: `install_name_tool -id @loader_path/<dylib> <dylib>`
3. Resolve transitive deps via BFS on `otool -L` output
4. Change all `@rpath/...` references → `@loader_path/...`
5. Change all absolute paths → `@loader_path/<basename>`
6. Ad-hoc codesign all dylibs: `codesign --force --sign - <file>`

### CMake Build Flags Per Platform

**Windows (auto-detected via `detectVs()`):**

```
-G "Visual Studio 17 2022" / "Visual Studio 18 2026"  # auto-detected from vcvarsall path
-A x64
-DCMAKE_TOOLCHAIN_FILE=<vcpkg>/scripts/buildsystems/vcpkg.cmake
-DVCPKG_TARGET_TRIPLET=x64-windows
-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDLL         # /MD — Bug 7 fix
-DCMAKE_SHARED_LINKER_FLAGS=/DELAYLOAD:NODE.EXE
```

**macOS:**

```
-DCMAKE_OSX_ARCHITECTURES=arm64
-DCMAKE_SHARED_LINKER_FLAGS="-undefined dynamic_lookup"
```

**Linux:**

```
-DCMAKE_SHARED_LINKER_FLAGS="-Wl,--unresolved-symbols=ignore-all"
```

---

## 18. Electron-Builder Packaging

**`electron-builder.yml`:**

```yaml
appId: com.tunnelgate.app
productName: TunnelGate
directories:
  output: release
  buildResources: resources
files:
  - dist/**/*
  - resources/icons/**/*
  - package.json
extraResources:
  - from: resources/
    to: resources/
    filter: ["cloudflared*"]
  - from: native/
    to: native/
    filter: ["**/*"]
win:
  target: [target: nsis, arch: [x64]]
mac:
  target: [target: dmg, arch: [arm64]]
  hardenedRuntime: false    # CRITICAL: Bug 3 — built-in codesign corrupts on macOS 26
  gatekeeperAssess: false
linux:
  target: [target: AppImage, arch: [x64]], [target: deb, arch: [x64]]
```

### Bug 3 — macOS 26 Codesign Corruption

electron-builder's built-in `codesign` corrupts the Electron Framework binary on macOS 26 (Tahoe), producing a smaller binary that crashes V8 with "Failed to reserve virtual memory for CodeRange".

**Workaround:**

1. Set `hardenedRuntime: false` in electron-builder.yml
2. Build with `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir`
3. Manually replace corrupted Framework from `node_modules`:
   ```bash
   cp node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron\ Framework.framework/\
   Versions/A/Electron\ Framework \
   release/mac-arm64/TunnelGate.app/Contents/Frameworks/Electron\ Framework.framework/\
   Versions/A/Electron\ Framework
   ```
4. Manually codesign:
   ```bash
   codesign --deep --force --sign - --options runtime \
     --entitlements build/entitlements.mac.plist \
     release/mac-arm64/TunnelGate.app
   ```

**macOS entitlements (`build/entitlements.mac.plist`):**

```xml
<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.disable-library-validation</key><true/>
```

---

## 19. Renderer Entry & App Shell

### Main Entry (`src/renderer/main.tsx`)

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);
```

### App Shell (`src/renderer/App.tsx`)

Routes between Tunnels, Logs, and Settings views using a simple `useState<Tab>`. When `viewingTunnel` is set, renders `<RdpView>` fullscreen (replaces the entire App shell).

```tsx
if (viewingTunnel) {
  return (
    <div style={{ height: '100vh', background: '#000' }}>
      <RdpView tunnel={viewingTunnel} onBack={() => setViewingTunnel(null)} />
    </div>
  );
}
```

### CSS (`src/renderer/index.css`)

CSS custom properties for theming:

```css
:root {
  --bg-primary: #1a1b2e;
  --bg-secondary: #232540;
  --bg-tertiary: #2a2d4a;
  --text-primary: #e8e8f0;
  --text-secondary: #a0a0b8;
  --text-muted: #6b6b80;
  --border-color: #2e3150;
  --accent-blue: #4a7dff;
  --accent-green: #34d399;
  --accent-red: #ef4444;
  --accent-orange: #f59e0b;
}
```

---

## 20. Renderer: Hooks

### `useTunnels` (`src/renderer/hooks/useTunnels.ts`)

```ts
export interface TunnelWithState extends TunnelConfig {
  runtime: TunnelRuntimeState;
}

export function useTunnels() {
  const [tunnels, setTunnels] = useState<TunnelWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const stateMap = useRef<Map<string, TunnelRuntimeState>>(new Map());

  // On mount: load tunnels config from main process
  // Then merge with runtime states from status-change events
  // Subscribe to onStatusChange and onTrayConnect

  return { tunnels, loading, add, update, remove, connect, disconnect, reload };
}
```

---

## 21. Renderer: Views

### Tunnels View (`src/renderer/views/Tunnels.tsx`)

Shows list of `TunnelCard` components. Each card shows:

- Status dot (gray/green/yellow/red based on runtime state)
- Tunnel name + hostname
- Live output scroller (captures stderr/stdout from cloudflared)
- Action buttons: Connect/Disconnect, View Screen (opens RDP), View Logs

### RdpView (`src/renderer/views/RdpView.tsx`)

The core RDP viewer. See Section 23 for full detail.

### Logs View (`src/renderer/views/Logs.tsx`)

Displays filtered log entries from the 500-entry ring buffer. Uses `LogViewer` component with tunnel filter chips.

### Settings View (`src/renderer/views/Settings.tsx`)

Settings form: Cloudflared path, launch on startup, start minimized, auto-reconnect attempts, forget password after session.

---

## 22. Renderer: RdpCanvas Component

**`src/renderer/components/RdpCanvas.tsx`:**

### Props

```ts
interface Props {
  tunnelId: string;
  width: number;    // RDP session internal resolution (e.g., 1920)
  height: number;   // RDP session internal resolution (e.g., 1080)
  connected: boolean;
}
```

### Canvas Rendering

CSS: `width: 100%; height: 100%` — canvas element scales to fill container. Internal resolution stays at `width`×`height` attributes for pixel-perfect offscreen buffer.

### Double Buffering

```ts
const canvasRef = useRef<HTMLCanvasElement>(null);     // Visible canvas
const offscreenRef = useRef<HTMLCanvasElement | null>(null); // Offscreen canvas

// Paint: splice all pending frames → draw to offscreen → drawImage to visible
```

### Frame Queue

```ts
const pendingRef = useRef<FrameRect[]>([]);

function paint() {
  const frames = pendingRef.current.splice(0);  // Batch all pending frames
  // For each frame: createImageData → putImageData to offscreen
  // Then drawImage offscreen → visible canvas
}
```

### Width/Height Refs (Bug 4 — Stale Closure)

```ts
const widthRef = useRef(width);
const heightRef = useRef(height);
widthRef.current = width;
heightRef.current = height;

// paint uses widthRef/heightRef, not the prop directly
// This prevents stale closures in rAF callbacks
const paint = useCallback(() => {
  const w = widthRef.current;
  const h = heightRef.current;
  // ...
}, []);  // Empty deps — no stale closure!
```

### Mouse Event Handling

```ts
// RDP Slow-Path Pointer Event flags (MS-RDPBCGR 2.2.8.1.1.3.1.1.3)
const PTR_FLAGS_MOVE       = 0x0800;
const PTR_FLAGS_DOWN       = 0x8000;
const PTR_FLAGS_BUTTON1    = 0x1000;  // left
const PTR_FLAGS_BUTTON2    = 0x2000;  // right
const PTR_FLAGS_BUTTON3    = 0x4000;  // middle
const PTR_FLAGS_WHEEL      = 0x0200;
const PTR_FLAGS_WHEEL_NEGATIVE = 0x0100;

// DO NOT use PTR_XFLAGS_* (Fast-Path flags)! See Bug 1.
```

### Coordinate Scaling

```ts
const scaleX = width / rect.width;    // internal width / CSS width
const scaleY = height / rect.height;
x = Math.round((e.clientX - rect.left) * scaleX);
y = Math.round((e.clientY - rect.top) * scaleY);
```

Keyboard: `flags=0` for key down, `flags=0x8000` for key up (`KBD_FLAGS_DOWN`).

---

## 23. Dynamic RDP Resolution & Fullscreen

### The Bug (Before the Fix)

`canvasWrapperRef` was declared but never assigned to any DOM element. The `ResizeObserver` never fired. `connectSizeRef` stayed at 1280×720. RDP always connected at that resolution regardless of viewport.

### The Fix

**`src/renderer/views/RdpView.tsx`:**

```tsx
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;

const [canvasWidth, setCanvasWidth] = useState(DEFAULT_WIDTH);
const [canvasHeight, setCanvasHeight] = useState(DEFAULT_HEIGHT);
const connectSizeRef = useRef({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
const containerRef = useRef<HTMLDivElement>(null);
const toolbarRef = useRef<HTMLDivElement>(null);

// ResizeObserver on containerRef (renders immediately, not conditional!)
useEffect(() => {
  const container = containerRef.current;
  if (!container) return;
  const toolbarEl = toolbarRef.current;

  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { inlineSize, blockSize } = entry.borderBoxSize?.[0]
        ?? entry.contentBoxSize?.[0]
        ?? { inlineSize: DEFAULT_WIDTH, blockSize: DEFAULT_HEIGHT };

      const w = Math.max(640, Math.min(2560, Math.round(inlineSize)));
      let h = Math.max(480, Math.min(1440, Math.round(blockSize)));

      // In non-fullscreen mode, subtract toolbar height from available space
      if (!fullscreen && toolbarEl) {
        h = Math.max(480, Math.min(1440, h - toolbarEl.offsetHeight));
      }

      connectSizeRef.current = { width: w, height: h };
      setCanvasWidth((prev) => prev === w ? prev : w);
      setCanvasHeight((prev) => prev === h ? prev : h);
    }
  });

  ro.observe(container);
  return () => ro.disconnect();
}, [fullscreen]);  // Re-creates observer when fullscreen toggles
```

### Connect Flow

```tsx
const connectView = async () => {
  const { width, height } = connectSizeRef.current;  // Latest from ResizeObserver
  await window.cloudflareRdp.rdp.connect(tunnel.id, width, height);
};
```

### Fullscreen API (Not CSS)

```tsx
const toggleFullscreen = useCallback(() => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}, []);
```

Native Fullscreen API **hides the OS taskbar and window chrome**. CSS-only (`position: fixed; inset: 0`) does not — the taskbar remained visible, and the toolbar stole 48px, clipping the remote desktop bottom (Bug 8).

### Toolbar Overlay in Fullscreen

```tsx
const toolbarStyle = fullscreen
  ? {
      position: 'absolute',
      top: 0, left: 0, right: 0,
      opacity: toolbarHover ? 1 : 0.15,   // Auto-hide
      transition: 'opacity 0.2s',
      // ...
    }
  : {
      flexShrink: 0,  // In-flow in non-fullscreen
      // ...
    };
```

### Min-Height Fix

```tsx
{status === 'connected' && (
  <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
    {/* Without minHeight: 0, flex: 1 child can't shrink below content height */}
    <RdpCanvas tunnelId={tunnel.id} width={canvasWidth} height={canvasHeight} connected={true} />
  </div>
)}
```

### Resize Event from C++

When the RDP server reports a `DesktopResize`, it flows:

```
C++ desktopResize → onEvent("resize", w, h)
  → rdpViewManager.handleEvent() → stores in lastDimensions
    → webContents.send('rdp:event', tunnelId, "resize", w, h)
      → RdpView onEvent handler:
        setCanvasWidth(args[0]); setCanvasHeight(args[1]);
```

### Error / Password Overlays

Both error and password-updated banners use `position: absolute` (not in flow) so they don't affect canvas sizing:

```tsx
<div style={{ position: 'absolute', top: 48, left: 16, right: 16, ... }}>
```

---

## 24. Canvas Rendering Pipeline

### Frame Flow

```
1. C++ endPaint fires on pump thread
2. Dirty rect: (x, y, w, h) from gdi->primary->hdc->hwnd->invalid
3. BGRX32 → RGBA conversion
4. onBitmapUpdate() via ThreadSafeFunction.BlockingCall()
5. Main process JS: forwardFrame() → IPC 'rdp:frame'
6. Preload: ipcRenderer.on('rdp:frame') → contextBridge callback
7. React RdpCanvas.frameHandler():
   pendingRef.current.push({...rect, data: buf});
   if (!rafRef.current) rafRef.current = requestAnimationFrame(paint);
8. paint(): splice(0) pending frames → offscreen putImageData → visible drawImage
```

### Key Rules

1. **Refs for width/height** in paint to avoid stale closures
2. **Empty deps** on `useCallback(paint, [])`
3. **Single rAF guard** — `!rafRef.current` check before scheduling
4. **Canvas dims set in JSX AND in paint** — JSX for initial, `canvas.width = w; canvas.height = h;` in paint for resize
5. **`willReadFrequently: false`** — GPU-backed offscreen context
6. **Try/catch** around `createImageData` and `putImageData` (can throw on invalid dimensions)

---

## 25. Platform Differences

| Feature                                  | Windows                                    | macOS                                          | Linux                            |
| ---------------------------------------- | ------------------------------------------ | ---------------------------------------------- | -------------------------------- |
| **Native RDP client**              | `mstsc.exe`                              | Microsoft Remote Desktop                       | `xfreerdp` / `remmina`       |
| **Credential injection**           | `cmdkey` (Win Credential Manager)        | Skipped                                        | Skipped                          |
| **NLA setting**                    | `NlaSecurity=TRUE`, `TlsSecurity=TRUE` | `NlaSecurity=TRUE`                           | `NlaSecurity=TRUE`             |
| **FreeRDP source**                 | vcpkg `freerdp:x64-windows`              | Homebrew `freerdp`                           | `apt install freerdp2-dev`     |
| **Build generator**                | VS auto-detected (2022/2026) via vcvarsall  | Unix Makefiles                                 | Unix Makefiles                   |
| **Dylib handling**                 | Copy DLLs + deps from vcpkg                | Copy .dylib,`install_name_tool`, ad-hoc sign | No extra step                    |
| **cloudflared name**               | `cloudflared.exe`                        | `cloudflared`                                | `cloudflared`                  |
| **Binary search**                  | `%LOCALAPPDATA%`, `%PROGRAMFILES%`     | `/usr/local/bin`, `/opt/homebrew/bin`      | `/usr/local/bin`, `/usr/bin` |
| **File dialog**                    | `.exe`, `.cmd`, `.bat`               | `(any)`, `.sh`                             | `(any)`, `.sh`               |
| **Window close**                   | Hide to tray                               | Don't quit (macOS standard)                    | Hide to tray                     |
| **Pump sleep**                     | `Sleep(10)`                              | `usleep(10000)`                              | `usleep(10000)`                |
| **OpenSSL legacy provider**        | Required (legacy.dll)                      | Not needed (built-in)                          | Not needed (built-in)            |
| **Password 131087 false positive** | Yes — intercepted                         | No                                             | No                               |

---

## 26. Build & CI/CD Pipeline

### Local Dev

```bash
# Terminal 1: Start Vite dev server
npm run dev:renderer

# Terminal 2: Compile main TS + launch Electron
npm run dev:main
```

### Full Build

```bash
# Step 1: Build native C++ addon (cmake + dylib deployment)
npm run build:native

# Step 2: Compile TypeScript + Vite bundle
npm run build

# Or in one step:
npm run build:all
```

### Package

```bash
# Windows
npm run pack

# macOS (with manual codesign workaround)
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir
# Then manual codesign (see Bug 3)

# Linux
npm run electron:build:linux
```

### CI/CD (`.github/workflows/build-and-release.yml`)

Trigger: Push to `main`. Matrix:

- `ubuntu-latest` → Linux x64 (AppImage + deb)
- `windows-latest` → Windows x64 (NSIS)
- `macos-latest` → macOS ARM64 (DMG)

Setup:

- **Linux**: `apt-get install freerdp2-dev`
- **macOS**: Builds FreeRDP from source (brew ships 3.x if 2.x is needed), minimal features, installs to `/usr/local/freerdp2`, sets `FREERDP_ROOT`
- **Windows**: `vcpkg install freerdp:x64-windows --no-binarycaching --classic`

Verification: Checks `rdp_addon.node` exists after build. Artifacts: 14-day retention.

Release: GitHub release with tag `v<version>` or `v<version>-build.<run_number>`.

---

## 27. Complete Error Reference

### FreeRDP Error Codes

| Code           | Constant                         | Meaning                                                                | Handling                                                                   |
| -------------- | -------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 131081         | `ERRCONNECT_LOGON_FAILURE`     | Authentication failure (wrong username/password)                       | Show friendly auth error, offer retry                                      |
| 131085         | `ERRCONNECT_TRANSPORT_FAILURE` | Network layer failed (tunnel down, wrong hostname, server unreachable) | Show transport error, suggest checking tunnel                              |
| 131087         | `ERRCONNECT_PASSWORD_EXPIRED`  | Password expired / must change                                         | Show password update dialog;**Windows: intercept as false positive** |
| 131074–131250 | General connect errors           | Various FreeRDP failure codes                                          | Show generic error with retry                                              |

### IPC Error Handling

| Channel              | Error                  | User Sees                                             |
| -------------------- | ---------------------- | ----------------------------------------------------- |
| `tunnels:add`      | Invalid hostname regex | "Invalid hostname format"                             |
| `tunnel:connect`   | Failed to decrypt      | "Failed to decrypt credentials"                       |
| `tunnel:connect`   | Cloudflared not found  | "cloudflared binary not found..."                     |
| `rdp:view-connect` | No local port          | "Tunnel not connected — no local port"               |
| `rdp:view-connect` | Addon not available    | "Native FreeRDP decoder is not available"             |
| `rdp:view-connect` | Windows 131087         | "RDP authentication failed (NLA compatibility issue)" |

### Renderer Error States

| State                        | Component | Behavior                                                                       |
| ---------------------------- | --------- | ------------------------------------------------------------------------------ |
| `addonAvailable === null`  | RdpView   | Checking... wait spinner                                                       |
| `addonAvailable === false` | RdpView   | Error banner + "Open Native Client Instead"                                    |
| `status === 'error'`       | RdpView   | Red error overlay with title, description, Retry / Open Native Client / Cancel |
| `passwordUpdateRequired`   | RdpView   | Amber overlay with password input + "Update & Reconnect"                       |
| `status === 'connecting'`  | RdpView   | Loading text "Connecting to RDP session..."                                    |
| `status === 'connected'`   | RdpView   | Windows hint "Enter your Windows credentials" if Windows                       |

---

## 28. All Known Bugs & Fixes (Detailed)

Each bug includes:

- **Symptom**: What the user sees / what breaks
- **Root Cause**: Why it happened (with file:line references)
- **Debugging Process**: How we found it
- **The Fix**: Exact code changes (before/after, file:line)
- **Related Files**: All files involved

---

### Bug 1: Mouse Pointer Flags — Wrong Constant Set

**Severity:** Critical (connection dies immediately on any mouse click)

**Symptom:**

```
ERRINFO_INVALID_INPUT_PDU_MOUSE
```

The RDP transport layer immediately kills the connection when the user clicks anywhere on the canvas. The pump thread logs this error and spins in a 50-failure loop before force-disconnecting.

**Root Cause:**
`src/renderer/components/RdpCanvas.tsx`:19-23

The code used `PTR_XFLAGS_*` constants (Fast-Path, 0x00xx range) instead of `PTR_FLAGS_*` (Slow-Path, 0x1xxx range):

```ts
// WRONG — Fast-Path flags
const PTR_XFLAGS_BUTTON1 = 0x0001;  // Used initially
```

```ts
// CORRECT — Slow-Path flags
const PTR_FLAGS_BUTTON1 = 0x1000;   // What FreeRDP's freerdp_input_send_mouse_event expects
```

The RDP protocol has two pointer event paths:

- **Slow-Path** (`PTR_FLAGS_*`, 0x1xxx): Used with `freerdp_input_send_mouse_event()`
- **Fast-Path** (`PTR_XFLAGS_*`, 0x00xx): Used with `fastpath_send_input_event()` (not used here)

Using Fast-Path flags with the Slow-Path function sends invalid PDU data, causing the server to respond with `ERRINFO_INVALID_INPUT_PDU_MOUSE` and kill the transport.

**The Fix:**
`src/renderer/components/RdpCanvas.tsx`:19-25

Replace all `PTR_XFLAGS_*` → `PTR_FLAGS_*`:

```ts
// BEFORE (wrong):
const PTR_XFLAGS_DOWN      = 0x0080;
const PTR_XFLAGS_BUTTON1   = 0x0001;
const PTR_XFLAGS_BUTTON2   = 0x0002;
const PTR_XFLAGS_BUTTON3   = 0x0004;
const PTR_XFLAGS_MOVE      = 0x0800;

// AFTER (correct):
const PTR_FLAGS_MOVE       = 0x0800;
const PTR_FLAGS_DOWN       = 0x8000;
const PTR_FLAGS_BUTTON1    = 0x1000;  // left
const PTR_FLAGS_BUTTON2    = 0x2000;  // right
const PTR_FLAGS_BUTTON3    = 0x4000;  // middle
const PTR_FLAGS_WHEEL      = 0x0200;
const PTR_FLAGS_WHEEL_NEGATIVE = 0x0100;
```

Also add helper functions and use them in handlers:

```ts
// RdpCanvas.tsx:27-37
function buttonToDownFlag(button: number): number {
  if (button === 2) return PTR_FLAGS_BUTTON2 | PTR_FLAGS_DOWN;
  if (button === 1) return PTR_FLAGS_BUTTON3 | PTR_FLAGS_DOWN;
  return PTR_FLAGS_BUTTON1 | PTR_FLAGS_DOWN;
}
function buttonToUpFlag(button: number): number {
  if (button === 2) return PTR_FLAGS_BUTTON2;
  if (button === 1) return PTR_FLAGS_BUTTON3;
  return PTR_FLAGS_BUTTON1;
}
```

**Debugging:**

1. Noticed connection works until first mouse click
2. Checked FreeRDP pump loop logs: `check_event_handles failed, last_error=ERRINFO_INVALID_INPUT_PDU_MOUSE`
3. Compared flag values against MS-RDPBCGR spec: Slow-Path Pointer Event flags are 0x1xxx, not 0x00xx
4. The `PTR_XFLAGS_*` constants were mistakenly copy-pasted from FreeRDP's Fast-Path header (`xfreerdp.h`)

**File:** `src/renderer/components/RdpCanvas.tsx`:19-37, 146-173

---

### Bug 2: setWindow() Called Before Window Created → Black Screen

**Severity:** Critical (black screen, no error shown)

**Symptom:**

- The native addon produces frames (confirmed in stderr logs: `endPaint sent frame: (0,0 1280x720)`)
- The main process receives them (confirmed: `forwardFrame` is called)
- The renderer never receives frames (no `rdp:frame` IPC arrives)
- Canvas stays black

**Root Cause:**
`src/main/index.ts` (original order):

```ts
// WRONG ORDER:
rdpViewManager.setWindow(mainWindow);  // mainWindow is null at this point!
createMainWindow();                     // Window created here
```

`mainWindow` was `null` when `setWindow()` was called because the method was invoked **before** `createMainWindow()`. The `RdpViewManager` stored `this.win = null`. When frames arrived, `forwardFrame` checked `if (!this.win || this.win.isDestroyed())` and silently dropped every frame.

**The Fix:**
`src/main/index.ts`:

```ts
// CORRECT ORDER:
createMainWindow();                     // Window created first
rdpViewManager.setWindow(mainWindow);  // Then setWindow with valid reference
```

Specifically, inside `createMainWindow()`, AFTER `new BrowserWindow()`:

```ts
function createMainWindow(): void {
  mainWindow = new BrowserWindow({ ... });
  rdpViewManager?.setWindow(mainWindow);  // Now mainWindow is valid!
  // ... loadURL ...
}
```

**Related Files:**

- `src/main/index.ts`:128-146 — window creation + setWindow order
- `src/main/rdpViewManager.ts`:87-88 — `setWindow()` stores the reference
- `src/main/rdpViewManager.ts`:191-196 — `forwardFrame()` checks `this.win`

**Debugging:**

1. Added `process.stderr.write` in `forwardFrame()` → confirmed it was called with frame data
2. Added `process.stderr.write` in preload's IPC `rdp:frame` listener → never received
3. Checked `this.win` value — it was null
4. Traced back to find `setWindow` called before window creation

---

### Bug 3: macOS 26 — Electron Framework Corrupted by electron-builder Codesign

**Severity:** Critical (app crashes on launch)

**Symptom:**

```
Failed to reserve virtual memory for CodeRange
```

V8 crash on app launch. The app binary opens and immediately crashes with a segmentation fault inside the V8 JavaScript engine. The `.app` bundle is smaller than expected (~140MB instead of ~200MB).

**Root Cause**
`electron-builder` on macOS 26 (Tahoe) runs its built-in `codesign` step which **corrupts** the `Electron Framework` binary. The corrupted Framework binary is approximately 20MB smaller, and V8 cannot initialize its code range memory region.

This is specific to macOS 26's `codesign` behavior — it was NOT an issue on macOS 14 or 15.

**The Fix:**

1. **`electron-builder.yml` — disable hardenedRuntime:**

   ```yaml
   mac:
     hardenedRuntime: false    # Prevents electron-builder from running codesign
     gatekeeperAssess: false
   ```
2. **Build with manual codesign bypass:**

   ```bash
   CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir
   ```
3. **Manually replace the corrupted Framework from node_modules:**

   ```bash
   cp "node_modules/electron/dist/Electron.app/Contents/Frameworks/\
   Electron Framework.framework/Versions/A/Electron Framework" \
   "release/mac-arm64/TunnelGate.app/Contents/Frameworks/\
   Electron Framework.framework/Versions/A/Electron Framework"
   ```
4. **Manually codesign the app:**

   ```bash
   codesign --deep --force --sign - --options runtime \
     --entitlements build/entitlements.mac.plist \
     release/mac-arm64/TunnelGate.app
   ```
5. **Entitlements** (`build/entitlements.mac.plist`):

   ```xml
   <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
   <key>com.apple.security.cs.allow-jit</key><true/>
   <key>com.apple.security.cs.disable-library-validation</key><true/>
   ```

**Related Files:**

- `electron-builder.yml`:25-38 — macOS build config
- `build/entitlements.mac.plist` — codesign entitlements

**Debugging:**

1. Noticed `.app` size was ~140MB vs expected ~200MB
2. Checked Console.app for crash logs — V8 "CodeRange" error
3. Compared `Electron Framework` binary from `node_modules` vs packaged app — file sizes differed
4. Isolated the difference to electron-builder's `codesign` step by building with `CSC_IDENTITY_AUTO_DISCOVERY=false`

---

### Bug 4: Stale Paint Closure — Canvas Uses Old Width/Height After Resize

**Severity:** Medium (wrong rendering after dynamic resize)

**Symptom:**
When the RDP session sends a `DesktopResize` event, the canvas may continue painting at the old resolution, causing visual artifacts or incorrect rendering.

**Root Cause:**
`src/renderer/components/RdpCanvas.tsx`

The `paint` function was created with `useCallback(paint, [width, height])`. But `paint` is called via `requestAnimationFrame` (rAF), which captures the function reference at schedule time. If `width` or `height` change between the rAF schedule and execution, the closure still has the old values:

```ts
// WRONG — creates new paint function every time width/height change
// But rAF still has the old paint function reference
const paint = useCallback(() => {
  // width and height from closure — may be stale!
  const w = width;
  const h = height;
  // ...
}, [width, height]);
```

**The Fix:**
`src/renderer/components/RdpCanvas.tsx`:45-100

Use refs to store current width/height, and keep `useCallback` with empty deps:

```ts
const widthRef = useRef(width);
const heightRef = useRef(height);
widthRef.current = width;   // Updated every render
heightRef.current = height;

// paint reads from refs, never from stale closure:
const paint = useCallback(() => {
  const w = widthRef.current;    // Always current
  const h = heightRef.current;   // Always current
  // ...
}, []);  // Empty deps — never recreated
```

Also apply the same pattern for `getCanvasPos`:

```ts
const getCanvasPos = useCallback((e: React.MouseEvent) => {
  const scaleX = width / rect.width;    // width/height from props directly
  const scaleY = height / rect.height;  // OK because called on event, not via rAF
}, [width, height]);
```

**Related Files:**

- `src/renderer/components/RdpCanvas.tsx`:45-100 — paint function, refs, width/height handling

**Debugging:**
Found during code review. The pattern `useCallback(fn, [deps])` + `requestAnimationFrame(fn)` is a well-known React anti-pattern. When `deps` change, `fn` gets a new reference, but the already-scheduled rAF callback still has the old reference.

---

### Bug 5: Windows OpenSSL DSO — `\\?\` Extended-Length Path Prefix

**Severity:** Critical (RC4 unavailable → RDP licensing fails → connection hangs)

**Symptom:**

```
ensureLegacyProvider: LEGACY FAILED
OpenSSL error: error:12800073:DSO support routines::incorrect file syntax
ensureLegacyProvider: EVP_rc4()=NULL
```

RDP connection hangs during the licensing phase because RC4 cipher is not available. `EVP_rc4()` returns NULL because the OpenSSL legacy provider failed to load.

**Root Cause:**
`src/native/rdp-addon/rdp_session.cpp`:43-73

`GetModuleFileNameA()` on Windows returns paths with a `\\?\` extended-length prefix:

```
\\?\C:\Users\Ady\Desktop\cloudflareRDB-gui\node_modules\electron\dist\resources\native\rdp-addon\build\Release\rdp_addon.node
```

When this path is set as `OPENSSL_MODULES`, OpenSSL's DSO (Dynamic Shared Object) module loader does NOT understand the `\\?\` prefix and fails to parse the path. The legacy provider DLL (`legacy.dll`) cannot be found.

**Key insight:** The `\\?\` prefix is valid for Win32 API calls but NOT for C runtime file operations or OpenSSL's internal path handling.

**The Fix:**

1. **Add `normalizePath()` function** — `src/native/rdp-addon/rdp_session.cpp`:15-20:

   ```cpp
   static std::string normalizePath(const std::string& path) {
     if (path.size() >= 4 && path[0] == '\\' && path[1] == '\\'
         && path[2] == '?' && path[3] == '\\') {
       return path.substr(4);  // Strip \\?\ prefix
     }
     return path;
   }
   ```
2. **Use in `EnvVarInitializer`** — `src/native/rdp-addon/rdp_session.cpp`:42-73:

   ```cpp
   // BEFORE:
   std::string dir(dllPath);
   auto pos = dir.find_last_of('\\');
   dir = dir.substr(0, pos);
   _putenv_s("OPENSSL_MODULES", dir.c_str());

   // AFTER:
   std::string dir(dllPath);
   auto pos = dir.find_last_of('\\');
   dir = normalizePath(dir.substr(0, pos));  // Strip \\?\ prefix
   _putenv_s("OPENSSL_MODULES", dir.c_str());
   ```
3. **Also use in `ensureLegacyProvider()`** — `src/native/rdp-addon/rdp_session.cpp`:76-178:

   ```cpp
   std::string dir(dllPath);
   auto pos = dir.find_last_of('\\');
   dir = normalizePath(dir.substr(0, pos));  // Same fix
   ```

**Related Files:**

- `src/native/rdp-addon/rdp_session.cpp`:15-20 — normalizePath function
- `src/native/rdp-addon/rdp_session.cpp`:41-73 — EnvVarInitializer (global constructor at DLL load)
- `src/native/rdp-addon/rdp_session.cpp`:76-178 — ensureLegacyProvider
- `scripts/build-native.js`:207-251 — legacy.dll deployment + openssl.cnf writing

**Debugging:**

1. Added file logging to C++ code (fprintf to `addon-debug.log`)
2. Logged `GetModuleFileNameA` output → saw `\\?\C:\Users\...\rdp_addon.node`
3. Logged `OPENSSL_MODULES` env var → had the `\\?\` prefix
4. Tested `OSSL_PROVIDER_load` with manually constructed path without prefix → worked
5. Added `normalizePath()` → problem solved

**Full debugging log output (before fix):**

```
ensureLegacyProvider: OPENSSL_MODULES=\\?\C:\Users\Ady\...\Release
ensureLegacyProvider: OPENSSL_CONF=\\?\C:\Users\Ady\...\Release\openssl.cnf
ensureLegacyProvider: LEGACY FAILED
OpenSSL error: error:12800073:DSO support routines::incorrect file syntax
ensureLegacyProvider: EVP_rc4()=NULL
```

**After fix:**

```
ensureLegacyProvider: OPENSSL_MODULES=C:\Users\Ady\...\Release
ensureLegacyProvider: OPENSSL_CONF=C:\Users\Ady\...\Release\openssl.cnf
ensureLegacyProvider: LEGACY loaded OK
ensureLegacyProvider: EVP_rc4()=AVAILABLE
ensureLegacyProvider: FULL WinPR RC4 INIT SEQUENCE OK
```

---

### Bug 6: FreeRDP 3 API — `settings` Moved to `context->settings`

**Severity:** Critical (compile error)

**Symptom:**

```
error: 'struct rdp_context' has no member named 'settings'
```

**Root Cause:**
`src/native/rdp-addon/rdp_session.cpp`:277

FreeRDP 3 restructured the `rdpContext` struct. In FreeRDP 2, static callbacks accessed settings directly via `instance->settings`. In FreeRDP 3, settings are accessed via `instance->context->settings`.

This affects all static callback functions (marked `static` in `rdp_session.h`):

- `postConnectCallback`
- `beginPaint`
- `endPaint`
- `desktopResize`

These callbacks receive `freerdp* instance` or `rdpContext* ctx`, and they need to access `rdpSettings`.

**The Fix:**
`src/native/rdp-addon/rdp_session.cpp` — all settings access:

```cpp
// BEFORE (FreeRDP 2 API):
instance->settings
// or
ctx->settings
// (neither works in FreeRDP 3 for static callbacks)

// AFTER (FreeRDP 3 API):
instance->context->settings
// or
ctx->settings   // This still works if ctx is the correct pointer
```

In `connect()`:

```cpp
rdpSettings* settings = context_->settings;  // context_ is instance->context
freerdp_settings_set_string(settings, FreeRDP_ServerHostname, host_.c_str());
```

In `desktopResize()`:

```cpp
rdpSettings* settings = ctx->settings;  // ctx is already rdpContext*, so this works
```

In `postConnectCallback()`:

```cpp
// instance->context->settings — NOT instance->settings
rdpSettings* settings = instance->context->settings;
```

**Related Files:**

- `src/native/rdp-addon/rdp_session.cpp`:277 — settings access in connect()
- `src/native/rdp-addon/rdp_session.cpp`:564-574 — desktopResize callback
- `src/native/rdp-addon/rdp_session.cpp`:227-250 — postConnectCallback

**Key Rule:** In FreeRDP 3, `instance->settings` was REMOVED. Always use `instance->context->settings` for `freerdp*` pointers, or `ctx->settings` directly in `rdpContext*` callbacks.

**Additional Note (vcpkg FreeRDP 3.26.0+):** Beyond the API access pattern change, newer FreeRDP 3.x from vcpkg requires an **explicit include** of `<freerdp/settings.h>` — it is no longer transitively included by `<freerdp/freerdp.h>`. Without it, you get `error C2079: 'freerdp' uses undefined struct 'rdp_settings'`. See **Bug 16** for the full compilation fix.

---

### Bug 7: CRT Runtime Mismatch (`/MT` vs `/MD`) — Heap Corruption

**Severity:** Critical (random crashes, heap corruption)

**Symptom:**

- Intermittent crashes when FreeRDP allocates memory (e.g. during `gdi_init`, pixel buffer allocation, or string operations)
- Heap corruption errors: "HEAP: Free Heap block X modified at Y after it was freed"
- Crashes occur non-deterministically, often on the second or third connection attempt

**Root Cause:**
`src/native/rdp-addon/CMakeLists.txt` (implicit) vs FreeRDP DLLs

FreeRDP 3 DLLs are built with **`/MD`** (dynamic MSVC CRT, `MultiThreadedDLL`). The native addon was originally built with **`/MT`** (static CRT, `MultiThreaded`).

Since each CRT has its own heap manager (`_crtheap`), any FreeRDP allocation (e.g. `gdi_init` allocating the framebuffer) that is later freed by the addon (or vice versa) causes heap corruption because the free operation uses a different heap.

**The Fix:**
`scripts/build-native.js`:94

Add the CMake flag to force `/MD` dynamic CRT:

```js
'-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDLL',
```

Without this flag, cmake-js defaults to static CRT on Windows, creating the mismatch.

**Related Files:**

- `scripts/build-native.js`:94 — the MSVC runtime library flag
- `src/native/rdp-addon/CMakeLists.txt` — addon build (no explicit CRT setting, inherited from cmake-js default)

**Debugging:**
Crashes appeared only on Windows, only after establishing a few connections. Application Verifier (appverif.exe) confirmed heap corruption at the module boundary. Comparing CRTs: `dumpbin /directives rdp_addon.node` showed `MSVCRT` (static) while `dumpbin /directives freerdp2.dll` showed `MSVCRTD` (dynamic).

---

### Bug 8: CSS-Only Fullscreen — Taskbar Still Visible + Bottom Clipping

**Severity:** Medium (visible OS taskbar, clipped remote desktop)

**Symptom:**

- In fullscreen mode, the OS taskbar (Windows) still overlaps the RDP canvas at the bottom
- The toolbar div consumes ~48px at the top, pushing the remote desktop down
- The remote desktop's bottom portion (including the server taskbar) is clipped/hidden
- On Windows: taskbar visible ; on macOS: menu bar visible ; on Linux: panel visible

**Root Cause:**
`src/renderer/views/RdpView.tsx` (original)

Fullscreen was implemented with CSS only:

```tsx
// ORIGINAL — CSS-only fullscreen
const containerStyle = {
  position: 'fixed' as const,
  top: 0, left: 0, right: 0, bottom: 0,
  zIndex: 9999,
  background: '#000',
};
```

CSS `position: fixed; inset: 0` does NOT trigger OS-level fullscreen. The window chrome and taskbar remain visible. The fixed positioning only covers the **window content area**, not the entire monitor. The toolbar was also in-flow (`flex-shrink: 0`), consuming vertical space.

**The Fix:**

1. **Use native Fullscreen API** — `src/renderer/views/RdpView.tsx`:182-188:

   ```tsx
   const toggleFullscreen = useCallback(() => {
     if (document.fullscreenElement) {
       document.exitFullscreen().catch(() => {});
     } else {
       document.documentElement.requestFullscreen().catch(() => {});
     }
   }, []);
   ```
2. **Track fullscreen state** — `src/renderer/views/RdpView.tsx`:190-196:

   ```tsx
   useEffect(() => {
     const onFSChange = () => setFullscreen(!!document.fullscreenElement);
     document.addEventListener('fullscreenchange', onFSChange);
     return () => document.removeEventListener('fullscreenchange', onFSChange);
   }, []);
   ```
3. **Toolbar overlays canvas in fullscreen** — `src/renderer/views/RdpView.tsx`:265-289:

   ```tsx
   const toolbarStyle = fullscreen
     ? {
         position: 'absolute',
         top: 0, left: 0, right: 0,
         opacity: toolbarHover ? 1 : 0.15,   // Auto-hide with hover reveal
         transition: 'opacity 0.2s',
         zIndex: 10,
       }
     : {
         flexShrink: 0,   // In-flow in non-fullscreen
       };
   ```
4. **Container style** — `src/renderer/views/RdpView.tsx`:261-263:

   ```tsx
   const containerStyle = fullscreen
     ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
         zIndex: 9999, background: '#000', display: 'flex', flexDirection: 'column' }
     : { height: '100%', display: 'flex', flexDirection: 'column', background: '#000' };
   ```

**Escape key integration** — Added keyboard handler for Escape to auto-disconnect:

```tsx
useEffect(() => {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !passwordUpdateRequired) {
      e.stopPropagation();
      handleBack();  // Disconnects + navigates back
    }
  };
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}, [handleBack, passwordUpdateRequired]);
```

**Related Files:**

- `src/renderer/views/RdpView.tsx`:178-196 — Fullscreen API toggle + state tracking
- `src/renderer/views/RdpView.tsx`:257-289 — Container + toolbar styles conditional on fullscreen
- `src/renderer/views/RdpView.tsx`:197-207 — Escape key auto-disconnect

**Debugging:**
Visual observation: in fullscreen, the Windows taskbar was still visible at the bottom. `document.fullscreenElement` was `null` (confirming we were NOT in native fullscreen). Switched from CSS hack to native Fullscreen API per MDN recommendation.

---

### Bug 9: ResizeObserver Never Fired — Resolution Stuck at 1280×720

**Severity:** High (remote desktop taskbar clipped on wider monitors)

**Symptom:**

- On a 1920×1080 monitor, the remote desktop's taskbar is "cut in half" (bottom portion clipped)
- The RDP session always connects at 1280×720 regardless of viewport size
- The canvas is CSS-stretched to fill the container, but there are only 720 rows of actual pixel data
- The bottom portion of the stretched canvas shows either black or interpolated garbage

**Root Cause:**
`src/renderer/views/RdpView.tsx` (original, line 63)

A `canvasWrapperRef` was declared but **never attached to any JSX element**:

```tsx
// DECLARED (line 63):
const canvasWrapperRef = useRef<HTMLDivElement>(null);

// USED IN ResizeObserver (lines 69-84):
useEffect(() => {
  const wrapper = canvasWrapperRef.current;
  if (!wrapper) return;    // ← Always returns early! wrapper is NEVER set
  // ...
}, []);

// BUT NEVER ASSIGNED IN JSX! There is no: ref={canvasWrapperRef}
```

The `ResizeObserver` effect (`[]` deps) ran once on mount. `canvasWrapperRef.current` was always `null` because no element used `ref={canvasWrapperRef}`. The effect returned early every time. `connectSizeRef` stayed at `{ width: 1280, height: 720 }`. The RDP session connected at this resolution.

Meanwhile, the canvas CSS was `width: 100%; height: 100%`, so the `<canvas>` element stretched to fill the container, but the backing buffer was only 1280×720 pixels. The bottom ~360px of the stretched canvas had no pixel data.

**The Fix:**

1. **Remove `canvasWrapperRef`** — `src/renderer/views/RdpView.tsx` (was line 63)
2. **Use `containerRef` for ResizeObserver** — `src/renderer/views/RdpView.tsx`:68-87:

   ```tsx
   const containerRef = useRef<HTMLDivElement>(null);

   useEffect(() => {
     const container = containerRef.current;
     if (!container) return;       // containerRef IS assigned → this works!
     const toolbarEl = toolbarRef.current;

     const ro = new ResizeObserver((entries) => {
       for (const entry of entries) {
         const { inlineSize, blockSize } = entry.borderBoxSize?.[0]
           ?? entry.contentBoxSize?.[0]
           ?? { inlineSize: DEFAULT_WIDTH, blockSize: DEFAULT_HEIGHT };

         const w = Math.max(640, Math.min(2560, Math.round(inlineSize)));
         let h = Math.max(480, Math.min(1440, Math.round(blockSize)));

         // In non-fullscreen mode, subtract toolbar height
         if (!fullscreen && toolbarEl) {
           h = Math.max(480, Math.min(1440, h - toolbarEl.offsetHeight));
         }

         connectSizeRef.current = { width: w, height: h };
         setCanvasWidth((prev) => prev === w ? prev : w);
         setCanvasHeight((prev) => prev === h ? prev : h);
       }
     });

     ro.observe(container);
     return () => ro.disconnect();
   }, [fullscreen]);  // Re-creates observer when fullscreen toggles
   ```
3. **Add `toolbarRef`** — `src/renderer/views/RdpView.tsx`:180:

   ```tsx
   const toolbarRef = useRef<HTMLDivElement>(null);
   ```

   And assign it: `<div ref={toolbarRef} style={toolbarStyle}>`
4. **Add `minHeight: 0` to canvas wrapper** — `src/renderer/views/RdpView.tsx`:480:

   ```tsx
   <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
   ```

   Without this, the flex child with `flex: 1` has a default `min-height: auto` equal to its content height (canvas's intrinsic `height` attribute), which prevents the flex item from shrinking below the canvas dimensions.

**Related Files:**

- `src/renderer/views/RdpView.tsx`:59-87 — ResizeObserver on containerRef, toolbar height subtraction
- `src/renderer/views/RdpView.tsx`:176-180 — containerRef + toolbarRef declarations
- `src/renderer/views/RdpView.tsx`:293 — toolbarRef assigned to toolbar div
- `src/renderer/views/RdpView.tsx`:480 — minHeight: 0 on canvas wrapper
- `src/main/rdpViewManager.ts`:136-140 — connectView uses stored dimensions

**Debugging:**

1. Noticed connectSizeRef was always 1280×720 despite ResizeObserver code being present
2. Added `console.log('ResizeObserver: wrapper=', wrapper)` inside the effect → logged `null`
3. Searched JSX for `ref={canvasWrapperRef}` — not found anywhere
4. Realized `canvasWrapperRef` was declared but never used in the JSX
5. The fix was to observe `containerRef` (which IS assigned to the outer div) instead

---

### Bug 10: `npm run dev` Script Syntax Error

**Severity:** Low (development inconvenience)

**Symptom:**

```
node -e setTimeout(()=>process.exit(0),2000) && npm run dev:main exited with code 1
SyntaxError: Unexpected token ')'
```

**Root Cause:**
`package.json` — the `dev` script has a PowerShell escape issue:

```json
"dev": "concurrently \"npm run dev:renderer\" \"node -e setTimeout(()=>process.exit(0),2000) && npm run dev:main\""
```

The `&&` and `=>` characters are interpreted by PowerShell before being passed to `node -e`. The parentheses in the arrow function are also mangled by cmd escaping.

**Workaround:**
Run the two commands manually in separate terminals:

```bash
# Terminal 1:
npm run dev:renderer

# Terminal 2:
npm run dev:main
```

**The Fix:**

```json
"dev": "concurrently -k \"npm run dev:renderer\" \"npm run dev:main\""
```

Remove the `node -e` delay entirely — it was an unnecessary workaround. Vite only takes ~200ms to start.

**Related Files:**

- `package.json`:11 — the dev script

---

### Bug 11: NLA Password-Expired False Positive on Windows (Code 131087)

**Severity:** Medium (Windows users see confusing "password expired" error)

**Symptom:**

- Windows users with valid credentials see `ERRCONNECT_PASSWORD_EXPIRED (code=131087)`
- The app shows the "Password Expired" amber dialog asking for a new password
- But the password is actually NOT expired — it's a false positive
- This only happens on Windows, never on macOS or Linux

**Root Cause:**
`src/native/rdp-addon/rdp_session.cpp`:332-334 + `src/main/rdpViewManager.ts`:162-165

Windows uses native SSPI (Security Support Provider Interface) for NLA authentication. FreeRDP calls into Windows' built-in Kerberos/NTLM stack via SSPI. When SSPI encounters a stale Kerberos ticket or cached domain credentials, it returns `SEC_E_NO_CREDENTIALS` or similar, which FreeRDP maps to `ERRCONNECT_PASSWORD_EXPIRED (131087)`.

The actual issue is NOT the password expiring — it's a Kerberos ticket cache issue or a domain controller communication problem. The same credentials work fine via `mstsc.exe`.

**The Fix:**
`src/main/rdpViewManager.ts`:162-165

Intercept the error in the `connectView()` catch block and replace it with a generic NLA message:

```ts
// In the catch block after addon.createSession() throws:
if (isWin && rawMsg.includes('code=131087')) {
  writeLog(tunnelId, 'RDP View', 'warn',
    'FreeRDP on Windows reported password-expired (131087) — likely false positive due to NLA/SSPI.');
  throw new Error('Failed to create RDP session: RDP authentication failed (NLA compatibility issue). Try reconnecting or use the native client.');
}
```

**NLA settings** — `src/native/rdp-addon/rdp_session.cpp`:332-334:

```cpp
// Enable both TLS and NLA — server will choose HYBRID (which works)
freerdp_settings_set_bool(settings, FreeRDP_NlaSecurity, TRUE);
freerdp_settings_set_bool(settings, FreeRDP_TlsSecurity, TRUE);
```

Combining `NlaSecurity=TRUE` + `TlsSecurity=TRUE` gives the server the option to negotiate HYBRID (NLA + TLS), which is more compatible than NLA alone.

**Related Files:**

- `src/main/rdpViewManager.ts`:162-165 — 131087 interception
- `src/native/rdp-addon/rdp_session.cpp`:332-334 — NLA + TLS security settings
- `src/renderer/views/RdpView.tsx`:13-15 — `isPasswordExpired()` detection function

**Debugging:**

1. Windows users reported "Password Expired" for valid credentials
2. Checked FreeRDP logs: `code=131087 (ERRCONNECT_PASSWORD_EXPIRED)`
3. Same credentials worked in `mstsc.exe`
4. Googling revealed this is a known FreeRDP-on-Windows issue related to SSPI/Kerberos
5. The fix has two parts: (a) enable TlsSecurity too, (b) intercept 131087 as false positive

---

### Bug 12: N-API 8 Arguments — createSession Parameter Count

**Severity:** Critical (type error at runtime)

**Symptom:**

```
Error: Expected 8 arguments
```

**Root Cause:**
`src/native/rdp-addon/rdp_module.cpp`:82-84

The `CreateSession` N-API function expects exactly 8 arguments:

```cpp
if (info.Length() < 8) {
  Napi::TypeError::New(env, "Expected 8 arguments").ThrowAsJavaScriptException();
  return env.Null();
}
```

The 8 arguments are: `host, port, width, height, username, password, onBitmap, onEvent`

If the JS caller passes fewer arguments (e.g., 7), this error fires. This was a version mismatch between the addon's expected API and the renderer's calling code.

**The Fix:**
Ensure the JS side always passes all 8 arguments:

`src/main/rdpViewManager.ts`:142-150:

```ts
const sessionId = this.addon.createSession(
  '127.0.0.1', port, width, height, username, password,  // 6 args
  (x, y, w, h, buf) => { ... },   // 7th arg: onBitmap
  (type, ...args) => { ... },      // 8th arg: onEvent
);
```

**Related Files:**

- `src/native/rdp-addon/rdp_module.cpp`:79-130 — CreateSession N-API function
- `src/main/rdpViewManager.ts`:142-150 — JS call with all 8 arguments

---

### Bug 13: Connection Stored Dimensions — Reconnect at Wrong Resolution

**Severity:** Medium (password update reconnect uses wrong size)

**Symptom:**
When the user updates an expired password, the RDP session reconnects at the default 1280×720 instead of the previously-used viewport size.

**Root Cause:**
`src/main/rdpViewManager.ts`:210-211

The `handleEvent` for `resize` stores the new dimensions in `lastDimensions`, but when `connectView` is called on password-update reconnect, the renderer might not pass width/height (since it's a reconnect, not a fresh open).

```ts
// In connectView():
if (width === undefined || height === undefined) {
  const stored = this.lastDimensions.get(tunnelId);
  width = stored?.width ?? DEFAULT_WIDTH;   // Falls back to stored or default
  height = stored?.height ?? DEFAULT_HEIGHT;
}
```

This works correctly IF `lastDimensions` has been populated. But if the initial connect used `connectSizeRef.current` (which now has the correct viewport size from the ResizeObserver), and then a reconnect doesn't pass dimensions, it falls back to the stored `lastDimensions` from the original connection.

**The Fix:**
`src/main/rdpViewManager.ts`:152

After a successful connect, always store the dimensions used:

```ts
this.lastDimensions.set(tunnelId, { width, height });
```

And ensure the renderer's `updatePassword` flow passes width/height:

```ts
// ipcHandlers.ts:209-211
rdpViewManager.disconnectView(tunnelId);
await rdpViewManager.connectView(tunnelId, port, config.username, newPassword);
// width/height not passed here → uses lastDimensions (correct because stored above)
```

**Related Files:**

- `src/main/rdpViewManager.ts`:135-140 — stored dimension fallback
- `src/main/rdpViewManager.ts`:152 — store dimensions on connect
- `src/main/rdpViewManager.ts`:207-211 — store dimensions on resize event
- `src/main/ipcHandlers.ts`:209-211 — password-update reconnect (no explicit dimensions)

---

### Bug 14: Debug File Logging — Hardcoded Path in Production

**Severity:** Low (only affects development debugging)

**Symptom:**
The C++ addon writes debug logs to `C:\Users\Ady\Desktop\cloudflareRDB-gui\addon-debug.log`. This path only exists on the developer's machine.

**Root Cause:**
`src/native/rdp-addon/rdp_session.cpp`:22-28

```cpp
static void fileLog(const char* msg) {
  FILE* f = fopen("C:\\Users\\Ady\\Desktop\\cloudflareRDB-gui\\addon-debug.log", "a");
  if (f) {
    fprintf(f, "%s\n", msg);
    fclose(f);
  }
}
```

**Status:** Left as-is for development. Replace with `WLog` or remove `#ifdef DEBUG` before production release.

**Related Files:**

- `src/native/rdp-addon/rdp_session.cpp`:22-28 — fileLog function with hardcoded path

---

### Bug 15: VS Generator Auto-Detection — `vswhere` Broken, Hardcoded Generator Failed for VS 2026

**Severity:** Build-blocker on CI with VS 2026

**Symptom:**
```
CMake Error at CMakeLists.txt:2 (project):
  Generator Visual Studio 17 2022 could not find any instance of Visual Studio.
```

**Root Cause:**
The original `detectVsGenerator()` built the vswhere path using `process.env['ProgramFiles(x86)']` which resolved to `C:\Program Files(x86)` (missing space before the parenthesis), so `vswhere.exe` was never found. The function fell back to a hardcoded `Visual Studio 17 2022`, but the CI runner had VS 2026 (version 18), not VS 2022. Additionally, `vswhere` returned no instances even when pointed at the correct path.

**Fix in `scripts/build-native.js`:**
- Replaced `detectVsGenerator()` with `detectVs()` — scans a list of known VS installation paths for `vcvarsall.bat`, each paired with the correct CMake generator string (e.g., `18\Enterprise\...` → `Visual Studio 18 2026`, `2022\BuildTools\...` → `Visual Studio 17 2022`)
- `vsSpawn()` captures the VS developer environment by running `vcvarsall.bat x64 >nul && set`, parses the output, and spawns cmake with the merged environment
- Both `-G` generator and environment are now determined dynamically from whichever VS installation is found

**Related Files:**
- `scripts/build-native.js`:62-113 — `detectVs()`, `vsSpawn()`, and `vsDetected` usage

---

### Bug 16: NLA Security Error (SEC_E_SECPKG_NOT_FOUND) and Missing `<freerdp/settings.h>` Include

**Severity:** Connection-blocker

**Symptom:**
```
[ERROR] freerdp_set_last_error_ex: ERRCONNECT_LOGON_FAILURE [0x00020014]
[ERROR] Failed to connect to xxx
NLA code did not complete within 10 seconds. HRESULT: SEC_E_SECPKG_NOT_FOUND(0x80090311)
```

**Root Cause (NLA):**
`rdp_session.cpp` set `FreeRDP_NlaSecurity = TRUE` (default). The NLA (Network Level Authentication) handshake uses Kerberos/NTLM to verify the server's identity via SPN. When connecting through a Cloudflare TCP tunnel, the client connects to `localhost:<tunnel-port>`, not the actual server hostname. The SPN check fails because the SPN is bound to the tunnel endpoint, not the RDP server — `SEC_E_SECPKG_NOT_FOUND` means no security package can validate the SPN for the tunnel address.

**Root Cause (Compilation):**
vcpkg's FreeRDP 3.x (3.26.0+) restructured headers. `<freerdp/settings.h>` is no longer transitively included by `<freerdp/freerdp.h>`. This caused:
```
error C2079: 'freerdp' uses undefined struct 'rdp_settings'
```
Additionally, `CMakeLists.txt` referenced `napi.h` via an absolute path that assumed the addon lived directly under `node_modules/` — but `cmake-js` provides the correct include paths via `CMAKE_JS_INC`, so the hardcoded path was removed.

**The Fix:**

1. **Disable NLA security** — `src/native/rdp-addon/rdp_session.cpp`:
   ```cpp
   freerdp_settings_set_bool(settings, FreeRDP_NlaSecurity, FALSE);
   ```
   This allows RDP connection without Kerberos SPN validation, which is safe over the encrypted Cloudflare TCP tunnel.

2. **Add explicit include** — `src/native/rdp-addon/rdp_session.cpp`:
   ```cpp
   #include <freerdp/settings.h>
   ```

3. **Remove hardcoded napi.h include path** — `src/native/rdp-addon/CMakeLists.txt`: removed `include_directories(...)`, cmake-js provides it via `CMAKE_JS_INC`.

**Related Files:**
- `src/native/rdp-addon/rdp_session.cpp`:1 — added `<freerdp/settings.h>` include
- `src/native/rdp-addon/rdp_session.cpp` — set `FreeRDP_NlaSecurity` to `FALSE`
- `src/native/rdp-addon/CMakeLists.txt` — removed hardcoded `include_directories` for napi.h

---

## 29. File Reference Summary

### Root

| File                                        | Purpose                               |
| ------------------------------------------- | ------------------------------------- |
| `package.json`                            | Dependencies and scripts              |
| `index.html`                              | Vite entry HTML                       |
| `vite.config.ts`                          | Vite bundler config                   |
| `tsconfig.json`                           | TypeScript config (renderer + shared) |
| `tsconfig.main.json`                      | TypeScript config (main process)      |
| `tsconfig.preload.json`                   | TypeScript config (preload)           |
| `electron-builder.yml`                    | Packaging config                      |
| `.gitignore`                              | Git ignore rules                      |
| `.github/workflows/build-and-release.yml` | CI/CD pipeline                        |

### Build

| File                             | Purpose                                        |
| -------------------------------- | ---------------------------------------------- |
| `scripts/build-native.js`      | cmake-js build + platform dylib/DLL deployment |
| `build/entitlements.mac.plist` | macOS codesign entitlements                    |

### Shared

| File                    | Purpose                                           |
| ----------------------- | ------------------------------------------------- |
| `src/shared/types.ts` | All TypeScript interfaces + IPC channel constants |

### Main Process

| File                            | Purpose                                                                  |
| ------------------------------- | ------------------------------------------------------------------------ |
| `src/main/index.ts`           | App entry: tray creation, window creation, initialization                |
| `src/main/ipcHandlers.ts`     | All IPC handler registrations                                            |
| `src/main/tunnelManager.ts`   | cloudflared process lifecycle (spawn, ready detection, reconnect, kill)  |
| `src/main/rdpViewManager.ts`  | Native addon bridge: load addon, create/destroy sessions, forward frames |
| `src/main/credentialStore.ts` | Password encrypt/decrypt (safeStorage) + Windows cmdkey injection        |
| `src/main/store.ts`           | electron-store persistence with JSON schema                              |
| `src/main/logger.ts`          | electron-log file output + 500-entry ring buffer                         |

### Preload

| File                     | Purpose                                |
| ------------------------ | -------------------------------------- |
| `src/preload/index.ts` | contextBridge API exposure (typed IPC) |

### Renderer

| File                                       | Purpose                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `src/renderer/main.tsx`                  | React mount point                                                                            |
| `src/renderer/App.tsx`                   | Shell with tab navigation + RdpView fullscreen routing                                       |
| `src/renderer/index.css`                 | CSS custom properties for dark theme                                                         |
| `src/renderer/types.d.ts`                | `window.cloudflareRdp` type declaration                                                    |
| `src/renderer/views/Tunnels.tsx`         | Tunnel list + CRUD UI                                                                        |
| `src/renderer/views/RdpView.tsx`         | Full-screen RDP viewer with ResizeObserver, fullscreen API, toolbar, error/password overlays |
| `src/renderer/views/Logs.tsx`            | Log viewer with tunnel filter                                                                |
| `src/renderer/views/Settings.tsx`        | Settings form                                                                                |
| `src/renderer/components/TunnelCard.tsx` | Single tunnel card with status dot, output scroller, actions                                 |
| `src/renderer/components/TunnelForm.tsx` | Add/edit tunnel form                                                                         |
| `src/renderer/components/RdpCanvas.tsx`  | Canvas rendering: double-buffered, rAF batched, mouse/keyboard input                         |
| `src/renderer/components/LogViewer.tsx`  | Scrollable log with auto-scroll detection                                                    |
| `src/renderer/hooks/useTunnels.ts`       | Tunnel state management hook                                                                 |

### Native C++ Addon

| File                                     | Purpose                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/native/rdp-addon/CMakeLists.txt`  | CMake build: finds FreeRDP 3/WinPR, outputs `.node`                                                     |
| `src/native/rdp-addon/rdp_session.h`   | `RdpSession` class + `RdpFrameListener` interface                                                     |
| `src/native/rdp-addon/rdp_session.cpp` | FreeRDP 3 session: connect, pump loop, endPaint pixel conversion, mouse/keyboard, OpenSSL legacy provider |
| `src/native/rdp-addon/rdp_module.cpp`  | N-API exports: createSession, destroySession, sendPointerEvent, sendKeyboardEvent                         |

### Output Directories

| Directory                           | Content                                                               |
| ----------------------------------- | --------------------------------------------------------------------- |
| `dist/main/`                      | Compiled main process JS                                              |
| `dist/preload/`                   | Compiled preload JS                                                   |
| `dist/renderer/`                  | Vite-bundled renderer                                                 |
| `native/rdp-addon/build/Release/` | `rdp_addon.node` + FreeRDP DLLs/dylibs + legacy.dll + ossl-modules/ |
| `release/`                        | electron-builder packaged apps                                        |

---

> **End of Replication Guide.**
>
> This document is designed to be fed to an AI or followed by a developer to replicate TunnelGate from scratch. Every file, setting, bug fix, and platform quirk is documented in implementation order. Build with confidence.
