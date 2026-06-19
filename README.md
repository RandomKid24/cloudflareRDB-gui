# TunnelGate

One-click RDP through Cloudflare Tunnel — no terminal required.

## Downloads

| Platform | File | How to build |
|---|---|---|
| **macOS** (Intel) | `TunnelGate-1.0.0.dmg` | `npm run build && npx electron-builder --mac --x64` |
| **macOS** (Apple Silicon) | `TunnelGate-1.0.0-arm64.dmg` | `npm run build && npx electron-builder --mac --arm64` |
| **Windows** | `TunnelGate Setup 1.0.0.exe` | `npm run build && npx electron-builder --win` |
| **Linux** | `TunnelGate-1.0.0.AppImage` | `npm run build && npx electron-builder --linux` |
| **Linux** | `tunnelgate_1.0.0_amd64.deb` | `npm run build && npx electron-builder --linux` |

## Prerequisites

- [cloudflared](https://github.com/cloudflare/cloudflared/releases) installed on your system
- **macOS**: [FreeRDP 3](https://github.com/FreeRDP/FreeRDP) (`brew install freerdp`) for native RDP rendering
- **Linux**: `apt install freerdp3-dev` or equivalent
- **Windows**: FreeRDP 3 from vcpkg or prebuilt DLLs

## Development

```sh
npm install
npm run build:all     # build native addon + TypeScript + Vite
npm run dev           # Vite dev server + Electron (macOS/Linux)

# Package specific platform
npm run build:all && npx electron-builder --mac    # DMG
npm run build:all && npx electron-builder --win    # NSIS exe
npm run build:all && npx electron-builder --linux  # AppImage + deb
```

## macOS: Build & Deploy

### App is damaged fix
```sh
xattr -cr /Applications/TunnelGate.app
```

Or build without signing:
```sh
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:all && npx electron-builder --mac --dir
```

### Electron Framework Corruption (macOS 26+)
electron-builder's built-in `codesign` corrupts the Electron Framework binary on macOS 26 (Tahoe).
**Always** replace it from `node_modules` after building:

```bash
cp node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron\ Framework.framework/Versions/A/Electron\ Framework \
   release/mac-arm64/TunnelGate.app/Contents/Frameworks/Electron\ Framework.framework/Versions/A/Electron\ Framework

codesign --deep --force --sign - --options runtime \
  --entitlements build/entitlements.mac.plist \
  release/mac-arm64/TunnelGate.app
```

## How It Works

1. User adds a tunnel target (hostname, username, encrypted password)
2. One click starts `cloudflared access tcp --hostname <host> --url localhost:<port>`
3. Once the tunnel is ready, the app opens a native RDP viewer **inside the Electron window** using FreeRDP 3 GDI rendering
4. Remote desktop frames are decoded in C++, streamed to a React `<canvas>` via IPC
5. Keyboard/mouse input is forwarded back to the RDP server
6. Disconnect kills the cloudflared process and cleans up credentials

### RDP Rendering Pipeline

See [docs/RDP_NATIVE_ADDON.md](docs/RDP_NATIVE_ADDON.md) for the complete architecture and
implementation guide, including pixel format, threading, IPC flow, and cross-platform notes.

## Security

- Passwords are encrypted at rest using Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret on Linux)
- Credentials are never written to disk in plaintext or included in logs
- All spawned processes use `args` arrays (no shell string interpolation)
- Hostnames are validated against a strict regex before spawning cloudflared
- `contextIsolation: true`, `nodeIntegration: false`
