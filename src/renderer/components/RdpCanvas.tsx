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

export function RdpCanvas({ tunnelId, width, height, connected }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const pendingRef = useRef<FrameRect[]>([]);
  const rafRef = useRef<number>(0);
  const mouseDownRef = useRef(false);
  const widthRef = useRef(width);
  const heightRef = useRef(height);
  widthRef.current = width;
  heightRef.current = height;

  // Initialize canvas backing buffer on mount or dimension change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
  }, [width, height]);

  const paint = useCallback(() => {
    const frames = pendingRef.current.splice(0);
    const w = widthRef.current;
    const h = heightRef.current;

    if (frames.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    let offscreen = offscreenRef.current;
    if (!offscreen) {
      offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      offscreenRef.current = offscreen;
    } else if (offscreen.width !== w || offscreen.height !== h) {
      offscreen.width = w;
      offscreen.height = h;
    }

    const ctx = offscreen.getContext('2d', { willReadFrequently: false });
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

    canvas.width = w;
    canvas.height = h;
    const dst = canvas.getContext('2d');
    if (dst) {
      dst.drawImage(offscreen, 0, 0);
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
    mouseDownRef.current = true;
    const pos = getCanvasPos(e);
    const flags = buttonToDownFlag(e.button);
    window.cloudflareRdp.rdp.sendMouse(tunnelId, flags, pos.x, pos.y);
  }, [tunnelId, getCanvasPos]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    mouseDownRef.current = false;
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
    const amount = Math.min(Math.abs(Math.round(e.deltaY)), 0x001F) || 1;
    const flags = PTR_FLAGS_WHEEL
      | (e.deltaY > 0 ? PTR_FLAGS_WHEEL_NEGATIVE : 0)
      | amount;
    window.cloudflareRdp.rdp.sendMouse(tunnelId, flags, pos.x, pos.y);
  }, [tunnelId, getCanvasPos]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    window.cloudflareRdp.rdp.sendKeyboard(tunnelId, 0, e.keyCode);
  }, [tunnelId]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    window.cloudflareRdp.rdp.sendKeyboard(tunnelId, 0x8000, e.keyCode);
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
      }}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
