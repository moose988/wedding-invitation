const INTRO_STARTUP_TIMEOUT = 8000;
const INTRO_BUFFER_TIMEOUT = 8000;

/**
 * Coordinates the envelope video's first visible frame, playback recovery, and
 * completion. Playback itself stays in the click handler so mobile browsers
 * retain the original user activation.
 */
export function createIntroSequence({
  video,
  onState = () => {},
  onFrame = () => {},
  onComplete = () => {},
  timers = globalThis,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  startupTimeout = INTRO_STARTUP_TIMEOUT,
  bufferTimeout = INTRO_BUFFER_TIMEOUT,
  finishAt = null,
} = {}) {
  let active = false;
  let completed = false;
  let framePresented = false;
  let phase = "idle";
  let startupTimer = null;
  let bufferTimer = null;
  let animationFrame = null;
  let videoFrame = null;
  let handlers = null;

  const setTimer = timers.setTimeout.bind(timers);
  const clearTimer = timers.clearTimeout.bind(timers);
  const publish = (nextPhase) => {
    phase = nextPhase;
    onState(nextPhase);
  };

  function clearStartupTimer() {
    if (startupTimer !== null) clearTimer(startupTimer);
    startupTimer = null;
  }

  function clearBufferTimer() {
    if (bufferTimer !== null) clearTimer(bufferTimer);
    bufferTimer = null;
  }

  function clearFrameCallbacks() {
    if (videoFrame !== null) {
      video.cancelVideoFrameCallback?.(videoFrame);
      videoFrame = null;
    }
    if (animationFrame !== null) {
      if (cancelFrame) cancelFrame(animationFrame);
      else clearTimer(animationFrame);
      animationFrame = null;
    }
  }

  function clearTimers() {
    clearStartupTimer();
    clearBufferTimer();
  }

  function detachVideoHandlers() {
    if (!handlers || !video) return;
    for (const [type, listener] of Object.entries(handlers)) {
      video.removeEventListener(type, listener);
    }
    handlers = null;
  }

  function cleanup() {
    clearTimers();
    clearFrameCallbacks();
    detachVideoHandlers();
  }

  function finish(reason) {
    if (completed) return false;
    completed = true;
    active = false;
    cleanup();
    publish("complete");
    onComplete(reason);
    return true;
  }

  function finishWithFallback(reason) {
    if (completed || !active) return false;
    completed = true;
    active = false;
    video?.pause?.();
    cleanup();
    publish("fallback");
    onComplete(reason);
    return true;
  }

  function scheduleStartupWatch() {
    clearStartupTimer();
    if (framePresented) return;
    startupTimer = setTimer(() => {
      startupTimer = null;
      if (active && !framePresented) finishWithFallback("startup-timeout");
    }, startupTimeout);
  }

  function showFrame() {
    if (!active || framePresented || video?.paused || video?.ended) return;
    framePresented = true;
    clearTimers();
    clearFrameCallbacks();
    onFrame();
    publish("playing");
  }

  function requestFirstFrame() {
    if (!active || framePresented || video?.paused) return;
    if (typeof video?.requestVideoFrameCallback === "function") {
      if (videoFrame !== null) return;
      videoFrame = video.requestVideoFrameCallback(() => {
        videoFrame = null;
        showFrame();
      });
      return;
    }

    if (animationFrame !== null) return;
    const revealWhenPainted = () => {
      animationFrame = null;
      if (video?.readyState >= 2 && !video.paused && !video.ended) showFrame();
    };
    if (requestFrame) animationFrame = requestFrame(revealWhenPainted);
    else animationFrame = setTimer(revealWhenPainted, 16);
  }

  function markBuffering() {
    if (!active) return;
    publish("buffering");
    clearBufferTimer();
    bufferTimer = setTimer(() => {
      bufferTimer = null;
      if (active) finishWithFallback("buffer-timeout");
    }, bufferTimeout);
  }

  function attachVideoHandlers() {
    if (!video || handlers) return;
    handlers = {
      playing: () => {
        clearBufferTimer();
        if (framePresented) publish("playing");
        else publish("loading");
        requestFirstFrame();
      },
      loadeddata: requestFirstFrame,
      canplay: requestFirstFrame,
      waiting: markBuffering,
      stalled: markBuffering,
      timeupdate: () => {
        // Some videos end on a long still frame; hand over once the motion is done.
        if (finishAt !== null && framePresented && video.currentTime >= finishAt) finish("motion-complete");
      },
      ended: () => finish("ended"),
      error: () => finishWithFallback("media-error"),
    };
    for (const [type, listener] of Object.entries(handlers)) {
      video.addEventListener(type, listener);
    }
  }

  function start() {
    if (completed || active || !video) return false;
    active = true;
    attachVideoHandlers();
    publish("loading");
    if (!framePresented) scheduleStartupWatch();
    return true;
  }

  function retry() {
    if (completed) return false;
    if (!active) return start();
    if (phase !== "retry") return false;
    clearBufferTimer();
    publish("loading");
    if (!framePresented) scheduleStartupWatch();
    else clearBufferTimer();
    return true;
  }

  return {
    start,
    retry,
    playbackRejected: () => finishWithFallback("playback-blocked"),
    unavailable: () => finishWithFallback("unavailable"),
    skip: () => finish("skip"),
    dispose: () => {
      if (!completed) {
        active = false;
        cleanup();
        publish("disposed");
      }
    },
    get active() { return active; },
    get completed() { return completed; },
    get phase() { return phase; },
    get framePresented() { return framePresented; },
  };
}
