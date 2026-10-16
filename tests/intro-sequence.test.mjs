import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const moduleText = await readFile(new URL("../intro-sequence.js", import.meta.url), "utf8");
const { createIntroSequence } = await import(`data:text/javascript;base64,${Buffer.from(moduleText).toString("base64")}`);

class FakeClock {
  now = 0;
  nextId = 1;
  jobs = new Map();

  setTimeout = (callback, delay) => {
    const id = this.nextId++;
    this.jobs.set(id, { callback, at: this.now + delay });
    return id;
  };

  clearTimeout = (id) => this.jobs.delete(id);

  advance(ms) {
    const end = this.now + ms;
    while (true) {
      const next = [...this.jobs.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      this.now = next[1].at;
      this.jobs.delete(next[0]);
      next[1].callback();
    }
    this.now = end;
  }
}

class FakeVideo {
  paused = true;
  ended = false;
  readyState = 0;
  listeners = new Map();
  videoFrames = new Map();
  nextFrameId = 1;
  pauseCalls = 0;

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener();
  }

  listenerCount() {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }

  requestVideoFrameCallback(callback) {
    const id = this.nextFrameId++;
    this.videoFrames.set(id, callback);
    return id;
  }

  cancelVideoFrameCallback(id) {
    this.videoFrames.delete(id);
  }

  presentFrame() {
    const [id, callback] = this.videoFrames.entries().next().value || [];
    if (!callback) return;
    this.videoFrames.delete(id);
    callback(this.now || 0, {});
  }

  pause() {
    this.pauseCalls += 1;
    this.paused = true;
  }
}

function createHarness(options = {}) {
  const clock = new FakeClock();
  const video = new FakeVideo();
  const events = [];
  const sequence = createIntroSequence({
    video,
    timers: clock,
    startupTimeout: 12000,
    bufferTimeout: 18000,
    onState: (phase) => events.push(["state", phase]),
    onFrame: () => events.push(["frame"]),
    onComplete: (reason) => events.push(["complete", reason]),
    ...options,
  });
  return { clock, video, sequence, events };
}

test("poster stays until the first presented frame; ended completes and cleans up", () => {
  const { clock, video, sequence, events } = createHarness();
  assert.equal(sequence.start(), true);
  video.paused = false;
  video.readyState = 2;
  video.emit("playing");
  assert.equal(sequence.framePresented, false);
  assert.equal(video.videoFrames.size, 1);

  video.presentFrame();
  assert.equal(sequence.framePresented, true);
  assert.equal(sequence.phase, "playing");
  assert.deepEqual(events.slice(-2), [["frame"], ["state", "playing"]]);

  video.ended = true;
  video.emit("ended");
  assert.equal(sequence.completed, true);
  assert.deepEqual(events.at(-2), ["state", "complete"]);
  assert.deepEqual(events.at(-1), ["complete", "ended"]);
  assert.equal(video.listenerCount(), 0);
  assert.equal(video.videoFrames.size, 0);
  assert.equal(clock.jobs.size, 0);
});

test("slow startup and recoverable stalls expose retry without skipping playback", () => {
  const { clock, video, sequence } = createHarness();
  sequence.start();
  clock.advance(11999);
  assert.equal(sequence.phase, "loading");
  clock.advance(1);
  assert.equal(sequence.phase, "retry");
  assert.equal(sequence.active, true);

  assert.equal(sequence.retry(), true);
  video.emit("stalled");
  assert.equal(sequence.phase, "buffering");
  clock.advance(10000);
  assert.equal(sequence.completed, false);
  video.paused = false;
  video.readyState = 2;
  video.emit("playing");
  video.presentFrame();
  assert.equal(sequence.phase, "playing");
  clock.advance(30000);
  assert.equal(sequence.completed, false);
  assert.equal(sequence.skip(), true);
  assert.equal(sequence.completed, true);
  assert.equal(video.listenerCount(), 0);
  assert.equal(clock.jobs.size, 0);
});

test("rejected playback can be retried; repeated starts and completion stay idempotent", () => {
  const { clock, video, sequence, events } = createHarness();
  sequence.start();
  assert.equal(sequence.playbackRejected(), true);
  assert.equal(sequence.phase, "blocked");
  assert.equal(video.pauseCalls, 1);
  assert.equal(video.listenerCount(), 0);

  assert.equal(sequence.start(), true);
  assert.equal(sequence.start(), false);
  assert.equal(sequence.skip(), true);
  assert.equal(sequence.skip(), false);
  assert.equal(events.filter(([type]) => type === "complete").length, 1);
  assert.equal(video.listenerCount(), 0);
  assert.equal(clock.jobs.size, 0);
});

test("permanent media errors stop callbacks and leave skip available", () => {
  const { clock, video, sequence } = createHarness();
  sequence.start();
  video.emit("error");
  assert.equal(sequence.phase, "error");
  assert.equal(sequence.active, false);
  assert.equal(video.pauseCalls, 1);
  assert.equal(video.listenerCount(), 0);
  assert.equal(clock.jobs.size, 0);
  assert.equal(sequence.skip(), true);
});

test("browsers without video-frame callbacks use a paint-frame fallback", () => {
  const clock = new FakeClock();
  const video = new FakeVideo();
  video.requestVideoFrameCallback = undefined;
  video.cancelVideoFrameCallback = undefined;
  let paint;
  const sequence = createIntroSequence({
    video,
    timers: clock,
    requestFrame: (callback) => { paint = callback; return 1; },
    cancelFrame: () => { paint = null; },
  });
  sequence.start();
  video.paused = false;
  video.readyState = 2;
  video.emit("playing");
  assert.equal(sequence.framePresented, false);
  paint();
  assert.equal(sequence.framePresented, true);
  sequence.skip();
  assert.equal(video.listenerCount(), 0);
});

test("opening tap starts inline muted video before the independent music request", async () => {
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../invitations/wedding-designs/layla-zaid/index.html", import.meta.url), "utf8");
  const tapHandler = script.slice(script.indexOf("function handleOpenInvitation()"), script.indexOf("function revealInvitation()"));
  assert.ok(tapHandler.indexOf("configureInlineEnvelopePlayback(video)") < tapHandler.indexOf("video.play()"));
  assert.ok(tapHandler.lastIndexOf("video.play()") < tapHandler.lastIndexOf("playWeddingMusicFromGesture()"));
  assert.doesNotMatch(tapHandler, /currentTime\s*=|\.load\(/);
  assert.match(script, /video\.defaultMuted\s*=\s*true[\s\S]*?video\.muted\s*=\s*true[\s\S]*?video\.playsInline\s*=\s*true/);
  assert.match(html, /playsinline webkit-playsinline muted/);
  assert.match(html, /assets\/opening-envelope\.mp4/);
});

test("reduced-motion preference does not bypass the guest-requested envelope video", async () => {
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");
  const tapHandler = script.slice(script.indexOf("function handleOpenInvitation()"), script.indexOf("function revealInvitation()"));

  assert.doesNotMatch(tapHandler, /prefers-reduced-motion|setTimeout|revealInvitation\(\)/);
  assert.match(tapHandler, /configureInlineEnvelopePlayback\(video\);[\s\S]*?video\.play\(\)/);
  assert.match(tapHandler, /playback\.catch\(\(\) => state\.introSequence\?\.playbackRejected\(\)\)/);
});
