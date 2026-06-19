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
  const r = spawnSync(process.execPath, [
    cmakeJsBin, 'install',
    '--runtime=electron',
    `--runtime-version=${ELECTRON_VERSION}`,
    '--arch=x64',
  ], { cwd: srcDir, stdio: 'inherit', env: { ...process.env } });
  if (r.status !== 0) {
    console.log('Failed to fetch Electron headers — skipping');
    process.exit(1);
  }
}

const cmakeJsHome = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.cmake-js', 'electron-x64', `v${ELECTRON_VERSION}`
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

// ---------------------------------------------------------------
// Platform-specific cmake configuration
// ---------------------------------------------------------------
let configArgs;

if (isWin) {
  // ---- Windows: vcpkg + Visual Studio ----
  const vcpkgRoot = process.env.VCPKG_ROOT || process.env.VCPKG_INSTALLATION_ROOT || 'C:\\vcpkg';
  const freerdpRoot = process.env.FREERDP_ROOT || path.join(vcpkgRoot, 'installed', 'x64-windows');
  const toolchain = path.join(vcpkgRoot, 'scripts', 'buildsystems', 'vcpkg.cmake').replace(/\\/g, '/');
  const nodeLib = path.join(cmakeJsHome, 'x64', 'node.lib');
  const winDelayHook = path.resolve(__dirname, '..', 'node_modules', 'cmake-js', 'lib', 'cpp', 'win_delay_load_hook.cc');

  if (!fs.existsSync(toolchain)) {
    console.error(`vcpkg toolchain not found at: ${toolchain}`);
    process.exit(1);
  }

  configArgs = [
    '-G', 'Visual Studio 18 2026',
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
    `-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded`,
    `-DCMAKE_SHARED_LINKER_FLAGS=/DELAYLOAD:NODE.EXE`,
    srcDir,
  ];

} else if (isMac) {
  // ---- macOS: Homebrew FreeRDP ----
  let freerdpRoot = process.env.FREERDP_ROOT;
  if (!freerdpRoot) {
    freerdpRoot = '/usr/local/opt/freerdp';
    const brewResult = spawnSync('brew', ['--prefix', 'freerdp'], { encoding: 'utf8' });
    if (brewResult.status === 0) {
      freerdpRoot = brewResult.stdout.trim();
    }
  }
  if (!fs.existsSync(path.join(freerdpRoot, 'include', 'freerdp2', 'freerdp', 'freerdp.h')) &&
      !fs.existsSync(path.join(freerdpRoot, 'include', 'freerdp', 'freerdp.h'))) {
    console.error(`FreeRDP not found at ${freerdpRoot}. Install with: brew install freerdp`);
    process.exit(1);
  }

  configArgs = [
    '-DCMAKE_BUILD_TYPE=Release',
    `-DFREERDP_ROOT=${freerdpRoot}`,
    `-DCMAKE_JS_INC=${nodeInc}`,
    `-DNAPI_DIR=${napiDir}`,
    `-DCMAKE_SHARED_LINKER_FLAGS=-undefined dynamic_lookup`,
    `-DNODE_RUNTIME=electron`,
    `-DNODE_RUNTIMEVERSION=${ELECTRON_VERSION}`,
    `-DNODE_ARCH=x64`,
    srcDir,
  ];

} else {
  // ---- Linux: system FreeRDP (apt) ----
  const freerdpRoot = process.env.FREERDP_ROOT || '/usr';
  if (!fs.existsSync('/usr/include/freerdp2/freerdp/freerdp.h') &&
      !fs.existsSync('/usr/include/freerdp/freerdp.h')) {
    console.error('FreeRDP headers not found. Install with: sudo apt-get install freerdp2-dev');
    process.exit(1);
  }

  configArgs = [
    '-DCMAKE_BUILD_TYPE=Release',
    `-DFREERDP_ROOT=${freerdpRoot}`,
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
}

if (isMac) {
  // Copy FreeRDP dylibs alongside the addon, fix rpath to use @loader_path
  const freerdpRoot = process.env.FREERDP_ROOT;
  if (freerdpRoot) {
    const libDir = path.join(freerdpRoot, 'lib');
    const dylibs = ['libfreerdp2.2.dylib', 'libfreerdp-client2.2.dylib', 'libwinpr2.2.dylib'];
    // Copy FreeRDP dylibs
    for (const dylib of dylibs) {
      const src = path.join(libDir, dylib);
      if (fs.existsSync(src)) {
        const dest = path.join(addonOutDir, dylib);
        fs.copyFileSync(src, dest);
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
    // Copy transitive deps (openssl, etc.) from their current paths
    const transitiveDeps = new Set();
    for (const dylib of dylibs) {
      const p = path.join(addonOutDir, dylib);
      if (!fs.existsSync(p)) continue;
      const result = spawnSync('otool', ['-L', p], { encoding: 'utf8' });
      if (result.status !== 0) continue;
      for (const line of result.stdout.split('\n')) {
        const m = line.match(/^\t(\/.+\.dylib)\s/);
        if (m) {
          const dep = m[1];
          if (dep.includes('/usr/') || dep.includes('/System/')) continue;
          if (dylibs.some(d => dep.includes(d))) continue;
          transitiveDeps.add(dep);
        }
      }
    }
    const copiedTransitive = [];
    for (const dep of transitiveDeps) {
      const basename = path.basename(dep);
      const dest = path.join(addonOutDir, basename);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(dep, dest);
        console.log(`  Copied transitive dep ${basename}`);
        spawnSync('install_name_tool', ['-id', `@loader_path/${basename}`, dest], { stdio: 'ignore' });
        copiedTransitive.push(dest);
        // Also check THIS transitive dep for its own deps
        const depResult = spawnSync('otool', ['-L', dest], { encoding: 'utf8' });
        if (depResult.status === 0) {
          for (const line of depResult.stdout.split('\n')) {
            const m = line.match(/^\t(\/.+\.dylib)\s/);
            if (m) {
              const subdep = m[1];
              if (subdep.includes('/usr/') || subdep.includes('/System/')) continue;
              if (dylibs.some(d => subdep.includes(d))) continue;
              if (!transitiveDeps.has(subdep) && subdep !== dep) {
                const subBase = path.basename(subdep);
                const subDest = path.join(addonOutDir, subBase);
                if (!fs.existsSync(subDest)) {
                  fs.copyFileSync(subdep, subDest);
                  console.log(`  Copied nested dep ${subBase}`);
                  spawnSync('install_name_tool', ['-id', `@loader_path/${subBase}`, subDest], { stdio: 'ignore' });
                  copiedTransitive.push(subDest);
                }
                transitiveDeps.add(subdep);
              }
            }
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
  }
}

console.log('Native addon build complete.');
