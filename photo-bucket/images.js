import { LIMITS, validateFile } from './limits.js';
// The photo itself cannot be used, so trying again cannot help: the queue offers only Remove.
const unusable = message => Object.assign(new Error(message), { unfixable: true });
function imageFallback(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => { img.close = () => URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}
// Width and height from a JPEG's frame header (as stored, before EXIF rotation). Null for anything else.
export function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let i = 2; i + 9 < bytes.length;) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6], width = (bytes[i + 7] << 8) | bytes[i + 8];
      return width && height ? { width, height } : null;
    }
    i += 2 + length;
  }
  return null;
}
async function headerDimensions(blob) {
  if (blob.type !== 'image/jpeg' || typeof blob.slice !== 'function') return null;
  try { return jpegDimensions(new Uint8Array(await blob.slice(0, 512 * 1024).arrayBuffer())); } catch { return null; }
}
// High-resolution camera modes (48, 50, 108, 200 MP) give JPEGs over the full-size decode limit. They are decoded already
// scaled so the long side is at most 4096 px, whichever way the browser applies EXIF rotation to the resize, and then
// shrunk to 2560 px like every other photo. Photos under the limit keep the plain full-size decode below.
async function decodeScaled(blob, { width, height }) {
  if (width * height > LIMITS.maxPixels) throw unusable('This photo is extremely large. Switch your camera to its normal photo size, or choose another photo.');
  const long = Math.max(width, height), short = Math.min(width, height);
  const target = Math.max(1, Math.floor(4096 * short / long));
  let bitmap;
  try { bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: target, resizeQuality: 'high' }); }
  catch { bitmap = null; }
  if (bitmap && bitmap.width * bitmap.height <= LIMITS.pixels) return bitmap;
  bitmap?.close?.();
  throw unusable('This photo is very large (over 40 megapixels) and this browser cannot shrink it. Switch your camera to its normal photo size, or choose another photo.');
}
export async function decode(blob) {
  const size = await headerDimensions(blob);
  if (size && size.width * size.height > LIMITS.pixels) return decodeScaled(blob, size);
  let bitmap;
  // Older Android/Huawei browsers lack createImageBitmap or its options; fall back to an <img> (which applies EXIF rotation itself).
  try { bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch {
    try { bitmap = await imageFallback(blob); }
    catch { throw unusable('This photo could not be opened. Try exporting it as JPEG or choose another photo.'); }
  }
  if (bitmap.width * bitmap.height > LIMITS.pixels) { bitmap.close(); throw unusable('This photo is very large (over 40 megapixels). Switch your camera to its normal photo size, or choose another photo.'); }
  return bitmap;
}
function canvas(width, height) { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; }
function encode(c, quality = .9) { return new Promise((resolve, reject) => c.toBlob(blob => blob ? resolve(blob) : reject(new Error('This photo could not be processed. Try a smaller image.')), 'image/jpeg', quality)); }
export function cropRect(width, height, { size = 100, x = 50, y = 50 } = {}) {
  const fraction = Math.min(100, Math.max(40, Number(size))) / 100;
  const w = Math.max(1, Math.round(width * fraction)), h = Math.max(1, Math.round(height * fraction));
  return { x: Math.round((width - w) * Math.min(100, Math.max(0, Number(x))) / 100), y: Math.round((height - h) * Math.min(100, Math.max(0, Number(y))) / 100), width: w, height: h };
}
export function rotatedCanvas(bitmap, rotation = 0, maxEdge = LIMITS.edge) {
  const angle = ((rotation % 360) + 360) % 360;
  const swap = angle === 90 || angle === 270;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
  const c = canvas(swap ? h : w, swap ? w : h); const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.translate(c.width / 2, c.height / 2); ctx.rotate(angle * Math.PI / 180); ctx.drawImage(bitmap, -w / 2, -h / 2, w, h); return c;
}
export async function processImage(file, edit = {}) {
  validateFile(file);
  const bitmap = await decode(file);
  try {
    const rotated = rotatedCanvas(bitmap, edit.rotation || 0); const rect = cropRect(rotated.width, rotated.height, edit);
    const result = canvas(rect.width, rect.height); result.getContext('2d').drawImage(rotated, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    const scale = Math.min(1, LIMITS.thumbnail / Math.max(result.width, result.height)); const thumb = canvas(Math.max(1, Math.round(result.width * scale)), Math.max(1, Math.round(result.height * scale)));
    thumb.getContext('2d').drawImage(result, 0, 0, thumb.width, thumb.height);
    return { blob: await encode(result), thumbnail: await encode(thumb, .78) };
  } finally { bitmap.close(); }
}
