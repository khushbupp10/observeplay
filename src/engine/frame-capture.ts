import type { FrameData } from '../types/barrier';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum capture rate required by Requirement 2.1 */
export const MIN_CAPTURE_FPS = 5;

/** Default capture rate */
export const DEFAULT_FPS = 5;

/** Maximum capture rate */
export const MAX_FPS = 30;

/** Default resolution scale (1.0 = full resolution) */
export const DEFAULT_RESOLUTION_SCALE = 1.0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback invoked for each captured frame */
export type FrameCaptureCallback = (frame: FrameData) => void;

/** Configuration for the frame capture pipeline */
export interface FrameCaptureConfig {
  /** Target frames per second (clamped to MIN_CAPTURE_FPS..MAX_FPS) */
  fps?: number;
  /** Resolution scale factor (0 < scale ≤ 1.0). Lower = smaller capture for performance. */
  resolutionScale?: number;
  /** Callback invoked for each captured frame */
  onFrame?: FrameCaptureCallback;
  /** Optional WebSocket URL to stream frames to a remote copilot service */
  webSocketUrl?: string;
  /** Whether to skip a frame if the previous one is still being processed */
  enableThrottling?: boolean;
}

/** Read-only stats about the capture pipeline */
export interface FrameCaptureStats {
  /** Total frames captured since start */
  framesCaptured: number;
  /** Frames skipped due to throttling */
  framesSkipped: number;
  /** Current effective FPS */
  currentFps: number;
  /** Whether the pipeline is currently running */
  running: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampFps(fps: number): number {
  return Math.max(MIN_CAPTURE_FPS, Math.min(MAX_FPS, Math.round(fps)));
}

function clampScale(scale: number): number {
  if (scale <= 0) return DEFAULT_RESOLUTION_SCALE;
  return Math.min(1.0, scale);
}

// ---------------------------------------------------------------------------
// FrameCapturePipeline
// ---------------------------------------------------------------------------

/**
 * Captures game frames from an HTMLElement at a configurable FPS using the
 * canvas API. Supports resolution scaling, frame throttling, per-frame
 * callbacks, and optional WebSocket streaming.
 *
 * Requirement 2.1 — analyse game screen at ≥ 5 FPS.
 */
export class FrameCapturePipeline {
  private fps: number;
  private resolutionScale: number;
  private onFrame: FrameCaptureCallback | undefined;
  private enableThrottling: boolean;

  private source: HTMLCanvasElement | null = null;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private processing = false;

  private framesCaptured = 0;
  private framesSkipped = 0;
  private fpsTracker: number[] = [];

  private ws: WebSocket | null = null;
  private webSocketUrl: string | undefined;

  constructor(config: FrameCaptureConfig = {}) {
    this.fps = clampFps(config.fps ?? DEFAULT_FPS);
    this.resolutionScale = clampScale(config.resolutionScale ?? DEFAULT_RESOLUTION_SCALE);
    this.onFrame = config.onFrame;
    this.enableThrottling = config.enableThrottling ?? true;
    this.webSocketUrl = config.webSocketUrl;
  }

  // ---- Configuration ----

  /** Update the target FPS (clamped to MIN..MAX). Takes effect on next interval. */
  setFps(fps: number): void {
    this.fps = clampFps(fps);
    // Restart the timer if running so the new interval takes effect
    if (this.running) {
      this.stopTimer();
      this.startTimer();
    }
  }

  getFps(): number {
    return this.fps;
  }

  /** Update the resolution scale (0 < scale ≤ 1.0). */
  setResolutionScale(scale: number): void {
    this.resolutionScale = clampScale(scale);
  }

  getResolutionScale(): number {
    return this.resolutionScale;
  }

  /** Replace the per-frame callback. */
  setOnFrame(cb: FrameCaptureCallback | undefined): void {
    this.onFrame = cb;
  }

  // ---- Lifecycle ----

  /**
   * Start capturing frames from the given source canvas element.
   * If a WebSocket URL was configured, a connection is opened.
   */
  start(source: HTMLCanvasElement): void {
    if (this.running) return;

    this.source = source;
    this.running = true;
    this.framesCaptured = 0;
    this.framesSkipped = 0;
    this.fpsTracker = [];

    this.openWebSocket();
    this.startTimer();
  }

  /** Stop capturing and clean up resources. */
  stop(): void {
    if (!this.running) return;

    this.running = false;
    this.stopTimer();
    this.closeWebSocket();
    this.source = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Get current capture statistics. */
  getStats(): FrameCaptureStats {
    return {
      framesCaptured: this.framesCaptured,
      framesSkipped: this.framesSkipped,
      currentFps: this.computeCurrentFps(),
      running: this.running,
    };
  }

  // ---- Capture logic ----

  /**
   * Capture a single frame from the source canvas.
   * Exposed publicly so callers can trigger manual captures (useful for testing).
   */
  captureFrame(): FrameData | null {
    if (!this.source) return null;

    const srcWidth = this.source.width;
    const srcHeight = this.source.height;

    if (srcWidth === 0 || srcHeight === 0) return null;

    const captureWidth = Math.max(1, Math.round(srcWidth * this.resolutionScale));
    const captureHeight = Math.max(1, Math.round(srcHeight * this.resolutionScale));

    // Create an offscreen canvas at the target resolution
    const offscreen = document.createElement('canvas');
    offscreen.width = captureWidth;
    offscreen.height = captureHeight;

    const ctx = offscreen.getContext('2d');
    if (!ctx) return null;

    // Draw the source canvas scaled down
    ctx.drawImage(this.source, 0, 0, captureWidth, captureHeight);

    const imageData = ctx.getImageData(0, 0, captureWidth, captureHeight);

    const frame: FrameData = {
      imageData,
      timestamp: Date.now(),
      width: captureWidth,
      height: captureHeight,
    };

    return frame;
  }

  // ---- Private helpers ----

  private startTimer(): void {
    const intervalMs = Math.round(1000 / this.fps);
    this.timerId = setInterval(() => this.tick(), intervalMs);
  }

  private stopTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private tick(): void {
    if (!this.running || !this.source) return;

    // Throttle: skip if previous frame is still being processed
    if (this.enableThrottling && this.processing) {
      this.framesSkipped++;
      return;
    }

    this.processing = true;

    try {
      const frame = this.captureFrame();
      if (!frame) {
        this.processing = false;
        return;
      }

      this.framesCaptured++;
      this.fpsTracker.push(Date.now());

      // Invoke callback
      this.onFrame?.(frame);

      // Stream via WebSocket if connected
      this.sendFrameOverWebSocket(frame);
    } finally {
      this.processing = false;
    }
  }

  private computeCurrentFps(): number {
    const now = Date.now();
    const windowMs = 1000;
    // Keep only timestamps within the last second
    this.fpsTracker = this.fpsTracker.filter((t) => now - t < windowMs);
    return this.fpsTracker.length;
  }

  // ---- WebSocket streaming ----

  private openWebSocket(): void {
    if (!this.webSocketUrl) return;

    try {
      this.ws = new WebSocket(this.webSocketUrl);
      this.ws.binaryType = 'arraybuffer';
    } catch {
      this.ws = null;
    }
  }

  private closeWebSocket(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  private sendFrameOverWebSocket(frame: FrameData): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      // Send a lightweight JSON header + raw pixel data
      const header = JSON.stringify({
        timestamp: frame.timestamp,
        width: frame.width,
        height: frame.height,
      });
      this.ws.send(header);

      // Send the raw image data as ArrayBuffer
      if (frame.imageData instanceof ArrayBuffer) {
        this.ws.send(frame.imageData);
      } else {
        this.ws.send((frame.imageData as ImageData).data.buffer);
      }
    } catch {
      // Swallow send errors — the pipeline should not crash on network issues
    }
  }
}
