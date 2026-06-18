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

// 3. On Windows, copy FreeRDP DLLs alongside the .node file
if (isWin) {
  const possibleDirs = [
    path.join(process.env.VCPKG_INSTALLATION_ROOT || 'C:/vcpkg', 'installed', 'x64-windows', 'bin'),
    path.join(process.env.USERPROFILE || '', 'vcpkg', 'installed', 'x64-windows', 'bin'),
  ];

  const dlls = ['freerdp2.dll', 'freerdp-client2.dll', 'winpr2.dll', 'winpr-tools2.dll'];

  for (const dir of possibleDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const dll of dlls) {
      const src = path.join(dir, dll);
      if (fs.existsSync(src)) {
        const dest = path.join(outDir, dll);
        fs.copyFileSync(src, dest);
        console.log(`Copied ${dll} to ${outDir}`);
      }
    }
    break;
  }
}

console.log('Native addon build complete.');
