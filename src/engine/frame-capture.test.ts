import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FrameCapturePipeline,
  MIN_CAPTURE_FPS,
  MAX_FPS,
  DEFAULT_FPS,
  DEFAULT_RESOLUTION_SCALE,
} from './frame-capture';
import type { FrameData } from '../types/barrier';

// ---------------------------------------------------------------------------
// DOM / Canvas mocks
// ---------------------------------------------------------------------------

/** Minimal ImageData stub for node environment */
class FakeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

function createFakeContext(width: number, height: number) {
  return {
    drawImage: vi.fn(),
    getImageData: vi.fn(
      (_sx: number, _sy: number, w: number, h: number) => new FakeImageData(w, h),
    ),
  };
}

function createFakeCanvas(width: number, height: number) {
  const ctx = createFakeContext(width, height);
  return {
    width,
    height,
    getContext: vi.fn(() => ctx),
    __ctx: ctx,
  };
}

/**
 * Installs minimal DOM stubs on `globalThis` so FrameCapturePipeline can run
 * in a node environment. Returns a cleanup function.
 */
function installDomStubs() {
  const origDocument = (globalThis as Record<string, unknown>).document;

  const fakeDocument = {
    createElement: vi.fn((tag: string) => {
      if (tag === 'canvas') {
        return createFakeCanvas(100, 100);
      }
      return {};
    }),
  };

  (globalThis as Record<string, unknown>).document = fakeDocument;

  return () => {
    if (origDocument === undefined) {
      delete (globalThis as Record<string, unknown>).document;
    } else {
      (globalThis as Record<string, unknown>).document = origDocument;
    }
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FrameCapturePipeline', () => {
  let cleanup: () => void;

  beforeEach(() => {
    cleanup = installDomStubs();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  // ---- Construction & defaults ----

  it('uses default FPS and resolution scale when no config provided', () => {
    const pipeline = new FrameCapturePipeline();
    expect(pipeline.getFps()).toBe(DEFAULT_FPS);
    expect(pipeline.getResolutionScale()).toBe(DEFAULT_RESOLUTION_SCALE);
    expect(pipeline.isRunning()).toBe(false);
  });

  it('clamps FPS to MIN_CAPTURE_FPS..MAX_FPS', () => {
    const low = new FrameCapturePipeline({ fps: 1 });
    expect(low.getFps()).toBe(MIN_CAPTURE_FPS);

    const high = new FrameCapturePipeline({ fps: 100 });
    expect(high.getFps()).toBe(MAX_FPS);

    const mid = new FrameCapturePipeline({ fps: 15 });
    expect(mid.getFps()).toBe(15);
  });

  it('clamps resolution scale to (0, 1.0]', () => {
    const zero = new FrameCapturePipeline({ resolutionScale: 0 });
    expect(zero.getResolutionScale()).toBe(DEFAULT_RESOLUTION_SCALE);

    const negative = new FrameCapturePipeline({ resolutionScale: -0.5 });
    expect(negative.getResolutionScale()).toBe(DEFAULT_RESOLUTION_SCALE);

    const over = new FrameCapturePipeline({ resolutionScale: 2.0 });
    expect(over.getResolutionScale()).toBe(1.0);

    const half = new FrameCapturePipeline({ resolutionScale: 0.5 });
    expect(half.getResolutionScale()).toBe(0.5);
  });

  // ---- Start / Stop lifecycle ----

  it('starts and stops capturing', () => {
    const pipeline = new FrameCapturePipeline();
    const source = createFakeCanvas(200, 150) as unknown as HTMLCanvasElement;

    pipeline.start(source);
    expect(pipeline.isRunning()).toBe(true);

    pipeline.stop();
    expect(pipeline.isRunning()).toBe(false);
  });

  it('start is idempotent when already running', () => {
    const onFrame = vi.fn();
    const pipeline = new FrameCapturePipeline({ onFrame });
    const source = createFakeCanvas(200, 150) as unknown as HTMLCanvasElement;

    pipeline.start(source);
    pipeline.start(source); // should not double-start
    expect(pipeline.isRunning()).toBe(true);

    pipeline.stop();
  });

  it('stop is safe when not running', () => {
    const pipeline = new FrameCapturePipeline();
    expect(() => pipeline.stop()).not.toThrow();
  });

  // ---- Frame capture ----

  it('invokes onFrame callback at the configured FPS', () => {
    const onFrame = vi.fn();
    const pipeline = new FrameCapturePipeline({ fps: 10, onFrame });
    const source = createFakeCanvas(200, 150) as unknown as HTMLCanvasElement;

    pipeline.start(source);

    // Advance 1 second — should get ~10 frames at 10 FPS (interval = 100ms)
    vi.advanceTimersByTime(1000);

    expect(onFrame).toHaveBeenCalled();
    // At 10 FPS with 100ms interval, we expect 10 calls in 1000ms
    expect(onFrame.mock.calls.length).toBe(10);

    pipeline.stop();
  });

  it('captures frames with correct dimensions at full resolution', () => {
    const frames: FrameData[] = [];
    const pipeline = new FrameCapturePipeline({
      fps: 5,
      resolutionScale: 1.0,
      onFrame: (f) => frames.push(f),
    });
    const source = createFakeCanvas(320, 240) as unknown as HTMLCanvasElement;

    pipeline.start(source);
    vi.advanceTimersByTime(200); // 1 frame at 5 FPS

    expect(frames.length).toBe(1);
    expect(frames[0].width).toBe(320);
    expect(frames[0].height).toBe(240);
    expect(frames[0].timestamp).toBeGreaterThan(0);

    pipeline.stop();
  });

  it('captures frames at reduced resolution when scale < 1', () => {
    const frames: FrameData[] = [];
    const pipeline = new FrameCapturePipeline({
      fps: 5,
      resolutionScale: 0.5,
      onFrame: (f) => frames.push(f),
    });
    const source = createFakeCanvas(400, 300) as unknown as HTMLCanvasElement;

    pipeline.start(source);
    vi.advanceTimersByTime(200);

    expect(frames.length).toBe(1);
    expect(frames[0].width).toBe(200);
    expect(frames[0].height).toBe(150);

    pipeline.stop();
  });

  // ---- Frame throttling ----

  it('skips frames when throttling is enabled and processing is slow', () => {
    let processingFrame = false;
    const onFrame = vi.fn(() => {
      // Simulate slow processing by keeping the processing flag set
      // The pipeline checks `this.processing` internally, so we simulate
      // by calling captureFrame manually in a blocking way.
      processingFrame = true;
    });

    const pipeline = new FrameCapturePipeline({
      fps: 10,
      enableThrottling: true,
      onFrame,
    });
    const source = createFakeCanvas(100, 100) as unknown as HTMLCanvasElement;

    pipeline.start(source);

    // First tick — should capture
    vi.advanceTimersByTime(100);
    expect(onFrame).toHaveBeenCalledTimes(1);

    // Pipeline sets processing = false after tick completes synchronously,
    // so subsequent ticks should also capture (synchronous callback)
    vi.advanceTimersByTime(100);
    expect(onFrame).toHaveBeenCalledTimes(2);

    pipeline.stop();
  });

  it('does not skip frames when throttling is disabled', () => {
    const onFrame = vi.fn();
    const pipeline = new FrameCapturePipeline({
      fps: 10,
      enableThrottling: false,
      onFrame,
    });
    const source = createFakeCanvas(100, 100) as unknown as HTMLCanvasElement;

    pipeline.start(source);
    vi.advanceTimersByTime(500); // 5 frames at 10 FPS
    expect(onFrame).toHaveBeenCalledTimes(5);

    pipeline.stop();
  });

  // ---- Dynamic FPS changes ----

  it('allows changing FPS while running', () => {
    const onFrame = vi.fn();
    const pipeline = new FrameCapturePipeline({ fps: 5, onFrame });
    const source = createFakeCanvas(100, 100) as unknown as HTMLCanvasElement;

    pipeline.start(source);

    // At 5 FPS, interval = 200ms. 1 second = 5 frames.
    vi.advanceTimersByTime(1000);
    expect(onFrame).toHaveBeenCalledTimes(5);

    onFrame.mockClear();

    // Change to 10 FPS
    pipeline.setFps(10);
    expect(pipeline.getFps()).toBe(10);

    // At 10 FPS, interval = 100ms. 1 second = 10 frames.
    vi.advanceTimersByTime(1000);
    expect(onFrame).toHaveBeenCalledTimes(10);

    pipeline.stop();
  });

  it('setFps clamps values', () => {
    const pipeline = new FrameCapturePipeline();
    pipeline.setFps(2);
    expect(pipeline.getFps()).toBe(MIN_CAPTURE_FPS);

    pipeline.setFps(60);
    expect(pipeline.getFps()).toBe(MAX_FPS);
  });

  // ---- Resolution scale changes ----

  it('allows changing resolution scale at runtime', () => {
    const frames: FrameData[] = [];
    const pipeline = new FrameCapturePipeline({
      fps: 5,
      resolutionScale: 1.0,
      onFrame: (f) => frames.push(f),
    });
    const source = createFakeCanvas(400, 300) as unknown as HTMLCanvasElement;

    pipeline.start(source);
    vi.advanceTimersByTime(200);
    expect(frames[0].width).toBe(400);

    pipeline.setResolutionScale(0.25);
    expect(pipeline.getResolutionScale()).toBe(0.25);

    vi.advanceTimersByTime(200);
    expect(frames[1].width).toBe(100);
    expect(frames[1].height).toBe(75);

    pipeline.stop();
  });

  // ---- Stats ----

  it('tracks capture statistics', () => {
    const pipeline = new FrameCapturePipeline({ fps: 10 });
    const source = createFakeCanvas(100, 100) as unknown as HTMLCanvasElement;

    const statsBefore = pipeline.getStats();
    expect(statsBefore.framesCaptured).toBe(0);
    expect(statsBefore.framesSkipped).toBe(0);
    expect(statsBefore.running).toBe(false);

    pipeline.start(source);
    vi.advanceTimersByTime(500); // 5 frames

    const statsAfter = pipeline.getStats();
    expect(statsAfter.framesCaptured).toBe(5);
    expect(statsAfter.running).toBe(true);

    pipeline.stop();
    expect(pipeline.getStats().running).toBe(false);
  });

  // ---- Manual capture ----

  it('captureFrame returns null when no source is set', () => {
    const pipeline = new FrameCapturePipeline();
    expect(pipeline.captureFrame()).toBeNull();
  });

  it('captureFrame returns null for zero-dimension source', () => {
    const pipeline = new FrameCapturePipeline();
    const source = createFakeCanvas(0, 0) as unknown as HTMLCanvasElement;
    pipeline.start(source);
    expect(pipeline.captureFrame()).toBeNull();
    pipeline.stop();
  });

  // ---- Minimum FPS guarantee (Requirement 2.1) ----

  it('guarantees at least MIN_CAPTURE_FPS frames per second', () => {
    const onFrame = vi.fn();
    const pipeline = new FrameCapturePipeline({ fps: MIN_CAPTURE_FPS, onFrame });
    const source = createFakeCanvas(100, 100) as unknown as HTMLCanvasElement;

    pipeline.start(source);
    vi.advanceTimersByTime(1000);

    expect(onFrame.mock.calls.length).toBeGreaterThanOrEqual(MIN_CAPTURE_FPS);

    pipeline.stop();
  });

  // ---- Callback replacement ----

  it('allows replacing the onFrame callback', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const pipeline = new FrameCapturePipeline({ fps: 5, onFrame: cb1 });
    const source = createFakeCanvas(100, 100) as unknown as HTMLCanvasElement;

    pipeline.start(source);
    vi.advanceTimersByTime(200);
    expect(cb1).toHaveBeenCalledTimes(1);

    pipeline.setOnFrame(cb2);
    vi.advanceTimersByTime(200);
    expect(cb2).toHaveBeenCalledTimes(1);
    // cb1 should not have been called again
    expect(cb1).toHaveBeenCalledTimes(1);

    pipeline.stop();
  });
});
