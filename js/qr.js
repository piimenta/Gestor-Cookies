// Gera um QR code como SVG usando a lib qrcode-generator (carregada via CDN como window.qrcode).
// Sempre preto no branco, independente do tema, para os leitores funcionarem.

export function qrSvg(text, { margin = 2, ecc = 'M', label = 'QR code' } = {}) {
  if (typeof window.qrcode !== 'function') return null;
  const qr = window.qrcode(0, ecc);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${label}"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
