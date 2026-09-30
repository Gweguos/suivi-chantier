import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { supabase } from './supabase'

export default function Viewer({ plan, onClose }) {
  const versions = [...plan.plan_versions].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const [version, setVersion] = useState(versions.find((v) => v.is_current) || versions[0])
  const [pdf, setPdf] = useState(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState('')
  const canvas = useRef(null)
  const box = useRef(null)

  useEffect(() => {
    let cancelled = false
    setPdf(null); setError('')
    ;(async () => {
      const { data, error } = await supabase.storage.from('plans').download(version.file_path)
      if (error) { setError('Impossible de charger ce plan.'); return }
      const doc = await pdfjsLib.getDocument({ data: await data.arrayBuffer() }).promise
      if (!cancelled) { setPdf(doc); setPage(1); setZoom(1) }
    })()
    return () => { cancelled = true }
  }, [version])

  useEffect(() => {
    if (!pdf) return
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
  }, [pdf, page, zoom])

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
        {pdf && pdf.numPages > 1 && (
          <>
            <button onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={page === 1}>‹</button>
            <span>{page} / {pdf.numPages}</span>
            <button onClick={() => setPage((n) => Math.min(pdf.numPages, n + 1))} disabled={page === pdf.numPages}>›</button>
          </>
        )}
      </div>
      <div className="stage" ref={box}>
        {error ? <p className="error">{error}</p> : !pdf ? <p className="muted">Chargement du plan…</p> : null}
        <canvas ref={canvas} />
      </div>
    </div>
  )
}
