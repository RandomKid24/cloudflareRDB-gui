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

export function RdpCanvas({ tunnelId, width, height, connected }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const pendingRef = useRef<FrameRect[]>([]);
  const rafRef = useRef<number>(0);
  const mouseDownRef = useRef(false);

  // Initialize canvas backing buffer on mount or dimension change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    console.log('[RDP] canvas init:', width, height);
  }, [width, height]);

  const paint = useCallback(() => {
    const frames = pendingRef.current.splice(0);
    if (frames.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    let offscreen = offscreenRef.current;
    if (!offscreen) {
      offscreen = document.createElement('canvas');
      offscreen.width = width;
      offscreen.height = height;
      offscreenRef.current = offscreen;
      console.log('[RDP] offscreen created at', offscreen.width, offscreen.height);
    } else if (offscreen.width !== width || offscreen.height !== height) {
      offscreen.width = width;
      offscreen.height = height;
      console.log('[RDP] offscreen resized to', width, height);
    }

    const ctx = offscreen.getContext('2d', { willReadFrequently: false });
    if (!ctx) return;

    for (const frame of frames) {
      console.log('[RDP] paint frame', frame.x, frame.y, frame.w, frame.h, frame.data.byteLength);
      const imageData = ctx.createImageData(frame.w, frame.h);
      const src = new Uint8ClampedArray(frame.data);
      imageData.data.set(src);
      ctx.putImageData(imageData, frame.x, frame.y);
    }

    canvas.width = width;
    canvas.height = height;
    const dst = canvas.getContext('2d');
    if (dst) {
      dst.drawImage(offscreen, 0, 0);
    }

    console.log('[RDP] paint done, canvas:', width, height);
    rafRef.current = 0;
  }, [width, height]);

  useEffect(() => {
    if (!connected || !tunnelId) return;

    const frameHandler = (id: string, rect: { x: number; y: number; w: number; h: number }, buf: ArrayBuffer) => {
      if (id !== tunnelId) return;
      console.log('[RDP] frame received', rect.x, rect.y, rect.w, rect.h, buf.byteLength);
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
    let flags = 0x0001;
    if (e.button === 2) flags = 0x0002;
    else if (e.button === 1) flags = 0x0004;
    window.cloudflareRdp.rdp.sendMouse(tunnelId, flags, pos.x, pos.y);
  }, [tunnelId, getCanvasPos]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    mouseDownRef.current = false;
    const pos = getCanvasPos(e);
    let flags = 0x0000;
    if (e.button === 2) flags = 0x0002;
    else if (e.button === 1) flags = 0x0004;
    window.cloudflareRdp.rdp.sendMouse(tunnelId, flags, pos.x, pos.y);
  }, [tunnelId, getCanvasPos]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pos = getCanvasPos(e);
    const flags = 0x0001 | (mouseDownRef.current ? 0x8000 : 0);
    window.cloudflareRdp.rdp.sendMouse(tunnelId, flags, pos.x, pos.y);
  }, [tunnelId, getCanvasPos]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    const pos = getCanvasPos(e);
    const flags = e.deltaY > 0 ? 0x0200 : 0x0080;
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
