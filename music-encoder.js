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

export async function decodeAudio(file) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser cannot read audio files here. Try Chrome, Safari or Edge.");
  const context = new Context();
  try { return await context.decodeAudioData(await file.arrayBuffer()); }
  catch { throw new Error("That audio file could not be read. Try another file or export it as MP3."); }
  finally { context.close?.(); }
}

export function encodeMp3(buffer, { onProgress = () => {}, workerUrl = "/music-worker.js" } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl);
    worker.onmessage = event => {
      const m = event.data;
      if (m.type === "progress") onProgress(m.value);
      else if (m.type === "done") { worker.terminate(); resolve(m.blob); }
      else if (m.type === "error") { worker.terminate(); reject(new Error(`The song could not be converted: ${m.message}`)); }
    };
    worker.onerror = () => { worker.terminate(); reject(new Error("The converter could not start. Reload the page and try again.")); };
    const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i).slice());
    worker.postMessage({ channels, sampleRate: buffer.sampleRate, kbps: MUSIC_LIMITS.kbps }, channels.map(c => c.buffer));
  });
}
