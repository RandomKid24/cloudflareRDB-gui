import log from 'electron-log';
import { LogEntry } from '../shared/types';
import { v4 as uuidv4 } from 'uuid';

const MAX_RING_BUFFER = 500;
const logRingBuffer: LogEntry[] = [];

log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : false;

export function writeLog(
  tunnelId: string,
  tunnelName: string,
  level: LogEntry['level'],
  message: string
): void {
  const entry: LogEntry = {
    id: uuidv4(),
    tunnelId,
    tunnelName,
    timestamp: new Date().toISOString(),
    level,
    message: scrubCredentials(message),
  };

  logRingBuffer.push(entry);
  if (logRingBuffer.length > MAX_RING_BUFFER) {
    logRingBuffer.shift();
  }

  const logFn = level === 'error' ? log.error : level === 'warn' ? log.warn : level === 'debug' ? log.debug : log.info;
  logFn(`[${tunnelName}] ${message}`);
}

function scrubCredentials(msg: string): string {
  return msg.replace(/(password|pass|pwd)[=:]\s*\S+/gi, '$1=***');
}

export function getLogs(tunnelId?: string): LogEntry[] {
  if (tunnelId) {
    return logRingBuffer.filter((e) => e.tunnelId === tunnelId);
  }
  return [...logRingBuffer];
}

export function getCombinedLogs(): LogEntry[] {
  return [...logRingBuffer];
}

export function clearLogs(): void {
  logRingBuffer.length = 0;
}
