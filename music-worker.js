// Web Worker: encodes decoded audio to MP3 (128 kbps) with lamejs, reporting progress.
// lamejs (LGPL-3.0) is loaded unmodified from /vendor/lame.min.js, a separate file.
importScripts("/vendor/lame.min.js");

// Each independent segment includes warm-up PCM. Keep only the frames at the
// matching position in the continuous output. The bundled encoder disables
// the MP3 bit reservoir, so retained frames have no dependencies on discarded frames.
function selectFrames(parts, { skip, count }) {
  const selected = [];
  let index = 0;
  for (const part of parts) {
    for (let offset = 0; offset < part.length;) {
      const size = 417 + ((part[offset + 2] >> 1) & 1); // MPEG-1 Layer III, 44.1 kHz, 128 kbps
      if (part[offset] !== -1 || offset + size > part.length) throw new Error("Invalid encoded audio frame.");
      if (index >= skip && (count === null || index < skip + count)) selected.push(part.subarray(offset, offset + size));
      index++;
      offset += size;
    }
  }
  if (count !== null && selected.length !== count) throw new Error("The converter returned an incomplete segment.");
  return selected;
}

self.onmessage = (event) => {
  try {
    const { samples, sampleRate, kbps = 128, frameWindow } = event.data;
    const encoder = new lamejs.Mp3Encoder(1, sampleRate, kbps);
    const length = samples.length, block = 1152 * 20, parts = [];
    const toInt16 = (float, from, to) => { const out = new Int16Array(to - from); for (let i = from; i < to; i++) { const v = Math.max(-1, Math.min(1, float[i])); out[i - from] = v < 0 ? v * 0x8000 : v * 0x7fff; } return out; };
    for (let from = 0; from < length; from += block) {
      const to = Math.min(length, from + block);
      const pcm = frameWindow ? samples.subarray(from, to) : toInt16(samples, from, to);
      const chunk = encoder.encodeBuffer(pcm);
      if (chunk.length) parts.push(new Int8Array(chunk));
      if (!frameWindow) self.postMessage({ type: "progress", value: to / length });
    }
    const tail = encoder.flush(); if (tail.length) parts.push(new Int8Array(tail));
    self.postMessage({ type: "done", blob: new Blob(frameWindow ? selectFrames(parts, frameWindow) : parts, { type: "audio/mpeg" }) });
  } catch (error) { self.postMessage({ type: "error", message: String(error?.message || error) }); }
};
