import { safeStorage } from 'electron';
import { spawn } from 'child_process';
import { writeLog } from './logger';

const isWin = process.platform === 'win32';

export class CredentialStore {
  encrypt(password: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption unavailable on this system');
    }
    const encrypted = safeStorage.encryptString(password);
    return encrypted.toString('base64');
  }

  decrypt(encryptedBase64: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Decryption unavailable on this system');
    }
    const buffer = Buffer.from(encryptedBase64, 'base64');
    return safeStorage.decryptString(buffer);
  }

  async injectCredential(
    tunnelId: string,
    tunnelName: string,
    username: string,
    password: string,
    port: number
  ): Promise<void> {
    if (!isWin) {
      writeLog(tunnelId, tunnelName, 'info', 'Credential injection skipped (non-Windows)');
      return;
    }

    return new Promise((resolve, reject) => {
      const target = `TERMSRV/localhost:${port}`;
      const proc = spawn('cmdkey', [
        '/generic:' + target,
        '/user:' + username,
        '/pass:' + password,
      ], {
        stdio: 'pipe',
        windowsHide: true,
      });

      let stderr = '';
      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          writeLog(tunnelId, tunnelName, 'info', `Credentials injected for ${target}`);
          resolve();
        } else {
          writeLog(tunnelId, tunnelName, 'error', `cmdkey failed (code ${code}): ${stderr}`);
          reject(new Error(`cmdkey failed: ${stderr}`));
        }
      });

      proc.on('error', (err) => reject(err));
    });
  }

  async clearCredential(tunnelId: string, tunnelName: string, port: number): Promise<void> {
    if (!isWin) {
      writeLog(tunnelId, tunnelName, 'info', 'Credential clear skipped (non-Windows)');
      return;
    }

    return new Promise((resolve) => {
      const target = `TERMSRV/localhost:${port}`;
      const proc = spawn('cmdkey', ['/delete:' + target], {
        stdio: 'pipe',
        windowsHide: true,
      });

      proc.on('close', () => {
        writeLog(tunnelId, tunnelName, 'info', `Cleared credential for ${target}`);
        resolve();
      });

      proc.on('error', () => resolve());
    });
  }

  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }
}

export const credentialStore = new CredentialStore();
