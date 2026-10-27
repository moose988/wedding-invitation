let library;
async function load() {
  if (window.QRCode) return window.QRCode;
  library ||= new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = new URL('../vendor/qrcode.min.js', import.meta.url).href;
    script.onload = () => resolve(window.QRCode); script.onerror = () => { library = null; reject(new Error('The QR code could not load. Refresh to try again.')); }; document.head.append(script);
  });
  return library;
}
// Existing local QR library, rendered on a new canvas with exactly 4 modules of quiet zone.
export async function qrCanvas(value) {
  const QRCode = await load(); const staging = document.createElement('div');
  const code = new QRCode(staging, { text: value, width: 256, height: 256, correctLevel: QRCode.CorrectLevel.M });
  const model = code._oQRCode, count = model.getModuleCount(), scale = Math.max(4, Math.ceil(720 / (count + 8)));
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = (count + 8) * scale;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#182923';
  for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) if (model.isDark(y, x)) ctx.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale);
  canvas.setAttribute('aria-label', 'QR code to open the guest photo page'); canvas.setAttribute('role', 'img'); return canvas;
}
export function canvasBlob(canvas) { return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not export the QR image.')), 'image/png')); }
