const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';
const ELECTRON_VERSION = '31.7.7';
const srcDir = path.join(__dirname, '..', 'src', 'native', 'rdp-addon');
const buildDir = path.join(srcDir, 'build');
const addonOutDir = path.join(__dirname, '..', 'native', 'rdp-addon', 'build', 'Release');
const addonName = 'rdp_addon.node';

// Get cmake-js include/lib paths by running it in print mode
let cmakeJsBin;
try {
  cmakeJsBin = require.resolve('cmake-js/bin/cmake-js');
} catch {
  console.log('cmake-js not found — skipping');
  process.exit(0);
}

// Download electron headers via cmake-js first
console.log('Fetching Electron headers...');
const fetchResult = spawnSync(process.execPath, [
  cmakeJsBin, 'install',
  '--runtime=electron',
  `--runtime-version=${ELECTRON_VERSION}`,
  '--arch=x64',
], {
  cwd: srcDir,
  stdio: 'inherit',
  env: { ...process.env },
});

if (fetchResult.status !== 0) {
  console.log('Failed to fetch Electron headers — skipping');
  process.exit(1);
}

const cmakeJsHome = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.cmake-js', 'electron-x64', `v${ELECTRON_VERSION}`
);
const nodeInc = path.join(cmakeJsHome, 'include', 'node');
const nodeLib = path.join(cmakeJsHome, 'x64', 'node.lib');
const winDelayHook = path.join(__dirname, '..', 'node_modules', 'cmake-js', 'lib', 'cpp', 'win_delay_load_hook.cc');
const napiDir = path.join(__dirname, '..', 'node_modules', 'node-addon-api');

const vcpkgRoot = process.env.VCPKG_ROOT || process.env.VCPKG_INSTALLATION_ROOT || 'C:\\vcpkg';
const toolchain = path.join(vcpkgRoot, 'scripts', 'buildsystems', 'vcpkg.cmake').replace(/\\/g, '/');

console.log(`Building native addon...`);
console.log(`  Source: ${srcDir}`);
console.log(`  Toolchain: ${toolchain}`);

// Verify toolchain exists
if (!fs.existsSync(toolchain)) {
  console.error(`vcpkg toolchain not found at: ${toolchain}`);
  process.exit(1);
}
console.log(`  Toolchain exists: ${fs.existsSync(toolchain)}`);

// Clear stale build cache
if (fs.existsSync(buildDir)) {
  fs.rmSync(buildDir, { recursive: true, force: true });
}
fs.mkdirSync(buildDir, { recursive: true });

// Verify cmake is available
const cmakeCheck = spawnSync('cmake', ['--version'], { encoding: 'utf8' });
if (cmakeCheck.status !== 0) {
  console.error('cmake not found on PATH');
  process.exit(1);
}
console.log(`  cmake: ${cmakeCheck.stdout.split('\n')[0]}`);

// Diagnostic: check FreeRDP files exist
const freerdpConfigPath = path.join(vcpkgRoot, 'installed', 'x64-windows', 'share', 'freerdp', 'FreeRDPConfig.cmake');
console.log(`  FreeRDP cmake config exists: ${fs.existsSync(freerdpConfigPath)}`);
const freerdpHeader = path.join(vcpkgRoot, 'installed', 'x64-windows', 'include', 'freerdp', 'freerdp.h');
console.log(`  FreeRDP header exists: ${fs.existsSync(freerdpHeader)}`);

// Configure
const configArgs = [
  '-G', 'Visual Studio 18 2026',
  '-A', 'x64',
  `-DCMAKE_TOOLCHAIN_FILE=${toolchain}`,
  `-DVCPKG_TARGET_TRIPLET=x64-windows`,
  `-DVCPKG_INSTALLED_DIR=C:/vcpkg/installed`,
  `-DCMAKE_PREFIX_PATH=C:/vcpkg/installed/x64-windows`,
  `-DCMAKE_BUILD_TYPE=Release`,
  `-DCMAKE_JS_INC=${nodeInc.replace(/\\/g, '/')}`,
  `-DCMAKE_JS_LIB=${nodeLib.replace(/\\/g, '/')}`,
  `-DCMAKE_JS_SRC=${winDelayHook.replace(/\\/g, '/')}`,
  `-DNAPI_DIR=${napiDir.replace(/\\/g, '/')}`,
  `-DNODE_RUNTIME=electron`,
  `-DNODE_RUNTIMEVERSION=${ELECTRON_VERSION}`,
  `-DNODE_ARCH=x64`,
  `-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded`,
  `-DCMAKE_SHARED_LINKER_FLAGS=/DELAYLOAD:NODE.EXE`,
  srcDir,
];
console.log('Running cmake configure...');
console.log(`  Args: ${configArgs.join(' ')}`);

const configResult = spawnSync('cmake', configArgs, {
  cwd: buildDir,
  stdio: 'inherit',
  env: { ...process.env },
});

if (configResult.status !== 0) {
  console.error('cmake configure failed');
  process.exit(1);
}

// Build
const buildResult = spawnSync('cmake', ['--build', '.', '--config', 'Release'], {
  cwd: buildDir,
  stdio: 'inherit',
  env: { ...process.env },
});

if (buildResult.status !== 0) {
  console.error('cmake build failed');
  process.exit(1);
}

// Copy output
fs.mkdirSync(addonOutDir, { recursive: true });
const builtAddon = path.join(buildDir, 'Release', addonName);
if (fs.existsSync(builtAddon)) {
  fs.copyFileSync(builtAddon, path.join(addonOutDir, addonName));
  console.log(`Copied ${addonName} to ${addonOutDir}`);
} else {
  console.error(`Build output not found: ${builtAddon}`);
  process.exit(1);
}

// FreeRDP DLLs
if (isWin) {
  const dlScript = path.join(__dirname, 'download-freerdp.js');
  if (fs.existsSync(dlScript)) {
    spawnSync(process.execPath, [dlScript], {
      stdio: 'inherit',
      env: { ...process.env },
      cwd: path.join(__dirname, '..'),
    });
  }
}

console.log('Native addon build complete.');
