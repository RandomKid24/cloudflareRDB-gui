const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';

const srcDir = path.join(__dirname, '..', 'src', 'native', 'rdp-addon');
const outDir = path.join(__dirname, '..', 'native', 'rdp-addon', 'build', 'Release');
const addonName = 'rdp_addon.node';

// 1. Build with node-gyp (no shell — avoid /bin/sh dependency)
console.log('Building native addon...');

let nodeGypBin;
try {
  nodeGypBin = require.resolve('node-gyp/bin/node-gyp.js');
} catch {
  console.log('node-gyp not found — skipping native addon build');
  process.exit(0);
}

const result = spawnSync(process.execPath, [nodeGypBin, 'rebuild', '--release'], {
  cwd: srcDir,
  stdio: 'inherit',
  env: { ...process.env },
});

if (result.error) {
  console.log(`node-gyp spawn error: ${result.error.message} — skipping native addon build`);
  process.exit(0);
}
if (result.status !== 0) {
  console.log(`node-gyp exited with code ${result.status} — skipping native addon build`);
  process.exit(0);
}

// 2. Copy .node file to native/ directory
fs.mkdirSync(outDir, { recursive: true });
const builtAddon = path.join(srcDir, 'build', 'Release', addonName);
if (fs.existsSync(builtAddon)) {
  const dest = path.join(outDir, addonName);
  fs.copyFileSync(builtAddon, dest);
  console.log(`Copied ${addonName} to ${dest}`);
} else {
  console.log(`Build output not found at ${builtAddon} — skipping`);
  process.exit(0);
}

// 3. On Windows, download FreeRDP DLLs (fast) instead of building from vcpkg (slow)
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
