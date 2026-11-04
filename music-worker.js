// Web Worker: encodes decoded audio to MP3 (128 kbps) with lamejs, reporting progress.
// lamejs (LGPL-3.0) is loaded unmodified from /vendor/lame.min.js, a separate file.
importScripts("/vendor/lame.min.js");

self.onmessage = (event) => {
  try {
    const { samples, sampleRate, kbps = 128 } = event.data;
    const encoder = new lamejs.Mp3Encoder(1, sampleRate, kbps);
    const length = samples.length, block = 1152 * 20, parts = [];
    const toInt16 = (float, from, to) => { const out = new Int16Array(to - from); for (let i = from; i < to; i++) { const v = Math.max(-1, Math.min(1, float[i])); out[i - from] = v < 0 ? v * 0x8000 : v * 0x7fff; } return out; };
    for (let from = 0; from < length; from += block) {
      const to = Math.min(length, from + block);
      const chunk = encoder.encodeBuffer(toInt16(samples, from, to));
      if (chunk.length) parts.push(new Int8Array(chunk));
      self.postMessage({ type: "progress", value: to / length });
    }
    const tail = encoder.flush(); if (tail.length) parts.push(new Int8Array(tail));
    self.postMessage({ type: "done", blob: new Blob(parts, { type: "audio/mpeg" }) });
  } catch (error) { self.postMessage({ type: "error", message: String(error?.message || error) }); }
};
