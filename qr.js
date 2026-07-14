let qrLibraryPromise = null;

function loadQrLibrary() {
  if (window.QRCode) {
    return Promise.resolve(window.QRCode);
  }

  if (qrLibraryPromise) {
    return qrLibraryPromise;
  }

  qrLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    script.async = true;
    script.onload = () => resolve(window.QRCode);
    script.onerror = () => reject(new Error("QR library failed to load."));
    document.head.appendChild(script);
  });

  return qrLibraryPromise;
}

export async function renderQrCode(container, value, options = {}) {
  if (!container) {
    return;
  }

  container.innerHTML = "";
  const size = options.size || 200;

  try {
    const QRCode = await loadQrLibrary();
    new QRCode(container, {
      text: value,
      width: size,
      height: size,
      colorDark: "#6f542b",
      colorLight: "#fffaf4",
      correctLevel: QRCode.CorrectLevel.H,
    });
  } catch (error) {
    const fallback = document.createElement("div");
    fallback.className = "qr-fallback";
    fallback.innerHTML = `
      <strong>Check-In Link</strong>
      <p>${escapeHtml(value)}</p>
    `;
    container.appendChild(fallback);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
