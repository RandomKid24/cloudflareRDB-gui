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

> Releases are also built automatically on every push to `main` via GitHub Actions — see [workflow](.github/workflows/build-and-release.yml).

## Prerequisites

- [cloudflared](https://github.com/cloudflare/cloudflared/releases) installed on your system (or place the binary in the app's `resources/` folder before packaging)

## Development

```sh
npm install
npm run build        # compile all source
npm run dev          # Vite dev server + Electron (macOS/Linux)

# Package specific platform
npm run build && npx electron-builder --mac    # DMG
npm run build && npx electron-builder --win    # NSIS exe
npm run build && npx electron-builder --linux  # AppImage + deb
```

## How it works

1. User adds a tunnel target (hostname, username, encrypted password)
2. One click starts `cloudflared access tcp --hostname <host> --url localhost:<port>`
3. Once the tunnel is ready, the app injects credentials (Windows via `cmdkey`, macOS via Microsoft Remote Desktop, Linux via xfreerdp/Remmina)
4. RDP client launches pointing at the local forwarded port
5. Disconnect kills the cloudflared process and cleans up credentials

## Security

- Passwords are encrypted at rest using Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret on Linux)
- Credentials are never written to disk in plaintext or included in logs
- All spawned processes use `args` arrays (no shell string interpolation)
- Hostnames are validated against a strict regex before spawning cloudflared
- `contextIsolation: true`, `nodeIntegration: false`
