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
    script.src = new URL("./vendor/qrcode.min.js", import.meta.url).toString();
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
    const title = document.createElement("strong");
    title.textContent = "Check-In Link";
    const link = document.createElement("p");
    link.textContent = value;
    fallback.append(title, link);
    container.appendChild(fallback);
  }
}
