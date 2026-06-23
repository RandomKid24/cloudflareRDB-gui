# TunnelGate — Complete Project Reference

> **Version:** 1.0.0  
> **Description:** One-Click RDP via Cloudflare Tunnel  
> **Stack:** Electron + React + TypeScript + C++ (FreeRDP 3)  
> **Platforms:** Windows (x64), macOS (arm64), Linux (x64)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Directory Layout](#3-directory-layout)
4. [IPC Channels](#4-ipc-channels)
5. [Main Process](#5-main-process)
6. [Preload Bridge](#6-preload-bridge)
7. [Renderer](#7-renderer)
8. [Native C++ Addon](#8-native-c-addon)
9. [Build Pipeline](#9-build-pipeline)
10. [Event Flows](#10-event-flows)
11. [Platform Differences](#11-platform-differences)
12. [Error Handling](#12-error-handling)
13. [Configuration](#13-configuration)
14. [CI/CD](#14-cicd)

---

## 1. Overview

TunnelGate wraps `cloudflared access tcp` into a GUI:
1. User adds a tunnel config (hostname, username, password)
2. App spawns `cloudflared` to create a secure tunnel from remote RDP server to localhost
3. User connects via **in-app FreeRDP viewer** (rendered to `<canvas>`) or **native RDP client** (mstsc / Microsoft Remote Desktop / xfreerdp)
4. Passwords are encrypted at rest via Electron `safeStorage`

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────┐
│  Renderer Process (React + Vite)                    │
│  ┌───────────┐ ┌──────────┐ ┌────────┐ ┌────────┐  │
│  │ Tunnels   │ │ RdpView  │ │ Logs   │ │Settings│  │
│  │ View      │ │ (Canvas) │ │ View   │ │ View   │  │
│  └─────┬─────┘ └────┬─────┘ └───┬────┘ └───┬────┘  │
│        │             │           │           │       │
│  ┌─────┴─────────────┴───────────┴───────────┴────┐  │
│  │         window.cloudflareRdp (contextBridge)    │  │
│  └─────────────────────┬───────────────────────────┘  │
└────────────────────────┼──────────────────────────────┘
                         │ IPC (contextIsolated)
┌────────────────────────┼──────────────────────────────┐
│  Main Process (Node.js + Electron)                    │
│  ┌──────────┐ ┌──────────────┐ ┌──────────────────┐  │
│  │ Tunnel   │ │ RdpView      │ │ CredentialStore  │  │
│  │ Manager  │ │ Manager      │ │ (safeStorage)    │  │
│  └────┬─────┘ └──────┬───────┘ └──────────────────┘  │
│       │              │                                │
│  ┌────┴──────────────┴────────────────────────────┐   │
│  │            ipcHandlers.ts                      │   │
│  └────────────────────┬───────────────────────────┘   │
│                       │                                │
│  ┌────────────────────┴───────────────────────────┐   │
│  │         Native Addon (C++ N-API)                │   │
│  │  rdp_addon.node → rdp_session.cpp               │   │
│  │                   rdp_module.cpp                │   │
│  │                        ↕                        │   │
│  │               FreeRDP 3 Library                  │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Layers

| Layer | Technology | Location |
|-------|-----------|----------|
| **Renderer** | React 18 + TypeScript + Vite | `src/renderer/` |
| **Preload** | Electron contextBridge | `src/preload/` |
| **Main** | Node.js + Electron APIs | `src/main/` |
| **Shared** | TypeScript types/constants | `src/shared/` |
| **Native** | C++17 + N-API + FreeRDP 3 | `src/native/rdp-addon/` |

---

## 3. Directory Layout

```
/
├── .github/workflows/build-and-release.yml   # CI/CD pipeline
├── .gitignore
├── index.html                                 # Vite entry HTML
├── package.json
├── electron-builder.yml                       # Packaging config
├── vite.config.ts                             # Vite bundler config
├── tsconfig.json                              # TS config (renderer + shared)
├── tsconfig.main.json                         # TS config (main process)
├── tsconfig.preload.json                      # TS config (preload)
│
├── scripts/
│   └── build-native.js                        # C++ addon build script
│
├── build/
│   └── entitlements.mac.plist                 # macOS sandbox entitlements
│
├── resources/
│   ├── cloudflared.exe                        # Bundled cloudflared (Win)
│   └── icons/                                 # App + tray icons
│
├── native/
│   └── rdp-addon/build/Release/
│       ├── rdp_addon.node                     # Compiled native addon
│       ├── freerdp2.dll / libfreerdp3.3.dylib # FreeRDP libraries
│       ├── winpr2.dll / libwinpr3.3.dylib     # WinPR libraries
│       └── ...                                # Transitive dylibs/DLLs
│
├── src/
│   ├── shared/
│   │   └── types.ts                           # All types + IPC channel constants
│   │
│   ├── main/
│   │   ├── index.ts                           # App entry, tray, window
│   │   ├── ipcHandlers.ts                     # All IPC handler registrations
│   │   ├── tunnelManager.ts                   # cloudflared process lifecycle
│   │   ├── rdpViewManager.ts                  # Native addon bridge
│   │   ├── credentialStore.ts                 # Password encrypt/decrypt + cmdkey
│   │   ├── store.ts                           # electron-store persistence
│   │   └── logger.ts                          # Logging (electron-log + ring buffer)
│   │
│   ├── preload/
│   │   └── index.ts                           # contextBridge API exposure
│   │
│   ├── renderer/
│   │   ├── main.tsx                           # React mount point
│   │   ├── App.tsx                            # Shell + navigation
│   │   ├── index.css                          # CSS custom properties
│   │   ├── types.d.ts                         # window.cloudflareRdp type def
│   │   ├── views/
│   │   │   ├── Tunnels.tsx                    # Tunnel list + CRUD
│   │   │   ├── RdpView.tsx                    # Full-screen RDP viewer
│   │   │   ├── Logs.tsx                       # Log viewer
│   │   │   └── Settings.tsx                   # Settings form
│   │   ├── components/
│   │   │   ├── TunnelCard.tsx                 # Single tunnel card
│   │   │   ├── TunnelForm.tsx                 # Add/edit tunnel form
│   │   │   ├── RdpCanvas.tsx                  # HTML5 Canvas RDP renderer
│   │   │   └── LogViewer.tsx                  # Scrollable log display
│   │   └── hooks/
│   │       ├── useTunnels.ts                  # Tunnel state + live updates
│   │       └── useLogs.ts                     # Log streaming + batching
│   │
│   └── native/rdp-addon/
│       ├── CMakeLists.txt                     # CMake build config
│       ├── rdp_session.h                      # RdpSession class header
│       ├── rdp_session.cpp                    # FreeRDP 3 session implementation
│       └── rdp_module.cpp                     # N-API module entry point
│
├── dist/                                      # Compiled output
│   ├── main/
│   ├── preload/
│   ├── shared/
│   └── renderer/
│
├── release/                                   # electron-builder output
│   └── mac-arm64/TunnelGate.app/
│
└── vcpkg-overlay/ports/freerdp/               # Vcpkg overlay (reserved, unused)
```

---

## 4. IPC Channels

27 channels total. Full reference:

### Renderer → Main (invoke/handle)

| Channel | Payload | Purpose |
|---------|---------|---------|
| `tunnels:list` | — | List all tunnel configs |
| `tunnels:add` | `TunnelFormData` | Create tunnel (encrypts password) |
| `tunnels:update` | `TunnelConfig & {password?}` | Update tunnel (re-encrypts if password provided) |
| `tunnels:delete` | `tunnelId` | Delete tunnel (+ disconnect) |
| `tunnel:connect` | `tunnelId` | Start cloudflared tunnel |
| `tunnel:disconnect` | `tunnelId` | Stop cloudflared tunnel |
| `tunnels:export-logs` | `tunnelId?` | Save logs to file |
| `settings:get` | — | Get app settings |
| `settings:set` | `AppSettings` | Update settings |
| `app:get-version` | — | Get app version |
| `dialog:select-file` | — | Open file picker |
| `check:cloudflared` | — | Find cloudflared binary |
| `rdp:available` | — | Check native addon loaded |
| `rdp:view-connect` | `tunnelId, width?, height?` | Start in-app RDP session |
| `rdp:view-disconnect` | `tunnelId` | Stop in-app RDP session |
| `rdp:view-mouse` | `tunnelId, flags, x, y` | Mouse input |
| `rdp:view-keyboard` | `tunnelId, flags, code` | Keyboard input |
| `rdp:view-update-password` | `tunnelId, newPassword` | Update expired password + reconnect |
| `rdp:launch-native-client` | `tunnelId` | Launch native RDP client |

### Main → Renderer (send/on)

| Channel | Payload | Purpose |
|---------|---------|---------|
| `tunnel:status-change` | `TunnelRuntimeState` | Tunnel status update |
| `tunnel:log` | `{tunnelId, tunnelName, level, message}` | Log entry |
| `rdp:frame` | `tunnelId, rect, Buffer` | RDP bitmap frame |
| `rdp:event` | `tunnelId, type, ...args` | RDP session event (disconnect/error/resize/password-expired) |
| `tray-connect` | `tunnelId` | Tray menu connect action |

---

## 5. Main Process

### `src/main/index.ts` — App Entry

- Theme system: supports Dark, Light, System, Transparent (semi-transparent backgrounds), Nordic (blue-gray palette), Sunset (warm purple/orange). Theme is persisted in settings and applied via CSS classes on `<html>`. System theme reacts to `prefers-color-scheme` media query changes.
- Creates tray with 4 programmatic icons (idle/connecting/connected/error as 16×16 RGBA circles)
- Creates BrowserWindow (1000×700, min 900×600)
- Loads Vite dev server (port 5173) in dev or `dist/renderer/index.html` in prod
- Close hides to tray (`PREVENT_WINDOW_CLOSE = true`)
- Initializes `TunnelManager` and `RdpViewManager`, registers IPC handlers

### `src/main/ipcHandlers.ts` — IPC Router

All handlers:
- **`tunnels:add`**: validates hostname regex `/^[a-zA-Z0-9](...)*\.[a-zA-Z]{2,}$/`, encrypts password with `safeStorage`, generates UUID
- **`tunnel:connect`**: decrypts stored password, calls `tunnelManager.connect()`
- **`rdp:view-connect`**: decrypts password, gets local port from tunnel manager, calls `rdpViewManager.connectView()`
- **`rdp:view-update-password`**: re-encrypts new password in store, updates Windows credential (cmdkey), disconnects old view + reconnects with new password
- **`rdp:launch-native-client`**: calls `tunnelManager.launchNativeClient()`
- **`check:cloudflared`**: searches settings path → PATH → `%LOCALAPPDATA%/cloudflared/` → `%PROGRAMFILES%/cloudflared/` → bundled resources

### `src/main/tunnelManager.ts` — Cloudflared Lifecycle

**ManagedTunnel** state:
```
{ config, state, proc?, reconnectAttempts, disconnectRequested, password, spawnFailed, stderrBuffer, stdoutBuffer }
```

**Key flow:**
1. `connect()` → `startProcess()`:
   - `findFreePort(preferred)` — TCP bind to find available port
   - `findCloudflared()` — search paths for binary
   - Spawns: `cloudflared access tcp --hostname <host> --url localhost:<port> --loglevel debug`
   - `waitForReady()` — monitors stdout/stderr for "ready"/"listening" (30s timeout)
   - `handleReady()` → injects Windows credential (cmdkey), sets status=connected
2. **Reconnection**: exponential backoff `min(1000 × 2^(n-1), 15000)` ms, max attempts from settings
3. **Disconnect**: `treeKill(pid, SIGTERM)`, optionally clears cmdkey credential

### `src/main/rdpViewManager.ts` — Native Addon Bridge

- Loads `native/rdp-addon/build/Release/rdp_addon.node` from `process.resourcesPath`
- Sets `OPENSSL_MODULES` and `OPENSSL_CONF` env vars in the main process before loading the addon (C++ `EnvVarInitializer` overrides these via `_putenv_s` at DLL load time)
- `connectView()` → calls `addon.createSession()`:
  - Connects to `127.0.0.1:<port>` (tunneled localhost)
  - Passes `forwardFrame()` for bitmap data → sends `rdp:frame` IPC
  - Passes `handleEvent()` for events → sends `rdp:event` IPC
- On Windows, error code 131087 (password expired false positive) is intercepted in the throw path and replaced with a generic NLA error message

### `src/main/credentialStore.ts` — Secure Storage

- `encrypt(password)` → `safeStorage.encryptString()` → base64
- `decrypt(encryptedBase64)` → base64 decode → `safeStorage.decryptString()`
- `injectCredential()` — Windows only: `cmdkey /generic:TERMSRV/localhost:<port> /user:<user> /pass:<pass>`
- `clearCredential()` — Windows only: `cmdkey /delete:TERMSRV/localhost:<port>`

### `src/main/store.ts` — Persistence

- Uses `electron-store` with JSON schema validation
- Stores: tunnels array, settings object
- `setSettings()` also calls `app.setLoginItemSettings()` for auto-start

### `src/main/logger.ts` — Logging

- `electron-log` for file output (5MB max, info level)
- Console logging in dev (debug level)
- 500-entry ring buffer in memory
- Credential scrubbing: replaces `password=xxx` with `password=***`

---

## 6. Preload Bridge

### `src/preload/index.ts`

Exposes `window.cloudflareRdp` via `contextBridge.exposeInMainWorld()`:

```typescript
window.cloudflareRdp = {
  tunnels: {
    list, add, update, delete, connect, disconnect,
    exportLogs, onStatusChange, onLog, onTrayConnect
  },
  settings: { get, set },
  app: { getVersion, selectFile, checkCloudflared },
  rdp: {
    isAvailable, launchNativeClient, connect, disconnect,
    sendMouse, sendKeyboard, onFrame, onEvent, updatePassword
  }
}
```

Security: `contextIsolation: true`, `nodeIntegration: false`.

---

## 7. Renderer

### Views

| View | File | Purpose |
|------|------|---------|
| Tunnels | `views/Tunnels.tsx` | Tunnel list with CRUD, animated status dots, connection duration timer, last-connected timestamps, port badges, hover effects |
| RdpView | `views/RdpView.tsx` | RDP viewer with toolbar, canvas, error/password-update overlays. Fullscreen delegated to OS (F11/window manager) |
| Logs | `views/Logs.tsx` | Filtered log viewer with tunnel chips, search/filter box, auto-scroll toggle, level badges, clear button |
| Settings | `views/Settings.tsx` | Cloudflared path, auto-start, reconnect count, theme (Dark/Light/System/Transparent/Nordic/Sunset), tooltips on all settings, section dividers |

### Components

| Component | File | Purpose |
|-----------|------|---------|
| TunnelCard | `components/TunnelCard.tsx` | Status dot (animated pulse when connecting), live output scroller, connection duration timer, hover highlight, port badge, last-connected time, action buttons |
| TunnelForm | `components/TunnelForm.tsx` | Add/edit form with hostname validation, password toggle |
| RdpCanvas | `components/RdpCanvas.tsx` | Double-buffered canvas rendering RDP frames |
| LogViewer | `components/LogViewer.tsx` | Scrollable log with auto-scroll toggle, search/filter box, level badges (ERROR/WARN/INFO/DEBUG), millisecond timestamps, clear button, export |
| Settings | `views/Settings.tsx` | Section dividers, tooltips on every setting, theme selector (Dark/Light/System/Transparent/Nordic/Sunset), cloudflared path browser |

### Hooks

| Hook | File | Purpose |
|------|------|---------|
| useTunnels | `hooks/useTunnels.ts` | CRUD + live status via IPC + tray events |
| useLogs | `hooks/useLogs.ts` | Streaming logs, 500-entry ring, rAF batching, clear function |

### RdpCanvas Details

- **Double-buffered**: offscreen canvas + visible canvas
- **Frame queue**: incoming frames pushed to `pendingRef`, batched via `requestAnimationFrame`
- **Pixel format**: RGBA 8-8-8-8 (converted from FreeRDP's BGRX32)
- **Mouse**: Slow-path RDP pointer flags, coordinate scaling (internal 1280×720 → CSS size)
- **Keyboard**: keyCode + flag (0 = press, 0x8000 = release)

### RdpView States

```
addonAvailable === null    → Checking addon
addonAvailable === false   → Error banner + "Open Native Client Instead"
connectView called         → "Connecting..."
connectView succeeded      → RdpCanvas rendered
connectView threw          → Error banner + Retry / Open Native Client / Cancel
password expired detected  → Amber dialog with password input + "Update & Reconnect"
```

### RdpView Fullscreen

Fullscreen is delegated entirely to the OS (F11 / window manager). The in-app fullscreen button was removed because it conflicts with the OS-native fullscreen behavior and provides no additional value. The canvas parent uses `display: flex; overflow: hidden` to fill the available space correctly.

Canvas dimensions are frozen after the initial RDP connect to prevent buffer clearing on window resize. The canvas uses `object-fit: contain` with `image-rendering: pixelated` CSS for crisp scaling. ResizeObserver continues to track container size in `connectSizeRef` for potential reconnects but no longer updates canvas state after connection is established.

### LogViewer Features

- **Millisecond timestamps**: `HH:MM:SS.mmm` format for precise debugging
- **Log level badges**: Color-coded pill badges `[ERROR]` `[WARN]` `[INFO]` `[DEBUG]`
- **Color coding**: Errors in red, warnings in amber, info in default, debug in muted
- **Auto-scroll toggle**: Button to lock/unlock auto-scroll to bottom; auto-disables when user scrolls up
- **Search/filter box**: Real-time text filtering across message, tunnel name, and level
- **Clear button**: Clears the in-memory log buffer without affecting persisted logs or export
- **Tunnel filter chips**: Filter by specific tunnel or view all

### TunnelCard Features

- **Animated status dot**: Pulsing animation when connecting/reconnecting, solid otherwise
- **Connection duration timer**: Live "5m 32s" counter displayed next to hostname when connected
- **Last connected time**: Relative timestamp ("5m ago") shown under hostname
- **Port badge**: Subtle monospace badge showing `:3380` next to the status label
- **Hover highlight**: Card lifts slightly and shows shadow on mouse hover
- **Card enter animation**: Fade-in + slide-up when cards first appear

---

## 8. Native C++ Addon

### `rdp_session.h` — Header

**RdpFrameListener** interface:
- `onBitmapUpdate(x, y, w, h, data, size)` — from pump thread during endPaint
- `onResize(w, h)` — from desktop resize
- `onDisconnect(reason)` — from pump thread on disconnect
- `onError(msg)` — from connect failure or runtime error

**RdpSession** class:
- Constructor: `(host, port, width, height, username, password, listener)`
- `connect()` / `disconnect()` / `isConnected()`
- `sendPointerEvent()` / `sendKeyboardEvent()` / `resize()`

### `rdp_session.cpp` — Implementation

**Connect (lines 47-115):**
1. `freerdp_new()` → `freerdp_context_new()`
2. Set settings: hostname, port, desktop size, color depth (32), username, password
3. **Platform-specific NLA**:
   - **Windows**: `NlaSecurity=FALSE`, `TlsSecurity=TRUE` (avoids false ERRCONNECT_PASSWORD_EXPIRED from SSPI)
   - **Mac/Linux**: `NlaSecurity=TRUE` (standard NLA)
4. `Authentication=TRUE`, `IgnoreCertificate=TRUE`, `NSCodec=TRUE`, `RemoteFxCodec=TRUE`, `FastPathOutput=TRUE`
5. `PostConnect = postConnectCallback`
6. `freerdp_connect()` → on fail: capture error code + string, cleanup
7. On success: start pump thread

**postConnectCallback (lines 22-45):**
- `gdi_init(instance, PIXEL_FORMAT_BGRX32)`
- Register `BeginPaint`, `EndPaint`, `DesktopResize`

**Pump thread (lines 138-189):**
- Loop: `freerdp_get_event_handles()` → `freerdp_check_event_handles()`
- 50 consecutive failures → force disconnect
- 10ms sleep per iteration (`Sleep(10)` on Win, `usleep(10000)` on others)

**endPaint (lines 214-274):**
- Get invalid rect from `gdi->primary->hdc->hwnd->invalid`
- BGR→RGBA conversion (byte-by-byte):
  - `dst[R] = src[B]`, `dst[G] = src[G]`, `dst[B] = src[R]`, `dst[A] = 255`
- Call `listener->onBitmapUpdate()`

### `rdp_module.cpp` — N-API Bridge

**Exports:**
| JS function | C++ function |
|-------------|-------------|
| `createSession` | `CreateSession` — 8 args (host, port, w, h, user, pass, onBitmap, onEvent) |
| `destroySession` | `DestroySession` — sessionId |
| `sendPointerEvent` | `SendPointerEvent` — sessionId, flags, x, y |
| `sendKeyboardEvent` | `SendKeyboardEvent` — sessionId, flags, code |

**JsFrameListener** — Thread-safe callback bridge:
- 4 `Napi::ThreadSafeFunction` instances (queue size 1): bitmap, resize, disconnect, error
- `onBitmapUpdate()`: copies pixel data into `shared_ptr<vector>`, calls `BlockingCall` → JS creates `Napi::Buffer::Copy()`
- `onResize`/`onDisconnect`/`onError`: all reuse the same `onEvent` JS callback

**Session registry:** `static std::map<int, SessionHolder>` with mutex, auto-incrementing IDs

**Windows OpenSSL setup (global `EnvVarInitializer`):**
- Runs at DLL load time (static global constructor in `rdp_session.cpp`)
- Writes `openssl.cnf` config: `openssl_conf = openssl_init`, `providers = provider_sect`, `legacy = legacy_sect`
- Sets `OPENSSL_MODULES` and `OPENSSL_CONF` via `_putenv_s` (overrides any Node.js `process.env` value)
- `ensureLegacyProvider()` loads legacy + default providers, verifies `EVP_rc4()` is available
- `normalizePath()` strips `\\?\` prefix from module path before passing to env vars

### `CMakeLists.txt`

- C++17
- Finds FreeRDP (freerdp3/2), WinPR, FreeRDP-Client
- Outputs `.node` shared library (no prefix)
- Links: `rdp_module.cpp`, `rdp_session.cpp`, `${CMAKE_JS_SRC}`

---

## 9. Build Pipeline

```
npm run build:all
  ├── npm run build:native
  │     ├── cmake-js install (download Electron ABI headers)
  │     ├── cmake configure + build
  │     └── Platform dylib management:
  │         Windows: copy freerdp2.dll, winpr2.dll, crypto/ssl DLLs from vcpkg
  │         macOS:   copy dylibs, rewrite @rpath → @loader_path, ad-hoc sign
  │         Linux:   no extra step
  └── npm run build
        ├── tsc -p tsconfig.main.json       → dist/main/
        ├── tsc -p tsconfig.preload.json    → dist/preload/
        └── vite build                       → dist/renderer/
```

### Native Build Script (`scripts/build-native.js`)

Steps:
1. Resolve cmake-js binary
2. Download Electron headers per platform arch
3. Clear old build dir, create fresh ones
4. Platform flags:
   - **Windows**: vcpkg toolchain, `/DELAYLOAD:NODE.EXE`, MultiThreaded MSVC runtime
   - **macOS**: `brew --prefix freerdp`, `-DCMAKE_OSX_ARCHITECTURES=arm64`, `-undefined dynamic_lookup`
   - **Linux**: system FreeRDP at `/usr`, `--unresolved-symbols=ignore-all`
5. cmake configure → cmake --build
6. Copy `rdp_addon.node` to output dir
7. Platform dylib steps:
   - **Windows**: BFS all `dumpbin /dependents` deps → copy DLLs
   - **macOS**: BFS all `otool -L` deps → copy dylibs → `install_name_tool` rewrite → ad-hoc codesign each

### Packaging (`electron-builder.yml`)

- **appId**: `com.tunnelgate.app`
- **Output**: `release/`
- **Extra resources**: `resources/cloudflared*`, `native/**/*`
- **Windows**: NSIS (oneClick=false, perMachine=false, install dir choice, desktop shortcut)
- **macOS**: DMG, arm64 (hardenedRuntime=false due to macOS 26 codesign bug)
- **Linux**: AppImage + deb, category Utility

---

## 10. Event Flows

### Full Tunnel Connection

```
User clicks "Connect"
  → Tunnels.tsx: tunnels.connect(id)
    → IPC tunnel:connect
      → tunnelManager.connect(config, password)
        → status = 'connecting' → IPC tunnel:status-change
        → findFreePort()
        → findCloudflared()
        → spawn cloudflared access tcp ...
        → waitForReady() [monitor stdout/stderr]
        → handleReady()
          → credentialStore.injectCredential() [Windows: cmdkey]
          → status = 'connected' → IPC tunnel:status-change
```

### Full In-App RDP View

```
User clicks "View Screen" on connected tunnel
  → App.tsx sets viewingTunnel → renders <RdpView>
    → RdpView useEffect:
      → check rdp.isAvailable()
      → rdp.connect(tunnelId)
        → IPC rdp:view-connect
          → ipcHandler: decrypt password, get localPort
          → rdpViewManager.connectView()
            → addon.createSession('127.0.0.1', port, ...)
              → C++ freerdp_connect()
              → PostConnect → gdi_init() + register callbacks
              → start pump thread
              → returns sessionId
      → status = 'connected'

    → C++ endPaint fires (pump thread):
      → onBitmapUpdate() via ThreadSafeFunction
        → rdpViewManager.forwardFrame()
          → IPC rdp:frame  {tunnelId, rect, Buffer}
            → RdpCanvas: push frame queue → rAF → paint()
```

### Disconnect

```
User clicks "Disconnect" or "← Back"
  → tunnelManager.disconnect(tunnelId)
    → treeKill(pid, SIGTERM)
    → process closes → status = 'disconnected'
    → optionally cmdkey /delete
  → rdpViewManager.disconnectView(tunnelId)
    → addon.destroySession(sessionId)
      → C++: join pump thread, gdi_free, freerdp_disconnect
```

---

## 11. Platform Differences

| Feature | Windows | macOS | Linux |
|---------|---------|-------|-------|
| **Native RDP client** | `mstsc.exe` | Microsoft Remote Desktop | `xfreerdp` / `remmina` |
| **Credential injection** | `cmdkey` (Windows Credential Manager) | Skipped | Skipped |
| **NLA setting** | `NlaSecurity=TRUE`, `TlsSecurity=TRUE` | `NlaSecurity=TRUE` | `NlaSecurity=TRUE` |
| **FreeRDP source** | vcpkg `freerdp:x64-windows` | Homebrew `freerdp` | `apt install freerdp2-dev` |
| **Build generator** | VS auto-detected (2022/2026) via vcvarsall | Unix Makefiles | Unix Makefiles |
| **Dylib handling** | Copy DLLs + deps from vcpkg | Copy .dylib, `install_name_tool`, ad-hoc sign | No extra step |
| **cloudflared name** | `cloudflared.exe` | `cloudflared` | `cloudflared` |
| **Binary search** | `%LOCALAPPDATA%`, `%PROGRAMFILES%` | `/usr/local/bin`, `/opt/homebrew/bin` | `/usr/local/bin`, `/usr/bin` |
| **File dialog** | `.exe`, `.cmd`, `.bat` | `(any)`, `.sh` | `(any)`, `.sh` |
| **Window close** | Hide to tray | Don't quit (macOS standard) | Hide to tray |
| **Pump sleep** | `Sleep(10)` | `usleep(10000)` | `usleep(10000)` |

### Windows-Specific FreeRDP Issues

**1. Password Expired False Positive (131087):**
FreeRDP on Windows uses native Windows SSPI for NLA, which can falsely report `ERRCONNECT_PASSWORD_EXPIRED` (code 131087) even when the password is valid. This is caused by stale Kerberos tickets or cached domain credentials. Intercepted in `rdpViewManager.ts` and replaced with a generic NLA error message.

**2. OpenSSL Legacy Provider for RC4:**
FreeRDP 3 on Windows requires the OpenSSL legacy provider for RC4 during RDP licensing negotiation. The addon's C++ `EnvVarInitializer` writes an `openssl.cnf` config file and sets `OPENSSL_MODULES` + `OPENSSL_CONF` via `_putenv_s` at DLL load time. The path from `GetModuleFileNameA` must be normalized to strip the `\\?\` extended-length prefix (OpenSSL DSO loader rejects it). A `legacy.dll` and `ossl-modules/` directory are deployed alongside `rdp_addon.node`.

---

## 12. Error Handling

### Renderer Layer

| What | Where | Behavior |
|------|-------|----------|
| Tunnel connection failure | `TunnelCard.tsx` | Shows `lastError` in red banner, "Connect" button still available |
| RDP view failure | `RdpView.tsx` | Error overlay with "Retry Connection", "Open Native Client", "Cancel" |
| Password expired (Mac/Linux) | `RdpView.tsx` | Amber dialog with password input + "Update Password & Reconnect" |
| Password expired (Windows false positive) | `rdpViewManager.ts` | Intercepted, replaced with generic NLA error message |
| Addon not available | `RdpView.tsx` | Shows error + "Open Native Client" as only option |
| Cloudflared not found | `TunnelManager.ts` | Error message with instructions to set path in Settings |
| Invalid hostname | `TunnelForm.tsx` | Red inline validation error |
| Decryption failure | `IPC handler` | "Failed to decrypt credentials" |

### Main Process Layer

| What | Where | Behavior |
|------|-------|----------|
| Tunnel spawn failure | `tunnelManager.ts` | Sets status=error with error message |
| Cloudflared timeout | `tunnelManager.ts` | 30s timeout, sets error with stderr output |
| Unexpected disconnect | `tunnelManager.ts` | Auto-reconnect with exponential backoff (max attempts from settings) |
| cmdkey failure | `credentialStore.ts` | Logs error, does not block connection |
| Native addon load failure | `rdpViewManager.ts` | Sets `addonAvailable=false`, logs error |

### C++ Addon Layer

| What | Where | Behavior |
|------|-------|----------|
| Connection failure | `rdp_session.cpp:91-106` | Captures `freerdp_get_last_error()` code + string, throws N-API error |
| GDI init failure | `rdp_session.cpp:28-32` | Returns FALSE from PostConnect, `onError` callback fires |
| Pump stall | `rdp_session.cpp:170-177` | 50 consecutive failures → force disconnect |
| Null pointer guard | Throughout | All callbacks check `self` and `listener_` before dereferencing |

---

## 13. Configuration

### `electron-store` Schema

Stored as JSON in electron-store default location (`tunnelgate-config`):

**Tunnels array:**
```typescript
{
  id: string,
  name: string,
  hostname: string,
  port: number,            // default 3389
  username: string,
  encryptedPassword: string, // base64 of safeStorage encrypted bytes
  rememberAfterSession: boolean,
  createdAt: string,        // ISO 8601
  lastConnectedAt?: string
}
```

**Settings object:**
```typescript
{
  cloudflaredPath: string,        // default ""
  launchOnStartup: boolean,       // default false
  startMinimizedToTray: boolean,   // default false
  theme: 'dark' | 'light' | 'system' | 'transparent' | 'nordic' | 'sunset', // default 'dark'
  autoReconnectAttempts: number,  // default 3
  forgetPasswordAfterSession: boolean  // default true
}
```

### Hostname Validation Regex

```
/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/
```

### Port Range

1–65535, default 3389. Auto-fallback to next available port if preferred is in use.

---

## 14. CI/CD

File: `.github/workflows/build-and-release.yml`

### Trigger

Push to `main` branch.

### Matrix

| Runner | Target | Command | Artifacts |
|--------|--------|---------|-----------|
| `ubuntu-latest` | Linux (x64) | `electron:build:linux --publish never` | AppImage, deb |
| `windows-latest` | Windows (x64) | `electron:build --win nsis --publish never` | NSIS exe |
| `macos-latest` | macOS (arm64) | `electron:build:mac --publish never` | DMG |

### FreeRDP Setup

- **Linux**: `apt-get install freerdp2-dev`
- **macOS**: Builds FreeRDP 2.11.7 from source (brew ships 3.x but addon needs 2.x API), minimal features (no X11/SDL/ALSA/etc.), installs to `/usr/local/freerdp2`, sets `FREERDP_ROOT`
- **Windows**: vcpkg installs FreeRDP 2.11.2 port, `--no-binarycaching --classic`

### Verification

Checks `rdp_addon.node` exists after build. Uploads artifacts with 14-day retention.

### Publish

Downloads all artifacts, creates release tag (`v<version>` or `v<version>-build.<run_number>`), publishes GitHub release with all artifacts via `gh release create`.
