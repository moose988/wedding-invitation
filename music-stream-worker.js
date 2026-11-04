const SAMPLE_RATE = 44_100;
const FRAME_SAMPLES = 1152;
const SEGMENT_FRAMES = 240;
const WARM_UP_FRAMES = 12;
const MAX_SAMPLES = 600 * SAMPLE_RATE;
const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];

function readFrames(bytes) {
  let start = 0;
  let end = bytes.length;
  if (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) {
    if (bytes.length < 10 || bytes.subarray(6, 10).some(byte => byte >= 128)) return null;
    start = 10 + bytes[6] * 2097152 + bytes[7] * 16384 + bytes[8] * 128 + bytes[9];
    if (bytes[3] === 4 && bytes[5] & 16) start += 10;
  }
  if (end >= 128 && String.fromCharCode(...bytes.subarray(end - 128, end - 125)) === "TAG") end -= 128;

  const offsets = [];
  for (let offset = start; offset < end;) {
    if (offset + 4 > end) return null;
    const header = bytes[offset + 2];
    const bitrate = BITRATES[header >> 4];
    if (bytes[offset] !== 255 || (bytes[offset + 1] & 254) !== 250 || (header & 12) || !bitrate) return null;
    offsets.push(offset);
    offset += Math.floor(bitrate * 144000 / SAMPLE_RATE) + ((header >> 1) & 1);
    if (offset > end) return null;
  }
  if (offsets.length < 2) return null;

  let samples = offsets.length * FRAME_SAMPLES;
  let trimStart = 0;
  const mono = (bytes[start + 3] & 192) === 192;
  const crc = !(bytes[start + 1] & 1);
  const info = start + 4 + (mono ? 17 : 32) + (crc ? 2 : 0);
  const marker = String.fromCharCode(...bytes.subarray(info, info + 4));
  if (marker === "Xing" || marker === "Info") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (info + 12 > offsets[1]) return null;
    const flags = view.getUint32(info + 4);
    if (!(flags & 1) || view.getUint32(info + 8) !== offsets.length - 1) return null;
    const tag = info + 12 + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0);
    const encoder = String.fromCharCode(...bytes.subarray(tag, tag + 4));
    if (tag + 24 > offsets[1] || !["LAME", "Lavc", "Lavf"].includes(encoder)) return null;
    const delay = (bytes[tag + 21] << 4) | (bytes[tag + 22] >> 4);
    const padding = ((bytes[tag + 22] & 15) << 8) | bytes[tag + 23];
    samples -= FRAME_SAMPLES + delay + padding;
    trimStart = FRAME_SAMPLES + delay + Math.min(529, padding);
  }
  return { offsets: [...offsets, end], samples, trimStart, channels: mono ? 1 : 2 };
}

function encodeSegment(samples, skip, count) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/music-worker.js");
    const finish = (settle, value) => {
      worker.terminate();
      settle(value);
    };
    worker.onmessage = ({ data }) => {
      if (data.type === "done") finish(resolve, data.blob);
      else if (data.type === "error") finish(reject, new Error(data.message));
    };
    worker.onerror = () => finish(reject, new Error("The encoder worker could not start."));
    worker.postMessage({ samples, sampleRate: SAMPLE_RATE, frameWindow: { skip, count } }, [samples.buffer]);
  });
}

async function convert(bytes, { offsets, samples, trimStart }, config) {
  const overlap = WARM_UP_FRAMES * FRAME_SAMPLES;
  const segment = SEGMENT_FRAMES * FRAME_SAMPLES;
  const left = new Float32Array(FRAME_SAMPLES);
  const right = new Float32Array(FRAME_SAMPLES);
  const parts = [];
  let pcm = new Int16Array(segment), filled = 0, skip = 0;
  let submitted = 0, delivered = 0, read = 0, kept = 0;
  let pending, failure, wake;
  const decoder = new AudioDecoder({
    output(audio) {
      try {
        if (audio.sampleRate !== SAMPLE_RATE || audio.numberOfFrames > FRAME_SAMPLES || audio.numberOfChannels > 2) {
          throw new Error("Unexpected MP3 audio layout.");
        }
        audio.copyTo(left, { planeIndex: 0, format: "f32-planar" });
        if (audio.numberOfChannels === 2) audio.copyTo(right, { planeIndex: 1, format: "f32-planar" });
        for (let i = 0; i < audio.numberOfFrames; i++, read++) {
          if (read < trimStart || kept >= samples) continue;
          const sample = audio.numberOfChannels === 2 ? (left[i] + right[i]) * 0.5 : left[i];
          const clipped = Math.max(-1, Math.min(1, sample));
          pcm[filled++] = clipped < 0 ? clipped * 32768 : clipped * 32767;
          kept++;
          if (filled === pcm.length) {
            const next = new Int16Array(segment + overlap);
            next.set(pcm.subarray(pcm.length - overlap));
            pending = encodeSegment(pcm, skip, SEGMENT_FRAMES);
            // Capture any rejection while the decode loop is waiting for output.
            pending.catch(error => { failure = error; wake?.(); });
            pcm = next;
            filled = overlap;
            skip = WARM_UP_FRAMES;
          }
        }
        delivered++;
      } catch (error) {
        failure = error;
      } finally {
        audio.close();
        wake?.();
      }
    },
    error(error) { failure = error; wake?.(); },
  });

  try {
    decoder.configure(config);
    for (let i = 0; i < offsets.length - 1; i++) {
      if (failure) throw failure;
      decoder.decode(new EncodedAudioChunk({
        type: "key", timestamp: Math.round(i * FRAME_SAMPLES * 1e6 / SAMPLE_RATE),
        data: bytes.subarray(offsets[i], offsets[i + 1]),
      }));
      submitted++;
      while (!failure && submitted - delivered >= 4) {
        await new Promise(resolve => {
          const timeout = setTimeout(() => {
            failure = new Error("The MP3 decoder did not produce audio.");
            resolve();
          }, 3000);
          wake = () => { clearTimeout(timeout); wake = null; resolve(); };
        });
      }
      if (pending) {
        parts.push(await pending);
        pending = null;
        postMessage({ type: "progress", value: Math.min(1, kept / samples) });
      }
    }
    await decoder.flush();
    if (failure) throw failure;
    if (pending) parts.push(await pending);
    if (kept !== samples) return null;
    parts.push(await encodeSegment(pcm.subarray(0, filled), skip, null));
    return new Blob(parts, { type: "audio/mpeg" });
  } finally {
    if (decoder.state !== "closed") decoder.close();
  }
}

self.onmessage = async ({ data: file }) => {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const layout = readFrames(bytes);
    if (!layout || layout.samples <= 0) {
      postMessage({ type: "unsupported" });
      return;
    }
    const config = { codec: "mp3", sampleRate: SAMPLE_RATE, numberOfChannels: layout.channels };
    if (typeof AudioDecoder !== "function" || !(await AudioDecoder.isConfigSupported(config)).supported) {
      postMessage({ type: "unsupported" });
      return;
    }
    if (layout.samples > MAX_SAMPLES) {
      postMessage({ type: "error", message: "That song is longer than 10 minutes. Choose a shorter one." });
      return;
    }
    const blob = await convert(bytes, layout, config);
    postMessage(blob ? { type: "done", blob } : { type: "unsupported" });
  } catch {
    // Browsers differ in what MP3 layouts their WebCodecs decoder accepts.
    // Keep the established Web Audio route when the optimized path cannot finish.
    postMessage({ type: "unsupported" });
  }
};
