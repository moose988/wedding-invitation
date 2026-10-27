import { LIMITS, validateFile } from './limits.js';
export async function decode(blob) {
  let bitmap;
  try { bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch { throw new Error('This photo could not be opened. Try exporting it as JPEG or choose another photo.'); }
  if (bitmap.width * bitmap.height > LIMITS.pixels) { bitmap.close(); throw new Error('Choose a photo under 40 megapixels.'); }
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
