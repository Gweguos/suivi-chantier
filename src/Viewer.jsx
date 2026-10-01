import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { fetchPlan } from './cache.js'

export default function Viewer({ plan, onClose }) {
  const versions = [...plan.plan_versions].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const [version, setVersion] = useState(versions.find((v) => v.is_current) || versions[0])
  const [hd, setHd] = useState(false)
  const [pdf, setPdf] = useState(null)
  const [imgUrl, setImgUrl] = useState(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState('')
  const canvas = useRef(null)
  const box = useRef(null)
  const hasDisplay = !!(version.display_paths && version.display_paths.length)
  const useImage = hasDisplay && !hd
  const pages = version.page_count || 1

  useEffect(() => { setPage(1); setZoom(1); setHd(false); setPdf(null); setImgUrl(null); setError('') }, [version])

  // Aperçu allégé (image) : rapide
  useEffect(() => {
    if (!useImage) return
    let url, off = false
    setImgUrl(null)
    fetchPlan(version.display_paths[page - 1])
      .then((b) => { if (!off) { url = URL.createObjectURL(b); setImgUrl(url) } })
      .catch(() => { if (!off) setError('Impossible de charger le plan.') })
    return () => { off = true; if (url) URL.revokeObjectURL(url) }
  }, [version, page, useImage])

  // Haute définition (PDF d'origine) : à la demande, ou pour les anciens plans sans aperçu
  useEffect(() => {
    if (useImage) return
    let off = false
    setPdf(null)
    fetchPlan(version.file_path)
      .then(async (b) => {
        const d = await pdfjsLib.getDocument({ data: await b.arrayBuffer() }).promise
        if (!off) setPdf(d)
      })
      .catch(() => { if (!off) setError('Impossible de charger le plan.') })
    return () => { off = true }
  }, [version, useImage])

  useEffect(() => {
    if (useImage || !pdf) return
    let task
    ;(async () => {
      const p = await pdf.getPage(page)
      const base = p.getViewport({ scale: 1 })
      const css = (box.current.clientWidth / base.width) * zoom
      const ratio = Math.min(window.devicePixelRatio || 1, 2, 4096 / (Math.max(base.width, base.height) * css))
      const vp = p.getViewport({ scale: css * ratio })
      const c = canvas.current
      c.width = vp.width; c.height = vp.height
      c.style.width = base.width * css + 'px'; c.style.height = base.height * css + 'px'
      task = p.render({ canvasContext: c.getContext('2d'), viewport: vp })
      try { await task.promise } catch { /* rendu annulé */ }
    })()
    return () => task && task.cancel()
  }, [pdf, page, zoom, useImage])

  const zoomBy = (f) => setZoom((z) => Math.min(6, Math.max(0.5, z * f)))

  return (
    <div className="viewer">
      <header>
        <button onClick={onClose}>Fermer</button>
        <strong>{plan.name}</strong>
        <select value={version.id} onChange={(e) => setVersion(versions.find((v) => v.id === e.target.value))}>
          {versions.map((v) => <option key={v.id} value={v.id}>Indice {v.version_label}{v.is_current ? ' (actuel)' : ''}</option>)}
        </select>
      </header>
      <div className="tools">
        <button onClick={() => zoomBy(1 / 1.5)} aria-label="Dézoomer">−</button>
        <button onClick={() => setZoom(1)}>Ajuster</button>
        <button onClick={() => zoomBy(1.5)} aria-label="Zoomer">+</button>
        {pages > 1 && (
          <>
            <button onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={page === 1}>‹</button>
            <span>{page} / {pages}</span>
            <button onClick={() => setPage((n) => Math.min(pages, n + 1))} disabled={page === pages}>›</button>
          </>
        )}
        {hasDisplay && <button onClick={() => setHd((h) => !h)}>{hd ? 'Aperçu' : 'HD'}</button>}
      </div>
      <div className="stage" ref={box}>
        {error && <p className="error">{error}</p>}
        {useImage ? (
          imgUrl ? <img className="planimg" src={imgUrl} style={{ width: `${zoom * 100}%` }} alt={plan.name} />
                 : !error && <p className="muted">Chargement du plan…</p>
        ) : (
          <>
            {!pdf && !error && <p className="muted">Chargement du PDF…</p>}
            <canvas ref={canvas} />
          </>
        )}
      </div>
    </div>
  )
}
