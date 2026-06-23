import { useState, useEffect, useCallback, useRef } from 'react';
import { LogEntry } from '../../shared/types';

export function useLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const ringRef = useRef<LogEntry[]>([]);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<LogEntry[]>([]);

  const flush = useCallback(() => {
    if (pendingRef.current.length > 0) {
      const batch = pendingRef.current;
      pendingRef.current = [];
      ringRef.current = [...ringRef.current, ...batch].slice(-500);
      setLogs(ringRef.current);
    }
    rafRef.current = null;
  }, []);

  useEffect(() => {
    // Fetch historical logs on mount
    window.cloudflareRdp.tunnels.getLogs()
      .then((history) => {
        ringRef.current = history;
        setLogs(history);
      })
      .catch((err) => {
        console.error('Failed to fetch historical logs:', err);
      });

    const unsub = window.cloudflareRdp.tunnels.onLog((entry) => {
      const fullEntry: LogEntry = {
        ...entry,
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      };
      pendingRef.current.push(fullEntry);

      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(flush);
      }
    });
    return () => {
      unsub();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [flush]);

  const exportLogs = useCallback(async (tunnelId?: string) => {
    await window.cloudflareRdp.tunnels.exportLogs(tunnelId);
  }, []);

  return { logs, autoScroll, setAutoScroll, exportLogs };
}
