// Compression automatique des photos : réduit les dimensions puis cherche la meilleure
// qualité JPEG qui reste sous la taille cible. Réglages à ajuster ci-dessous.
const MAX_SIDE = 2000
const MIN_SIDE = 1280
const TARGET = 700 * 1024

export async function compressPhoto(file) {
  if (file.type === 'image/jpeg' && file.size <= TARGET) return file
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  let side = Math.min(MAX_SIDE, Math.max(bmp.width, bmp.height))
  for (;;) {
    const s = side / Math.max(bmp.width, bmp.height)
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    const toBlob = (q) => new Promise((r) => c.toBlob(r, 'image/jpeg', q))
    let lo = 0.6, hi = 0.9, best = null
    for (let i = 0; i < 5; i++) {
      const q = (lo + hi) / 2
      const b = await toBlob(q)
      if (b.size <= TARGET) { best = b; lo = q } else hi = q
    }
    if (best) return best
    if (side <= MIN_SIDE) return toBlob(0.6)
    side = Math.max(MIN_SIDE, Math.round(side * 0.85))
  }
}
