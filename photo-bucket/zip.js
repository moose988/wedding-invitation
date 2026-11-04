import { LIMITS } from './limits.js';
const table = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(bytes) { let n = 0xffffffff; for (const byte of bytes) n = table[(n ^ byte) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; }
function header(size, values) { const a = new Uint8Array(size), view = new DataView(a.buffer); for (const [offset, value, length] of values) length === 4 ? view.setUint32(offset, value, true) : view.setUint16(offset, value, true); return a; }
export function photoFilename(photo) { return `${photo.source === 'fixture' ? 'demo-' : ''}${photo.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-80)}.jpg`; }
export async function makeZip(photos, readBlob, progress = () => {}, signal) {
  if (!photos.length) throw new Error('There are no photos to download.');
  if (photos.length > LIMITS.zipCount || photos.reduce((s, p) => s + p.size, 0) > LIMITS.zipBytes) throw new Error('This gallery is too large for one local ZIP (128 MB / 500 photos). Filter by contributor or download individual photos.');
  const parts = [], directory = []; let offset = 0, total = 0;
  for (let index = 0; index < photos.length; index++) {
    if (signal?.aborted) throw new Error('ZIP creation cancelled.');
    const blob = await readBlob(photos[index]); total += blob.size;
    if (total > LIMITS.zipBytes) throw new Error('The local ZIP limit is 128 MB. Download fewer photos at a time.');
    // Only one image is read into a typed array at a time. ZIP entries are stored,
    // as JPEG is already compressed. Blob parts do not duplicate every image buffer.
    const bytes = new Uint8Array(await blob.arrayBuffer()), crc = crc32(bytes), name = new TextEncoder().encode(photoFilename(photos[index]));
    const local = header(30, [[0,0x04034b50,4],[4,20,2],[6,0x800,2],[14,crc,4],[18,blob.size,4],[22,blob.size,4],[26,name.length,2]]);
    parts.push(local, name, blob);
    directory.push(header(46, [[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x800,2],[16,crc,4],[20,blob.size,4],[24,blob.size,4],[28,name.length,2],[42,offset,4]]), name);
    offset += local.length + name.length + blob.size; progress(index + 1, photos.length); await new Promise(resolve => setTimeout(resolve, 0));
  }
  const centralSize = directory.reduce((s, p) => s + p.length, 0);
  const end = header(22, [[0,0x06054b50,4],[8,photos.length,2],[10,photos.length,2],[12,centralSize,4],[16,offset,4]]);
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}
export function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000); }
