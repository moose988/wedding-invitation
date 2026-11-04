function loadScript(src, check) {
  if (check()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src; script.onload = () => check() ? resolve() : reject(new Error('Library unavailable'));
    script.onerror = () => reject(new Error('Library unavailable')); document.head.append(script);
  });
}

export async function downloadPosterPdf(poster) {
  await Promise.all([
    loadScript('./vendor/html2canvas.min.js', () => window.html2canvas),
    loadScript('./vendor/jspdf.umd.min.js', () => window.jspdf?.jsPDF),
  ]);
  await document.fonts?.ready;
  const canvas = await window.html2canvas(poster, {
    scale: 3, backgroundColor: '#fffdf7', windowWidth: 1200, logging: false,
    onclone(doc) {
      const style = doc.createElement('style');
      style.textContent = '.pb .pb-poster{width:148mm!important;height:210mm!important;max-width:none!important;aspect-ratio:auto!important;padding:22mm 16mm 16mm;box-shadow:none!important}';
      doc.head.append(style);
    },
  });
  const pdf = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5', compress: true });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 148, 210);
  pdf.save('photo-bucket-card.pdf');
}
