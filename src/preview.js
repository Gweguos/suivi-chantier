// Niveaux de qualité de l'aperçu (la taille est aussi plafonnée en surface pour rester compatible iPhone).
export const LEVELS = {
  standard: { label: 'Standard (rapide)', side: 3000, area: 8e6, q: 0.8 },
  elevee: { label: 'Élevée', side: 4500, area: 14e6, q: 0.82 },
  maximale: { label: 'Maximale (plus lent)', side: 6000, area: 16e6, q: 0.85 },
}
export const THUMB = { side: 400, area: 1e9, q: 0.7 }

export async function renderJpeg(page, lv) {
  const base = page.getViewport({ scale: 1 })
  const s = Math.min(lv.side / Math.max(base.width, base.height), Math.sqrt(lv.area / (base.width * base.height)))
  const vp = page.getViewport({ scale: s })
  const c = document.createElement('canvas')
  c.width = Math.round(vp.width); c.height = Math.round(vp.height)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
  await page.render({ canvasContext: ctx, viewport: vp }).promise
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', lv.q))
  c.width = c.height = 0
  return blob
}
