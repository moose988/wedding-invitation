// Prepares a customer's song: checks the file, decodes it with Web Audio, and encodes MP3 at 128 kbps in a Web Worker.
export const MUSIC_LIMITS = Object.freeze({ maxBytes: 50 * 1024 * 1024, maxSeconds: 600, kbps: 128 });

export function checkAudioFile(file) {
  if (!file) return "Choose an audio file.";
  if (!/^audio\//.test(file.type || "")) return "That file is not audio. Choose an MP3, M4A, WAV or similar audio file.";
  if (file.size > MUSIC_LIMITS.maxBytes) return "That file is larger than 50 MB. Choose a smaller one.";
  if (file.size === 0) return "That file is empty.";
  return "";
}
export const checkDuration = seconds => seconds > MUSIC_LIMITS.maxSeconds ? `That song is longer than ${MUSIC_LIMITS.maxSeconds / 60} minutes. Choose a shorter one.` : "";
export const songNameFrom = filename => Array.from(String(filename || "Custom song").replace(/\.[A-Za-z0-9]{1,5}$/, "").trim() || "Custom song").slice(0, 80).join("");

const SAMPLE_RATE = 44_100;
const FALLBACK_MAX_SECONDS = 10;

function isLimitedDevice() {
  const memory = globalThis.navigator?.deviceMemory;
  return (typeof memory === "number" && memory <= 4)
    || globalThis.matchMedia?.("(hover: none) and (pointer: coarse)").matches === true
    || globalThis.matchMedia?.("(max-width: 767px)").matches === true;
}

async function checkFallbackDuration(file, signal) {
  signal?.throwIfAborted();
  const url = URL.createObjectURL(file);
  const audio = document.createElement("audio");
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Could not read the song duration. Try another file.")), 10000);
      const finish = callback => value => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); callback(value); };
      const abort = () => finish(reject)(signal.reason ?? new DOMException("Song conversion cancelled", "AbortError"));
      audio.onloadedmetadata = finish(resolve);
      audio.onerror = finish(() => reject(new Error("Could not read the song duration. Try another file.")));
      signal?.addEventListener("abort", abort, { once: true });
      audio.preload = "metadata";
      audio.src = url;
    });
    if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > FALLBACK_MAX_SECONDS) {
      throw new Error("This file is too long to convert here. Try a shorter file or an MP3.");
    }
  } finally {
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
  }
}

export async function decodeAudio(file, { signal } = {}) {
  signal?.throwIfAborted();
  const Context = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Context) throw new Error("This browser cannot read audio files here. Try Chrome, Safari or Edge.");

  let buffer;
  try {
    // Web Audio resamples to the context rate but preserves the file's channel count.
    const context = new Context(1, 1, SAMPLE_RATE);
    buffer = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error("That audio file could not be read. Try another file or export it as MP3.");
  }
  signal?.throwIfAborted();
  const tooLong = checkDuration(buffer.duration);
  if (tooLong) throw new Error(tooLong);

  // Reuse the first channel for the mono mix instead of allocating another full track.
  const samples = buffer.getChannelData(0);
  const channelCount = buffer.numberOfChannels;
  for (let c = 1; c < channelCount; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < samples.length; i++) samples[i] += channel[i];
  }
  if (channelCount > 1) {
    for (let i = 0; i < samples.length; i++) samples[i] /= channelCount;
  }
  return samples;
}

function convertInWorker(workerUrl, input, { onProgress = () => {}, signal, transfer = [] } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const worker = new Worker(workerUrl);
    const finish = (settle, value) => {
      signal?.removeEventListener("abort", abort);
      globalThis.removeEventListener?.("pagehide", abort);
      worker.terminate();
      settle(value);
    };
    const abort = () => finish(reject, signal?.reason ?? new DOMException("Song conversion cancelled.", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    globalThis.addEventListener?.("pagehide", abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") onProgress(data.value);
      else if (data.type === "done") finish(resolve, data.blob);
      else if (data.type === "unsupported") finish(resolve, null);
      else if (data.type === "error") finish(reject, new Error(`The song could not be converted: ${data.message}`));
    };
    worker.onerror = () => finish(reject, new Error("The converter could not start. Reload the page and try again."));
    try {
      worker.postMessage(input, transfer);
    } catch (error) {
      finish(reject, error);
    }
  });
}

export function encodeMp3(samples, { workerUrl = "/music-worker.js", ...options } = {}) {
  return convertInWorker(workerUrl, { samples, sampleRate: SAMPLE_RATE, kbps: MUSIC_LIMITS.kbps }, {
    ...options, transfer: [samples.buffer],
  });
}

export async function convertSongToMp3(file, options) {
  if (isLimitedDevice()) throw new Error("Please upload songs from a computer");
  if (/^audio\/(?:mpeg|mp3)$/i.test(file.type) && typeof globalThis.AudioDecoder === "function") {
    const output = await convertInWorker("/music-stream-worker.js", file, options);
    if (output) return output;
  }
  await checkFallbackDuration(file, options?.signal);
  return encodeMp3(await decodeAudio(file, options), options);
}
