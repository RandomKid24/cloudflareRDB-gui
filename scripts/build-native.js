const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const ELECTRON_VERSION = '31.7.7';
const srcDir = path.resolve(__dirname, '..', 'src', 'native', 'rdp-addon');
const buildDir = path.join(srcDir, 'build');
const addonOutDir = path.resolve(__dirname, '..', 'native', 'rdp-addon', 'build', 'Release');
const addonName = 'rdp_addon.node';

// Locate cmake-js
let cmakeJsBin;
try {
  cmakeJsBin = require.resolve('cmake-js/bin/cmake-js');
} catch {
  console.log('cmake-js not found — skipping');
  process.exit(0);
}

// Download Electron headers
console.log('Fetching Electron headers...');
{
  const arch = isMac ? 'arm64' : 'x64';
  const r = spawnSync(process.execPath, [
    cmakeJsBin, 'install',
    '--runtime=electron',
    `--runtime-version=${ELECTRON_VERSION}`,
    `--arch=${arch}`,
  ], { cwd: srcDir, stdio: 'inherit', env: { ...process.env } });
  if (r.status !== 0) {
    console.log('Failed to fetch Electron headers — skipping');
    process.exit(1);
  }
}

const cmakeJsHome = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.cmake-js', `electron-${isMac ? 'arm64' : 'x64'}`, `v${ELECTRON_VERSION}`
);
const nodeInc = path.join(cmakeJsHome, 'include', 'node');
const napiDir = path.resolve(__dirname, '..', 'node_modules', 'node-addon-api');

// Clear stale build
if (fs.existsSync(buildDir)) {
  fs.rmSync(buildDir, { recursive: true, force: true });
}
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(addonOutDir, { recursive: true });

// Verify cmake
{
  const r = spawnSync('cmake', ['--version'], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('cmake not found on PATH');
    process.exit(1);
  }
  console.log(`  cmake: ${r.stdout.split('\n')[0]}`);
}

// Detect the actual installed Visual Studio generator for CMake using vswhere
function detectVsGenerator() {
  const vswhere = path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe'
  );
  if (fs.existsSync(vswhere)) {
    const r = spawnSync(vswhere, [
      '-latest',
      '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property', 'catalog_productLineVersion'
    ], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) {
      const year = r.stdout.trim();
      const versionMap = { '2026': '18', '2025': '18', '2022': '17', '2019': '16', '2017': '15' };
      const version = versionMap[year];
      if (version) {
        const generator = `Visual Studio ${version} ${year}`;
        console.log(`  Detected VS generator: ${generator}`);
        return generator;
      }
    }
  }
  // Fallback to cmake-js style detection — try cmake --help but filter by actual registry
  console.warn('  vswhere not available — falling back to Visual Studio 17 2022');
  return 'Visual Studio 17 2022';
}

// ---------------------------------------------------------------
// Determine FreeRDP root (shared between cmake config and dylib copy)
// ---------------------------------------------------------------
let platformFreerdpRoot = process.env.FREERDP_ROOT;

if (isWin) {
  // ---- Windows: vcpkg + Visual Studio ----
  const vcpkgRoot = process.env.VCPKG_ROOT || process.env.VCPKG_INSTALLATION_ROOT || 'C:\\vcpkg';
  const freerdpRoot = platformFreerdpRoot || path.join(vcpkgRoot, 'installed', 'x64-windows');
  const toolchain = path.join(vcpkgRoot, 'scripts', 'buildsystems', 'vcpkg.cmake').replace(/\\/g, '/');
  const nodeLib = path.join(cmakeJsHome, 'x64', 'node.lib');
  const winDelayHook = path.resolve(__dirname, '..', 'node_modules', 'cmake-js', 'lib', 'cpp', 'win_delay_load_hook.cc');

  if (!fs.existsSync(toolchain)) {
    console.error(`vcpkg toolchain not found at: ${toolchain}`);
    process.exit(1);
  }

  configArgs = [
    '-G', detectVsGenerator(),
    '-A', 'x64',
    `-DCMAKE_TOOLCHAIN_FILE=${toolchain}`,
    `-DVCPKG_TARGET_TRIPLET=x64-windows`,
    `-DFREERDP_ROOT=${freerdpRoot.replace(/\\/g, '/')}`,
    `-DCMAKE_BUILD_TYPE=Release`,
    `-DCMAKE_JS_INC=${nodeInc.replace(/\\/g, '/')}`,
    `-DCMAKE_JS_LIB=${nodeLib.replace(/\\/g, '/')}`,
    `-DCMAKE_JS_SRC=${winDelayHook.replace(/\\/g, '/')}`,
    `-DNAPI_DIR=${napiDir.replace(/\\/g, '/')}`,
    `-DNODE_RUNTIME=electron`,
    `-DNODE_RUNTIMEVERSION=${ELECTRON_VERSION}`,
    `-DNODE_ARCH=x64`,
    `-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDLL`,
    `-DCMAKE_SHARED_LINKER_FLAGS=/DELAYLOAD:NODE.EXE`,
    srcDir,
  ];

} else if (isMac) {
  // ---- macOS: Homebrew FreeRDP ----
  if (!platformFreerdpRoot) {
    const brewResult = spawnSync('brew', ['--prefix', 'freerdp'], { encoding: 'utf8' });
    if (brewResult.status === 0) {
      platformFreerdpRoot = brewResult.stdout.trim();
    } else {
      platformFreerdpRoot = '/usr/local/opt/freerdp';
    }
  }
  if (!fs.existsSync(path.join(platformFreerdpRoot, 'include', 'freerdp2', 'freerdp', 'freerdp.h')) &&
      !fs.existsSync(path.join(platformFreerdpRoot, 'include', 'freerdp3', 'freerdp', 'freerdp.h')) &&
      !fs.existsSync(path.join(platformFreerdpRoot, 'include', 'freerdp', 'freerdp.h'))) {
    console.error(`FreeRDP not found at ${platformFreerdpRoot}. Install with: brew install freerdp`);
    process.exit(1);
  }

  configArgs = [
    '-DCMAKE_BUILD_TYPE=Release',
    '-DCMAKE_OSX_ARCHITECTURES=arm64',
    `-DFREERDP_ROOT=${platformFreerdpRoot}`,
    `-DCMAKE_JS_INC=${nodeInc}`,
    `-DNAPI_DIR=${napiDir}`,
    `-DCMAKE_SHARED_LINKER_FLAGS=-undefined dynamic_lookup`,
    `-DNODE_RUNTIME=electron`,
    `-DNODE_RUNTIMEVERSION=${ELECTRON_VERSION}`,
    srcDir,
  ];

} else {
  // ---- Linux: system FreeRDP (apt) ----
  if (!platformFreerdpRoot) {
    platformFreerdpRoot = '/usr';
  }
  if (!fs.existsSync('/usr/include/freerdp2/freerdp/freerdp.h') &&
      !fs.existsSync('/usr/include/freerdp/freerdp.h')) {
    console.error('FreeRDP headers not found. Install with: sudo apt-get install freerdp2-dev');
    process.exit(1);
  }

  configArgs = [
    '-DCMAKE_BUILD_TYPE=Release',
    `-DFREERDP_ROOT=${platformFreerdpRoot}`,
    `-DCMAKE_JS_INC=${nodeInc}`,
    `-DNAPI_DIR=${napiDir}`,
    `-DCMAKE_SHARED_LINKER_FLAGS=-Wl,--unresolved-symbols=ignore-all`,
    `-DNODE_RUNTIME=electron`,
    `-DNODE_RUNTIMEVERSION=${ELECTRON_VERSION}`,
    `-DNODE_ARCH=x64`,
    srcDir,
  ];
}

console.log('Running cmake configure...');
{
  const r = spawnSync('cmake', configArgs, { cwd: buildDir, stdio: 'inherit', env: { ...process.env } });
  if (r.status !== 0) {
    console.error('cmake configure failed');
    process.exit(1);
  }
}

// Build
console.log('Running cmake build...');
{
  const r = spawnSync('cmake', ['--build', '.', '--config', 'Release'], { cwd: buildDir, stdio: 'inherit', env: { ...process.env } });
  if (r.status !== 0) {
    console.error('cmake build failed');
    process.exit(1);
  }
}

// Locate and copy the built addon
const builtAddon = path.join(buildDir, 'Release', addonName);
const builtAddonAlt = path.join(buildDir, addonName);
const srcFile = fs.existsSync(builtAddon) ? builtAddon : (fs.existsSync(builtAddonAlt) ? builtAddonAlt : null);
if (!srcFile) {
  console.error(`Build output not found in ${buildDir}`);
  process.exit(1);
}
fs.copyFileSync(srcFile, path.join(addonOutDir, addonName));
console.log(`Copied ${addonName} to ${addonOutDir}`);

// FreeRDP shared libraries — copy alongside the addon
if (isWin) {
  const freerdpRoot = process.env.FREERDP_ROOT || path.join(
    process.env.VCPKG_ROOT || process.env.VCPKG_INSTALLATION_ROOT || 'C:\\vcpkg',
    'installed', 'x64-windows'
  );
  const binDir = path.join(freerdpRoot, 'bin');
  const dlls = ['freerdp2.dll', 'freerdp-client2.dll', 'winpr2.dll'];
  for (const dll of dlls) {
    const p = path.join(binDir, dll);
    if (fs.existsSync(p)) {
      fs.copyFileSync(p, path.join(addonOutDir, dll));
      console.log(`  Copied ${dll}`);
    } else {
      console.warn(`  Warning: ${dll} not found in ${binDir}`);
    }
  }
  const deps = ['libcrypto-3-x64.dll', 'libssl-3-x64.dll', 'zlib1.dll'];
  for (const dll of deps) {
    const p = path.join(binDir, dll);
    if (fs.existsSync(p)) {
      fs.copyFileSync(p, path.join(addonOutDir, dll));
      console.log(`  Copied dependency ${dll}`);
    }
  }
  // OpenSSL 3.x loads providers from <dll_dir>/ossl-modules/ by default,
  // but we also set OPENSSL_MODULES=addonDir at runtime, so copy to both locations.
  const osslModulesDir = path.join(addonOutDir, 'ossl-modules');
  fs.mkdirSync(osslModulesDir, { recursive: true });
  const legacyPaths = [
    path.join(binDir, 'ossl-modules', 'legacy.dll'),
    path.join(freerdpRoot, 'lib', 'ossl-modules', 'legacy.dll'),
    path.join(binDir, 'legacy.dll'),
  ];
  let legacyCopied = false;
  for (const lp of legacyPaths) {
    if (fs.existsSync(lp)) {
      // Copy to flat dir (for OPENSSL_MODULES=addonDir at runtime)
      fs.copyFileSync(lp, path.join(addonOutDir, 'legacy.dll'));
      // Also copy to ossl-modules/ subdirectory (default OpenSSL 3.x provider path)
      fs.copyFileSync(lp, path.join(osslModulesDir, 'legacy.dll'));
      console.log(`  Copied legacy provider ${lp} -> legacy.dll + ossl-modules/legacy.dll`);
      legacyCopied = true;
      break;
    }
  }
  if (!legacyCopied) {
    console.warn('  WARNING: legacy.dll not found — NTLM/NLA will fail on NTLM-only servers!');
  }

  // Write OpenSSL config to auto-load the legacy provider (needed for RC4 during RDP licensing)
  const opensslCnf = [
    'openssl_conf = openssl_init',
    '',
    '[openssl_init]',
    'providers = provider_sect',
    '',
    '[provider_sect]',
    'default = default_sect',
    'legacy = legacy_sect',
    '',
    '[default_sect]',
    'activate = 1',
    '',
    '[legacy_sect]',
    'activate = 1',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(addonOutDir, 'openssl.cnf'), opensslCnf, 'utf-8');
  console.log('  Wrote openssl.cnf');
}

if (isMac) {
  // Copy FreeRDP dylibs alongside the addon, fix rpath to use @loader_path
  if (platformFreerdpRoot) {
    const libDir = path.join(platformFreerdpRoot, 'lib');
    // Try FreeRDP 3 names first, fall back to FreeRDP 2
    const dylibCandidates = [
      ['libfreerdp3.3.dylib', 'libfreerdp-client3.3.dylib', 'libwinpr3.3.dylib'],
      ['libfreerdp2.2.dylib', 'libfreerdp-client2.2.dylib', 'libwinpr2.2.dylib'],
    ];
    let dylibs;
    for (const candidate of dylibCandidates) {
      if (candidate.every(d => fs.existsSync(path.join(libDir, d)))) {
        dylibs = candidate;
        break;
      }
    }
    if (!dylibs) {
      // fall back to realpath-based detection
      const found = [];
      for (const d of fs.readdirSync(libDir)) {
        if (d.endsWith('.dylib') && (d.startsWith('libfreerdp') || d.startsWith('libwinpr'))) {
          found.push(d);
        }
      }
      if (found.length > 0) {
        dylibs = found;
        console.warn(`  Guessing dylibs from lib dir: ${found.join(', ')}`);
      } else {
        console.error('  No FreeRDP dylibs found in ' + libDir);
        process.exit(1);
      }
    }
    // Copy FreeRDP dylibs
    for (const dylib of dylibs) {
      const src = path.join(libDir, dylib);
      if (fs.existsSync(src)) {
        const dest = path.join(addonOutDir, dylib);
        fs.copyFileSync(src, dest);
        fs.chmodSync(dest, 0o755);
        console.log(`  Copied ${dylib}`);
        spawnSync('install_name_tool', ['-id', `@loader_path/${dylib}`, dest], { stdio: 'ignore' });
      } else {
        console.warn(`  Warning: ${dylib} not found in ${libDir}`);
      }
    }
    // Fix all @rpath references in dylibs to use @loader_path
    const addonPath = path.join(addonOutDir, addonName);
    const frpDylibPaths = dylibs.map(d => path.join(addonOutDir, d));
    let allLibs = [...frpDylibPaths, addonPath];
    for (const lib of allLibs) {
      if (!fs.existsSync(lib)) continue;
      const result = spawnSync('otool', ['-L', lib], { encoding: 'utf8' });
      if (result.status !== 0) continue;
      for (const line of result.stdout.split('\n')) {
        const m = line.match(/^\t(@rpath\/\S+)/);
        if (m) {
          const oldPath = m[1];
          const basename = path.basename(oldPath);
          const newPath = `@loader_path/${basename}`;
          spawnSync('install_name_tool', ['-change', oldPath, newPath, lib], { stdio: 'ignore' });
        }
      }
    }
    // Recursively resolve transitive dylib dependencies
    const copiedTransitive = [];
    const seen = new Set(dylibs.map(d => path.basename(d)));
    const queue = [...dylibs.map(d => path.join(addonOutDir, d)), path.join(addonOutDir, addonName)];
    while (queue.length > 0) {
      const lib = queue.shift();
      if (!fs.existsSync(lib)) continue;
      const result = spawnSync('otool', ['-L', lib], { encoding: 'utf8' });
      if (result.status !== 0) continue;
      for (const line of result.stdout.split('\n')) {
        const m = line.match(/^\t\s*(\/.+\.dylib)\s/);
        if (!m) continue;
        const depPath = m[1];
        if (depPath.includes('/usr/') || depPath.includes('/System/')) continue;
        const basename = path.basename(depPath);
        if (seen.has(basename)) continue;
        seen.add(basename);
        const dest = path.join(addonOutDir, basename);
        if (!fs.existsSync(dest)) {
          try {
            fs.copyFileSync(depPath, dest);
            fs.chmodSync(dest, 0o755);
            console.log(`  Copied transitive dep ${basename}`);
            spawnSync('install_name_tool', ['-id', `@loader_path/${basename}`, dest], { stdio: 'ignore' });
            copiedTransitive.push(dest);
            queue.push(dest);
          } catch (e) {
            console.warn(`  Warning: failed to copy ${basename}: ${e.message}`);
          }
        }
      }
    }
    // Fix all absolute path references in every copied library and the addon
    allLibs = [...frpDylibPaths, addonPath, ...copiedTransitive];
    for (const lib of allLibs) {
      if (!fs.existsSync(lib)) continue;
      const result = spawnSync('otool', ['-L', lib], { encoding: 'utf8' });
      if (result.status !== 0) continue;
      for (const line of result.stdout.split('\n')) {
        const m = line.match(/^\t\s*(\/.+\.dylib)\s/);
        if (m) {
          const absPath = m[1];
          if (absPath.includes('/usr/') || absPath.includes('/System/')) continue;
          const basename = path.basename(absPath);
          if (basename === path.basename(lib)) continue;
          const replacement = `@loader_path/${basename}`;
          spawnSync('install_name_tool', ['-change', absPath, replacement, lib], { stdio: 'ignore' });
        }
      }
    }
    console.log('  Updated dylib install names and rpaths');
    // Ad-hoc sign all dylibs so macOS doesn't kill the process on hardened runtime
    allLibs = [...frpDylibPaths, addonPath, ...copiedTransitive];
    for (const lib of allLibs) {
      if (!fs.existsSync(lib)) continue;
      spawnSync('codesign', ['--force', '--sign', '-', lib], { stdio: 'ignore' });
    }
    console.log('  Ad-hoc signed all dylibs');
  }
}

console.log('Native addon build complete.');
