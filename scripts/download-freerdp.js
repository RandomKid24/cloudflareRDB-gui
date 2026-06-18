const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createWriteStream, existsSync, mkdirSync, readdirSync } = require('fs');

const DLLS = ['freerdp2.dll', 'freerdp-client2.dll', 'winpr2.dll', 'winpr-tools2.dll'];
const outDir = path.join(__dirname, '..', 'native', 'rdp-addon', 'build', 'Release');
const tmpDir = path.join(__dirname, '..', 'tmp', 'freerdp-dl');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'TunnelGate/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetch(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function getLatestRelease() {
  const url = 'https://api.github.com/repos/FreeRDP/FreeRDP/releases/latest';
  const data = await fetch(url);
  const release = JSON.parse(data.toString());
  return release.tag_name;
}

async function downloadAndExtract(tag) {
  const zipUrl = `https://github.com/FreeRDP/FreeRDP/releases/download/${tag}/freerdp-${tag.replace(/^v/, '')}-windows-x64.zip`;

  console.log(`Downloading FreeRDP from ${zipUrl}...`);

  let zipData;
  try {
    zipData = await fetch(zipUrl);
  } catch {
    console.log(`Failed to download from ${zipUrl}, trying alternate URL pattern...`);
    const altUrl = `https://github.com/FreeRDP/FreeRDP/releases/download/${tag}/freerdp-${tag}-windows-x64.zip`;
    try {
      zipData = await fetch(altUrl);
    } catch {
      console.log(`Failed to download from ${altUrl} either — will skip DLL bundling`);
      return false;
    }
  }

  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  const zipPath = path.join(tmpDir, 'freerdp.zip');
  fs.writeFileSync(zipPath, zipData);

  const result = spawnSync('unzip', ['-o', zipPath, '-d', tmpDir], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.log('unzip failed — trying to use tar or 7z...');
    const result2 = spawnSync('tar', ['-xf', zipPath, '-C', tmpDir], { stdio: 'inherit' });
    if (result2.status !== 0) {
      console.log('Failed to extract zip — will skip DLL bundling');
      return false;
    }
  }

  // Find and copy DLLs
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  }
  walk(tmpDir);

  mkdirSync(outDir, { recursive: true });

  let found = 0;
  for (const file of files) {
    const name = path.basename(file).toLowerCase();
    if (DLLS.map(d => d.toLowerCase()).includes(name)) {
      const dest = path.join(outDir, path.basename(file));
      fs.copyFileSync(file, dest);
      console.log(`Copied ${path.basename(file)} to ${outDir}`);
      found++;
    }
  }

  // Also copy OpenSSL DLLs that FreeRDP depends on
  for (const file of files) {
    const name = path.basename(file).toLowerCase();
    if (/^(libcrypto|libssl|zlib|ssl|crypto)/.test(name) && name.endsWith('.dll')) {
      const dest = path.join(outDir, path.basename(file));
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(file, dest);
        console.log(`Copied dependency ${path.basename(file)}`);
      }
    }
  }

  fs.rmSync(tmpDir, { recursive: true });

  if (found === 0) {
    console.log('No FreeRDP DLLs found in the downloaded package — will skip');
    return false;
  }

  console.log(`Downloaded and extracted ${found} FreeRDP DLLs`);
  return true;
}

async function main() {
  try {
    const tag = await getLatestRelease();
    console.log(`Latest FreeRDP release: ${tag}`);
    const ok = await downloadAndExtract(tag);
    if (ok) {
      console.log('FreeRDP DLLs ready.');
    } else {
      console.log('FreeRDP DLL download failed — native addon will not have DLLs bundled');
      process.exit(0);
    }
  } catch (err) {
    console.log(`FreeRDP download failed: ${err.message} — continuing without DLLs`);
    process.exit(0);
  }
}

main();
