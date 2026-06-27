import { app } from 'electron';
import path from 'path';
import fs from 'fs';

function initOpenSSLEnv() {
  try {
    if (process.platform !== 'win32') return;

    const addonDir = app.isPackaged
      ? path.join(process.resourcesPath, 'rdp-addon')
      : path.join(__dirname, '..', '..', 'native', 'rdp-addon', 'build', 'Release');

    const osslModulesDir = path.join(addonDir, 'ossl-modules');
    const opensslCnfPath = path.join(addonDir, 'openssl.cnf');

    if (!fs.existsSync(opensslCnfPath)) {
      try {
        fs.mkdirSync(addonDir, { recursive: true });
        fs.writeFileSync(opensslCnfPath, [
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
        ].join('\n'), 'utf-8');
      } catch {}
    }

    // Case-insensitive and normalized path comparison for Windows
    const pathNormalize = (p: string) => path.normalize(p).toLowerCase();
    const normConf = process.env.OPENSSL_CONF ? pathNormalize(process.env.OPENSSL_CONF) : '';
    const normModules = process.env.OPENSSL_MODULES ? pathNormalize(process.env.OPENSSL_MODULES) : '';
    const normAddonDir = pathNormalize(addonDir);
    const normPaths = (process.env.PATH || '').split(';').map(p => pathNormalize(p));

    const isEnvSet = 
      normConf === pathNormalize(opensslCnfPath) &&
      normModules === pathNormalize(osslModulesDir) &&
      normPaths.includes(normAddonDir);

    if (!isEnvSet) {
      process.env.PATH = `${addonDir};${process.env.PATH}`;
      process.env.OPENSSL_MODULES = osslModulesDir;
      process.env.OPENSSL_CONF = opensslCnfPath;

      if (app.isPackaged) {
        // In production, relaunch and exit immediately using detached spawn
        const { spawn } = require('child_process');
        const child = spawn(process.execPath, process.argv.slice(1), {
          env: process.env,
          detached: true,
          stdio: 'ignore'
        });
        child.unref();
        app.exit(0);
      } else {
        // In development, spawn the child process synchronously to block the parent,
        // keeping the concurrently process group alive and piping logs.
        const { spawnSync } = require('child_process');
        spawnSync(process.execPath, process.argv.slice(1), {
          env: process.env,
          stdio: 'inherit'
        });
        app.exit(0);
      }
    }
  } catch {}
}

initOpenSSLEnv();
