const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';
const ELECTRON_VERSION = '31.7.7';

const srcDir = path.join(__dirname, '..', 'src', 'native', 'rdp-addon');
const addonOutDir = path.join(__dirname, '..', 'native', 'rdp-addon', 'build', 'Release');
const addonName = 'rdp_addon.node';

// 1. Find cmake-js
let cmakeJsBin;
try {
  cmakeJsBin = require.resolve('cmake-js/bin/cmake-js');
} catch {
  console.log('cmake-js not found — skipping native addon build');
  process.exit(0);
}

// 2. Build with cmake-js (Electron ABI-aware)
console.log('Building native addon with cmake-js...');
console.log(`  Source: ${srcDir}`);
console.log(`  Target: Electron ${ELECTRON_VERSION}`);

const buildResult = spawnSync(process.execPath, [
  cmakeJsBin, 'compile',
  '--runtime=electron',
  `--runtime-version=${ELECTRON_VERSION}`,
  '--arch=x64',
], {
  cwd: srcDir,
  stdio: 'inherit',
  env: { ...process.env },
});

if (buildResult.error) {
  console.log(`cmake-js spawn error: ${buildResult.error.message} — skipping`);
  process.exit(0);
}
if (buildResult.status !== 0) {
  console.log(`cmake-js exited with code ${buildResult.status} — skipping`);
  process.exit(0);
}

// 3. Copy .node file to native/ output directory
fs.mkdirSync(addonOutDir, { recursive: true });

const builtAddon = path.join(srcDir, 'build', 'Release', addonName);
const fallbackAddon = path.join(srcDir, 'build', addonName);

let addonSource = null;
if (fs.existsSync(builtAddon)) {
  addonSource = builtAddon;
} else if (fs.existsSync(fallbackAddon)) {
  addonSource = fallbackAddon;
}

if (addonSource) {
  const dest = path.join(addonOutDir, addonName);
  fs.copyFileSync(addonSource, dest);
  console.log(`Copied ${addonName} to ${dest}`);
} else {
  console.log(`Build output not found at ${builtAddon} or ${fallbackAddon} — skipping`);
  process.exit(0);
}

// 4. On Windows, download FreeRDP DLLs alongside the .node file
if (isWin) {
  const dlScript = path.join(__dirname, 'download-freerdp.js');
  if (fs.existsSync(dlScript)) {
    const dlResult = spawnSync(process.execPath, [dlScript], {
      stdio: 'inherit',
      env: { ...process.env },
      cwd: path.join(__dirname, '..'),
    });
    if (dlResult.error || dlResult.status !== 0) {
      console.log(`FreeRDP download script exited — continuing without DLLs`);
    }
  } else {
    console.log('download-freerdp.js not found — cannot bundle FreeRDP DLLs');
  }
}

console.log('Native addon build complete.');
