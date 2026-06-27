# RDP Native Addon — Architecture & Implementation Guide

## Overview

Complete RDP rendering pipeline: C++ FreeRDP 3 addon compiled as Electron N-API native module,
streaming GDI bitmap updates to a React `<canvas>` via IPC.

---

## How It Works

```
FreeRDP GDI -> C++ endPaint -> BGR->RGBA swap -> N-API Buffer -> Main Process IPC
    -> Preload (contextBridge) -> React Component -> Offscreen Canvas -> Visible Canvas
```

1. **FreeRDP 3** connects to RDP server, decodes frames into GDI framebuffer
2. On `EndPaint`, C++ reads dirty-rect pixels from framebuffer, converts BGRX32->RGBA,
   passes to JS callback via `Napi::ThreadSafeFunction`
3. Main process forwards raw `Buffer` to renderer via `webContents.send('rdp:frame', ...)`
4. Preload receives event, exposes through `contextBridge`
5. React `RdpCanvas` receives frame data, draws to offscreen canvas via `putImageData`,
   blits to visible canvas via `drawImage`

---

## Thread Architecture

| Thread | Role |
|--------|------|
| **Main (Node.js)** | Electron main process; creates RDP sessions; forwards frames via IPC |
| **Pump (C++)** | Runs `freerdp_check_event_handles` loop; receives network events |
| **Renderer (Chromium)** | React UI; receives IPC frames; paints to `<canvas>` |

Pump thread -> Main thread via `Napi::ThreadSafeFunction`. Main thread -> Renderer via Electron IPC.

---

## File Reference

### C++ Native Addon (`src/native/rdp-addon/`)

| File | Purpose |
|------|---------|
| `rdp_session.h` | `RdpSession` class + `RdpFrameListener` interface |
| `rdp_session.cpp` | Connect, pump loop, `endPaint`, pixel conversion, mouse/keyboard |
| `rdp_module.cpp` | N-API entry: `createSession`, `destroySession`, `sendPointerEvent`, `sendKeyboardEvent` |
| `CMakeLists.txt` | CMake build: finds FreeRDP 3/WinPR, outputs `rdp_addon.node` |

### TypeScript / Electron

| File | Purpose |
|------|---------|
| `src/main/rdpViewManager.ts` | Main process: creates sessions, forwards frames to renderer |
| `src/main/index.ts` | App entry: wires up `RdpViewManager.setWindow()` - **must happen after window creation** |
| `src/preload/index.ts` | `contextBridge` exposing `window.cloudflareRdp.rdp.*` |
| `src/renderer/components/RdpCanvas.tsx` | React canvas component: paint loop, mouse/keyboard |
| `src/renderer/views/RdpView.tsx` | Parent component mounting `RdpCanvas` |
| `src/shared/types.ts` | IPC channel constants (`RDP_VIEW_FRAME`, etc.) |

### Build Scripts

| File | Purpose |
|------|---------|
| `scripts/build-native.js` | Compiles addon, copies/mach-o-changes dylibs, signs them |
| `electron-builder.yml` | electron-builder config; `hardenedRuntime: false` |
| `build/entitlements.mac.plist` | macOS entitlements: `allow-jit`, `disable-library-validation` |

---

## Build System

### Requirements
- **FreeRDP 3** (Homebrew: `brew install freerdp`)
- **cmake** 3.20+
- **Node.js** 18+ with `node-addon-api`

### Commands
```bash
npm run build:native       # cmake + dylib copy
npm run build              # tsc + vite
npm run build:all          # both above
npx electron-builder --mac --dir   # package (or --win, --linux)
```

### Dylib Management (`build-native.js`)
1. Runs cmake configure + build to produce `rdp_addon.node`
2. BFS resolves all transitive dylib deps via `otool -L`
3. Copies them next to the `.node` file
4. Rewrites install names to `@rpath` via `install_name_tool -change`
5. Sets `LC_RPATH` to `@loader_path`
6. Ad-hoc signs each dylib

### macOS Build Config
`electron-builder.yml` **must** have:
```yaml
mac:
  hardenedRuntime: false
```
electron-builder's `codesign` on macOS 26 (Tahoe) **corrupts the Electron Framework binary**
(produces smaller binary that crashes V8 with "Failed to reserve virtual memory for CodeRange").

### Deployment (macOS)
```bash
npm run build:all
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir

cp node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron\ Framework.framework/Versions/A/Electron\ Framework \
   release/mac-arm64/TunnelGate.app/Contents/Frameworks/Electron\ Framework.framework/Versions/A/Electron\ Framework

codesign --deep --force --sign - --options runtime \
  --entitlements build/entitlements.mac.plist \
  release/mac-arm64/TunnelGate.app

rm -rf /Applications/TunnelGate.app && cp -R release/mac-arm64/TunnelGate.app /Applications/TunnelGate.app
```

---

## Pixel Pipeline

### FreeRDP Pixel Format
```cpp
gdi_init(instance, PIXEL_FORMAT_BGRX32);
```
On little-endian (x86_64, ARM64 macOS/Linux):
- Byte 0: B, Byte 1: G, Byte 2: R, Byte 3: X

### BGR -> RGBA Conversion (in `endPaint`)
```cpp
dstRow[col*4 + 0] = srcRow[col*4 + 2];  // R = src B
dstRow[col*4 + 1] = srcRow[col*4 + 1];  // G = src G
dstRow[col*4 + 2] = srcRow[col*4 + 0];  // B = src R
dstRow[col*4 + 3] = 255;                // A
```

### Stride Handling
`gdi->stride` may be larger than `width * 4` (alignment padding).
Source indexing: `(y + row) * stride + x * 4`. Destination: `row * w * 4`.

### IPC Transfer
```
C++ vector<uint8_t> rgba(w*h*4)
  -> Napi::Buffer<uint8_t>::Copy()
    -> main process Node.js Buffer
      -> webContents.send('rdp:frame', tunnelId, rect, buf)
        -> renderer preload Uint8Array
          -> contextBridge -> React ArrayBuffer
```

---

## Mouse & Keyboard

### RDP Pointer Flags
```typescript
const PTR_FLAGS_MOVE       = 0x0800;
const PTR_FLAGS_DOWN       = 0x8000;
const PTR_FLAGS_BUTTON1    = 0x1000;  // left
const PTR_FLAGS_BUTTON2    = 0x2000;  // right
const PTR_FLAGS_BUTTON3    = 0x4000;  // middle
const PTR_FLAGS_WHEEL      = 0x0200;
const PTR_FLAGS_WHEEL_NEGATIVE = 0x0100;
```

### CRITICAL: Do NOT confuse PTR_FLAGS with PTR_XFLAGS
- `PTR_FLAGS_*` (0x1xxx): Slow-Path flags for `freerdp_input_send_mouse_event`
- `PTR_XFLAGS_*` (0x00xx): Fast-Path extended flags (WRONG!)

Using `PTR_XFLAGS_BUTTON1` (0x0001) instead of `PTR_FLAGS_BUTTON1` (0x1000) sends
`ERRINFO_INVALID_INPUT_PDU_MOUSE` to the RDP server, which kills the transport.

### Mouse Event Handlers
| Handler | Flags | Notes |
|---------|-------|-------|
| `handleMouseDown` | `buttonToDownFlag(e.button)` | 0->left, 1->middle, 2->right + PTR_FLAGS_DOWN |
| `handleMouseUp` | `buttonToUpFlag(e.button)` | Same mapping, no DOWN flag |
| `handleMouseMove` | `PTR_FLAGS_MOVE` (0x0800) | |
| `handleWheel` | `PTR_FLAGS_WHEEL` +/- NEGATIVE + amount | Amount clamped to 31 |

### Coordinate Scaling
Canvas has fixed internal resolution (1280x720), CSS `width: 100%; height: 100%`:
```typescript
const scaleX = width / rect.width;
const scaleY = height / rect.height;
x = Math.round((e.clientX - rect.left) * scaleX);
y = Math.round((e.clientY - rect.top) * scaleY);
```

### Keyboard
```typescript
handleKeyDown: flags = 0          // press
handleKeyUp:   flags = 0x8000     // release (KBD_FLAGS_DOWN)
```

---

## Canvas Rendering

### Why Offscreen Canvas?
Double-buffering: draw all frames to offscreen first, then single `drawImage` to visible
canvas. Avoids tearing, batches multiple dirty-rects into one refresh.

### Paint Loop
1. `splice(0)` all pending frames from queue
2. If no frames, return early
3. Create/resize offscreen canvas to current dimensions
4. For each frame: `createImageData` -> `new Uint8ClampedArray(frame.data)` -> `set` -> `putImageData`
5. Set visible canvas `width`/`height` (clears it)
6. `drawImage(offscreen, 0, 0)` to visible canvas
7. Reset rAF ref

### Key Rules
1. **Refs for width/height** - paint is called via rAF, can get stale closures:
   ```typescript
   const widthRef = useRef(width);
   const heightRef = useRef(height);
   widthRef.current = width;
   heightRef.current = height;
   ```
2. **Empty deps on paint** - `useCallback(paint, [])` with refs instead of `[width, height]`
3. **Single rAF guard** - check `!rafRef.current` before scheduling
4. **Canvas dims in JSX AND in paint** - HTML attrs for init, `canvas.width = w; canvas.height = h;` in paint for resize
5. **`willReadFrequently: false`** - GPU-backed offscreen context

### Error Handling
Wrap `createImageData`/`putImageData` in try/catch - can throw on invalid dimensions.

---

## Cross-Platform Notes

### macOS (ARM64 build machine)
- Homebrew FreeRDP is ARM64-only; addon is ARM64
- No `WaitForMultipleObjects` or Windows-specific APIs; use `usleep` guarded by `#ifdef _WIN32`
- Hardened runtime kills unsigned dylibs - always ad-hoc sign after copy
- `disable-library-validation` + `allow-jit` entitlements required
- electron-builder signing corrupts Electron Framework on macOS 26

### Windows
- FreeRDP 3 from vcpkg (headers for compiling addon) + **prebuilt DLLs from `prebuilt/windows-x64/`**
- Do NOT rely on CI-compiled FreeRDP DLLs — they crash inside `gdi_init_ex` (see Bug 10)
- `.node` is a DLL; `LoadLibrary` resolves deps from PATH or co-located DLLs
- `bootstrap.ts` prepends `addonDir` to `PATH` before `require()`-ing the addon
- No codesign corruption issue

### Linux
- FreeRDP 3 from system packages (`apt install freerdp3-dev`)
- `.node` is a `.so`; `LD_LIBRARY_PATH` or `RPATH` controls resolution
- No signing required

### General
- `Napi::ThreadSafeFunction` with queue size 1 prevents callback pileup
- `BlockingCall` is safe from pump thread; `NonBlockingCall` also available
- Frame data is `Buffer<uint8_t>::Copy()` - the pump thread owns the original data

### Windows OpenSSL Legacy Provider (RC4)
- FreeRDP 3 on Windows requires OpenSSL legacy provider for RC4 during RDP licensing
- `GetModuleFileNameA` returns `\\?\` extended-length prefix paths; OpenSSL DSO loader rejects this syntax
- `normalizePath()` strips `\\?\` prefix before setting `OPENSSL_MODULES`/`OPENSSL_CONF`
- Global C++ `EnvVarInitializer` at DLL load time writes `openssl.cnf` and calls `_putenv_s` for both vars
- `_putenv_s` overrides `process.env` from Node.js since C++ initializer runs after JS setup
- `ensureLegacyProvider()` loads legacy + default providers and verifies `EVP_rc4()` is available
- WinPR RC4 init simulation confirms full RC4 availability before RDP session starts
- DLLs `legacy.dll` and `ossl-modules/` are deployed alongside `rdp_addon.node`

### Windows Prebuilt DLL Strategy
- CI-compiled FreeRDP 3.26.0 DLLs crash inside `gdi_init_ex` (see Bug 10)
- Known-working DLLs are committed to `prebuilt/windows-x64/` in the repo
- `build-native.js` copies from `prebuilt/windows-x64/` before copying from vcpkg
- `rdp_addon.node` is still compiled by CI (for ABI compatibility) but runtime DLLs come from repo
- **Diagnostic:** if `%APPDATA%\tunnelgate\addon-debug.log` is NOT created after an install, the crash is inside FreeRDP's own code (DLL mismatch), not our callbacks

---

## Lessons Learned (Bugs We Fixed)

### Bug 1: Mouse Flags Wrong
**Symptom**: `ERRINFO_INVALID_INPUT_PDU_MOUSE` -> transport killed -> pump loop spins forever
**Cause**: Used `PTR_XFLAGS_BUTTON1` (0x0001) instead of `PTR_FLAGS_BUTTON1` (0x1000)
**Fix**: Define correct constants at module scope, use `buttonToDownFlag`/`buttonToUpFlag` helpers.

### Bug 2: setWindow Before Window Created
**Symptom**: Black screen. Native addon produces frames, main process has them, renderer never receives.
**Cause**: `rdpViewManager.setWindow(mainWindow)` called when `mainWindow` is still `null`.
**Fix**: Move `setWindow()` call inside `createMainWindow()` after `new BrowserWindow()`.

### Bug 3: Electron Framework Corrupted on macOS 26
**Symptom**: Crashes on launch with "Failed to reserve virtual memory for CodeRange" in V8.
**Cause**: electron-builder's built-in `codesign` corrupts the Electron Framework binary.
**Fix**: Set `hardenedRuntime: false`, use `CSC_IDENTITY_AUTO_DISCOVERY=false`, then manually
replace Framework from `node_modules` and `codesign --deep` manually.

### Bug 5: OpenSSL DSO `\\?\` Path Prefix
**Symptom**: `OSSL_PROVIDER_load("legacy")` fails with DSO error `error:12800073:DSO support routines::incorrect file syntax`
**Cause**: `GetModuleFileNameA` on Windows returns paths with `\\?\` extended-length prefix (e.g., `\\?\C:\Users\...`). OpenSSL's DSO module loader does not understand this syntax.
**Fix**: `normalizePath()` strips `\\?\` prefix from the module path before passing to `OPENSSL_MODULES` env var.

### Bug 6: FreeRDP 3 API Migration
**Symptom**: Compile error `'struct rdp_context' has no member named 'settings'`
**Cause**: FreeRDP 3 moved `settings` from `instance->settings` to `instance->context->settings` for static callbacks.
**Fix**: All static callbacks (`endPaint`, `desktopResize`, `postConnect`) access settings via `instance->context->settings`.

### Bug 7: CRT Runtime Mismatch (`/MT` vs `/MD`)
**Symptom**: Heap corruption or crash in FreeRDP memory allocation across DLL boundary.
**Cause**: FreeRDP DLLs are built with `/MD` (dynamic CRT) but the addon was compiled with `/MT` (static CRT). Each has a separate CRT heap; allocations on one heap freed on the other cause corruption.
**Fix**: Switch CMakeLists.txt to `/MD` to share CRT heap with FreeRDP.

### Bug 8: CSS-Only Fullscreen Shows Taskbar
**Symptom**: Taskbar overlaps the RDP canvas in fullscreen mode, and the toolbar pushes the remote desktop down so the bottom (taskbar) is clipped.
**Cause**: Fullscreen was implemented as `position: fixed; inset: 0` (CSS-only) instead of the native Fullscreen API. The toolbar consumed 48px at the top, clipping the remote desktop.
**Fix**: Use `document.documentElement.requestFullscreen()` / `document.exitFullscreen()` to enter true OS fullscreen. In fullscreen, the toolbar is absolutely positioned with `opacity: 0.15` and reveals to full opacity on hover.

### Bug 9: VS Generator Detection — `vswhere` Path Broken

**Symptom:** CMake configure fails with `could not find any instance of Visual Studio` on machines where `ProgramFiles(x86)` env var has a non-standard value (e.g., `C:\Program Files(x86)` missing space) or when VS version doesn't match hardcoded generator.

**Cause:** The original `detectVsGenerator()` function built the vswhere path using `process.env['ProgramFiles(x86)']` which could return a malformed path, causing fallback to a hardcoded `Visual Studio 17 2022` regardless of what VS was actually installed.

**Fix:** Replaced vswhere-based detection with `detectVs()` which scans known VS installation paths for `vcvarsall.bat`, pairs each path with its correct CMake generator string (e.g., `18` → `Visual Studio 18 2026`, `2022` → `Visual Studio 17 2022`). The `vsSpawn()` function captures the VS environment by running `vcvarsall.bat x64 && set` and passes the merged environment to cmake.

### Bug 10: CI-Compiled FreeRDP DLL Crashes Inside `gdi_init_ex`

**Symptom:** GitHub Actions-built installer crashes on every RDP connection. FreeRDP log ends at `[gdi_init_ex]: Remote framebuffer format PIXEL_FORMAT_RGB16` — then nothing. No `addon-debug.log` is created at `%APPDATA%\tunnelgate\`, meaning no C++ callback code ever executes.

**Cause:** CI compiled a fresh `freerdp3.dll` (1,956,864 bytes) via vcpkg. This binary crashes inside FreeRDP's own `gdi_init_ex` before any of our callbacks run. The local working build used a different `freerdp3.dll` (1,897,984 bytes, Jun 24). Binary incompatibility between CI and local MSVC environments.

**Fix:** Committed the known-working local DLLs to `prebuilt/windows-x64/`. Updated `build-native.js` to always prefer `prebuilt/windows-x64/` over vcpkg binaries. The `rdp_addon.node` is still compiled by CI (correct, needed for Electron ABI), but runtime FreeRDP DLLs come from the repo.

**Diagnostic rule:** `addon-debug.log` not created → crash is inside FreeRDP. `addon-debug.log` created but empty/partial → crash is in our C++ code.

### Bug 4 (original): Stale Paint Closure
**Symptom**: (Potential) paint uses old width/height after resize.
**Cause**: `useCallback(paint, [width, height])` + rAF captures stale values.
**Fix**: Use refs and empty deps `useCallback(paint, [])`.

---

## Troubleshooting

### Black Screen Checklist
1. Check stderr for `[RDP] endPaint sent frame` - if missing, FreeRDP isn't receiving frames
2. Check main process: is `forwardFrame` called? (add temp `process.stderr.write`)
3. Check preload: does `ipcRenderer.on('rdp:frame')` fire? (add temp stderr write)
4. Check React: does `frameHandler` fire? (add console.log)
5. Check RdpCanvas: does `paint` run? does `canvasRef.current` exist?
6. Verify canvas parent has non-zero CSS dimensions
7. Verify `setWindow()` was called AFTER window creation (Bug 2)

### Pump Loop Issues
- `check_event_handles` failing -> check `freerdp_get_last_error` string
- Infinite error loop -> `consecutiveFailures` counter forces disconnect after 50 failures
- `BIO_should_retry` + `Broken pipe` -> usually caused by mouse flag bug

### IPC Debugging
Add temporary stderr logging to preload:
```typescript
process.stderr.write(`[RDP] preload frame: (${rect.x},${rect.y} ${rect.w}x${rect.h}) ${buf.byteLength}B\n`);
```
Main process stderr goes to terminal; renderer stderr may need `--enable-logging` flag.
