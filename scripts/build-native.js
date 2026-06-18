const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';

const srcDir = path.join(__dirname, '..', 'src', 'native', 'rdp-addon');
const outDir = path.join(__dirname, '..', 'native', 'rdp-addon', 'build', 'Release');
const addonName = 'rdp_addon.node';

// 1. Build with node-gyp
console.log('Building native addon...');
execSync('npx node-gyp rebuild --release', { cwd: srcDir, stdio: 'inherit' });

// 2. Copy .node file to native/ directory
fs.mkdirSync(outDir, { recursive: true });
const builtAddon = path.join(srcDir, 'build', 'Release', addonName);
if (fs.existsSync(builtAddon)) {
  const dest = path.join(outDir, addonName);
  fs.copyFileSync(builtAddon, dest);
  console.log(`Copied ${addonName} to ${dest}`);
} else {
  console.error(`ERROR: Build output not found at ${builtAddon}`);
  process.exit(1);
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
