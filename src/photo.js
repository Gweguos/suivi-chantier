// Photos carrées : recadrage + compression automatique.
// Réglages : côté maximal du carré, taille cible du fichier.
const SIDE = 1400
const MIN_SIDE = 900
const TARGET = 600 * 1024

export const loadBitmap = (file) => createImageBitmap(file, { imageOrientation: 'from-image' })

export function centerCrop(bmp) {
  const size = Math.min(bmp.width, bmp.height)
  return { sx: (bmp.width - size) / 2, sy: (bmp.height - size) / 2, size }
}

export async function squareJpeg(bmp, { sx, sy, size }) {
  let side = Math.min(SIDE, Math.round(size))
  for (;;) {
    const c = document.createElement('canvas')
    c.width = c.height = side
    c.getContext('2d').drawImage(bmp, sx, sy, size, size, 0, 0, side, side)
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
