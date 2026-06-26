import React, { useRef, useEffect, useCallback } from 'react';

interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
  data: ArrayBuffer;
}

interface Props {
  tunnelId: string;
  width: number;
  height: number;
  connected: boolean;
}

// RDP Slow-Path Pointer Event flags (MS-RDPBCGR 2.2.8.1.1.3.1.1.3)
const PTR_FLAGS_MOVE = 0x0800;
const PTR_FLAGS_DOWN = 0x8000;
const PTR_FLAGS_BUTTON1 = 0x1000;
const PTR_FLAGS_BUTTON2 = 0x2000;
const PTR_FLAGS_BUTTON3 = 0x4000;
const PTR_FLAGS_WHEEL = 0x0200;
const PTR_FLAGS_WHEEL_NEGATIVE = 0x0100;

function buttonToDownFlag(button: number): number {
  if (button === 2) return PTR_FLAGS_BUTTON2 | PTR_FLAGS_DOWN;
  if (button === 1) return PTR_FLAGS_BUTTON3 | PTR_FLAGS_DOWN;
  return PTR_FLAGS_BUTTON1 | PTR_FLAGS_DOWN;
}

function buttonToUpFlag(button: number): number {
  if (button === 2) return PTR_FLAGS_BUTTON2;
  if (button === 1) return PTR_FLAGS_BUTTON3;
  return PTR_FLAGS_BUTTON1;
}

const KEY_TO_SCANCODE: Record<string, { code: number; extended?: boolean }> = {
  Escape: { code: 0x01 },
  F1: { code: 0x3b },
  F2: { code: 0x3c },
  F3: { code: 0x3d },
  F4: { code: 0x3e },
  F5: { code: 0x3f },
  F6: { code: 0x40 },
  F7: { code: 0x41 },
  F8: { code: 0x42 },
  F9: { code: 0x43 },
  F10: { code: 0x44 },
  F11: { code: 0x57 },
  F12: { code: 0x58 },
  Backquote: { code: 0x29 },
  Digit1: { code: 0x02 },
  Digit2: { code: 0x03 },
  Digit3: { code: 0x04 },
  Digit4: { code: 0x05 },
  Digit5: { code: 0x06 },
  Digit6: { code: 0x07 },
  Digit7: { code: 0x08 },
  Digit8: { code: 0x09 },
  Digit9: { code: 0x0a },
  Digit0: { code: 0x0b },
  Minus: { code: 0x0c },
  Equal: { code: 0x0d },
  Backspace: { code: 0x0e },
  Tab: { code: 0x0f },
  KeyQ: { code: 0x10 },
  KeyW: { code: 0x11 },
  KeyE: { code: 0x12 },
  KeyR: { code: 0x13 },
  KeyT: { code: 0x14 },
  KeyY: { code: 0x15 },
  KeyU: { code: 0x16 },
  KeyI: { code: 0x17 },
  KeyO: { code: 0x18 },
  KeyP: { code: 0x19 },
  BracketLeft: { code: 0x1a },
  BracketRight: { code: 0x1b },
  Backslash: { code: 0x2b },
  CapsLock: { code: 0x3a },
  KeyA: { code: 0x1e },
  KeyS: { code: 0x1f },
  KeyD: { code: 0x20 },
  KeyF: { code: 0x21 },
  KeyG: { code: 0x22 },
  KeyH: { code: 0x23 },
  KeyJ: { code: 0x24 },
  KeyK: { code: 0x25 },
  KeyL: { code: 0x26 },
  Semicolon: { code: 0x27 },
  Quote: { code: 0x28 },
  Enter: { code: 0x1c },
  ShiftLeft: { code: 0x2a },
  KeyZ: { code: 0x2c },
  KeyX: { code: 0x2d },
  KeyC: { code: 0x2e },
  KeyV: { code: 0x2f },
  KeyB: { code: 0x30 },
  KeyN: { code: 0x31 },
  KeyM: { code: 0x32 },
  Comma: { code: 0x33 },
  Period: { code: 0x34 },
  Slash: { code: 0x35 },
  ShiftRight: { code: 0x36 },
  ControlLeft: { code: 0x1d },
  MetaLeft: { code: 0x5b, extended: true },
  AltLeft: { code: 0x38 },
  Space: { code: 0x39 },
  AltRight: { code: 0x38, extended: true },
  MetaRight: { code: 0x5c, extended: true },
  ContextMenu: { code: 0x5d, extended: true },
  ControlRight: { code: 0x1d, extended: true },
  Insert: { code: 0x52, extended: true },
  Delete: { code: 0x53, extended: true },
  Home: { code: 0x47, extended: true },
  End: { code: 0x4f, extended: true },
  PageUp: { code: 0x49, extended: true },
  PageDown: { code: 0x51, extended: true },
  ArrowUp: { code: 0x48, extended: true },
  ArrowLeft: { code: 0x4b, extended: true },
  ArrowDown: { code: 0x50, extended: true },
  ArrowRight: { code: 0x4d, extended: true },
  NumLock: { code: 0x45 },
  Numpad7: { code: 0x47 },
  Numpad8: { code: 0x48 },
  Numpad9: { code: 0x49 },
  NumpadSubtract: { code: 0x4a },
  Numpad4: { code: 0x4b },
  Numpad5: { code: 0x4c },
  Numpad6: { code: 0x4d },
  NumpadAdd: { code: 0x4e },
  Numpad1: { code: 0x4f },
  Numpad2: { code: 0x50 },
  Numpad3: { code: 0x51 },
  Numpad0: { code: 0x52 },
  NumpadDecimal: { code: 0x53 },
  NumpadDivide: { code: 0x35, extended: true },
  NumpadEnter: { code: 0x1c, extended: true },
};

export function RdpCanvas({ tunnelId, width, height, connected }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pendingRef = useRef<FrameRect[]>([]);
  const rafRef = useRef<number>(0);
  const pressedKeysRef = useRef<Set<string>>(new Set());

  // Initialize canvas backing buffer on mount or dimension change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
  }, [width, height]);

  const paint = useCallback(() => {
    const frames = pendingRef.current.splice(0);

    if (frames.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    for (const frame of frames) {
      if (frame.w <= 0 || frame.h <= 0) continue;
      try {
        const imageData = ctx.createImageData(frame.w, frame.h);
        const src = new Uint8ClampedArray(frame.data);
        imageData.data.set(src);
        ctx.putImageData(imageData, frame.x, frame.y);
      } catch {}
    }

    rafRef.current = 0;
  }, []);

  useEffect(() => {
    if (!connected || !tunnelId) return;

    const frameHandler = (id: string, rect: { x: number; y: number; w: number; h: number }, buf: ArrayBuffer) => {
      if (id !== tunnelId) return;
      pendingRef.current.push({ ...rect, data: buf });
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(paint);
      }
    };

    const eventHandler = (id: string, type: string) => {
      if (id !== tunnelId) return;
      if (type === 'disconnected' || type === 'error') {
        pendingRef.current = [];
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };

    const unsubFrame = window.cloudflareRdp.rdp.onFrame(frameHandler);
    const unsubEvent = window.cloudflareRdp.rdp.onEvent(eventHandler);

    return () => {
      unsubFrame();
      unsubEvent();
      pendingRef.current = [];
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [tunnelId, connected, paint]);

  const getCanvasPos = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }, [width, height]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    canvasRef.current?.focus();
    const pos = getCanvasPos(e);
    const flags = buttonToDownFlag(e.button);
    window.cloudflareRdp.rdp.sendMouse(tunnelId, flags, pos.x, pos.y);
  }, [tunnelId, getCanvasPos]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const pos = getCanvasPos(e);
    const flags = buttonToUpFlag(e.button);
    window.cloudflareRdp.rdp.sendMouse(tunnelId, flags, pos.x, pos.y);
  }, [tunnelId, getCanvasPos]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pos = getCanvasPos(e);
    const flags = PTR_FLAGS_MOVE;
    window.cloudflareRdp.rdp.sendMouse(tunnelId, flags, pos.x, pos.y);
  }, [tunnelId, getCanvasPos]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    const pos = getCanvasPos(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 3 : e.deltaY;
    const amount = Math.min(Math.abs(Math.round(delta)), 0x001F) || 1;
    const flags = PTR_FLAGS_WHEEL
      | (delta > 0 ? PTR_FLAGS_WHEEL_NEGATIVE : 0)
      | amount;
    window.cloudflareRdp.rdp.sendMouse(tunnelId, flags, pos.x, pos.y);
  }, [tunnelId, getCanvasPos]);

  const handleBlur = useCallback(() => {
    if (pressedKeysRef.current.size === 0) return;
    for (const code of pressedKeysRef.current) {
      const mapped = KEY_TO_SCANCODE[code];
      if (mapped) {
        const flags = 0x8000 | (mapped.extended ? 0x0100 : 0);
        window.cloudflareRdp.rdp.sendKeyboard(tunnelId, flags, mapped.code);
      }
    }
    pressedKeysRef.current.clear();
  }, [tunnelId]);

  useEffect(() => {
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('blur', handleBlur);
      handleBlur();
    };
  }, [handleBlur]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    const mapped = KEY_TO_SCANCODE[e.code];
    if (mapped) {
      pressedKeysRef.current.add(e.code);
      const flags = mapped.extended ? 0x0100 : 0;
      window.cloudflareRdp.rdp.sendKeyboard(tunnelId, flags, mapped.code);
    }
  }, [tunnelId]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    const mapped = KEY_TO_SCANCODE[e.code];
    if (mapped) {
      pressedKeysRef.current.delete(e.code);
      const flags = 0x8000 | (mapped.extended ? 0x0100 : 0);
      window.cloudflareRdp.rdp.sendKeyboard(tunnelId, flags, mapped.code);
    }
  }, [tunnelId]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      tabIndex={0}
      style={{
        width: '100%',
        height: '100%',
        cursor: connected ? 'default' : 'not-allowed',
        outline: 'none',
        background: '#000',
        objectFit: 'contain',
        imageRendering: 'auto',
      }}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={handleBlur}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
