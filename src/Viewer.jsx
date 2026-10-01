import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { fetchPlan } from './cache.js'
import { useAnnotations, Markers, AnnotationSheet, DayFilter } from './Annotations.jsx'

const MAX_ZOOM = 20     // zoom maximal (multiple de la vue « Ajuster »)

export default function Viewer({ plan, onClose }) {
  const versions = [...plan.plan_versions].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const [version, setVersion] = useState(versions.find((v) => v.is_current) || versions[0])
  const [hd, setHd] = useState(false)
  const [pdf, setPdf] = useState(null)
  const [imgUrl, setImgUrl] = useState(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const [error, setError] = useState('')
  const { annots, folders, reload } = useAnnotations(plan, version)
  const [annotate, setAnnotate] = useState(false)
  const [showAnn, setShowAnn] = useState(true)
  const [showDays, setShowDays] = useState(false)
  const [hidden, setHidden] = useState(new Set())
  const [sheet, setSheet] = useState(null)
  const box = useRef(null)
  const canvas = useRef(null)
  const pending = useRef(null)
  const hasDisplay = !!(version.display_paths && version.display_paths.length)
  const useImage = hasDisplay && !hd
  const pages = version.page_count || 1

  const size = (version.page_sizes && version.page_sizes[page - 1]) || { w: 1000, h: 700 }
  const fit = stage.w / size.w
  const css = fit * zoom
  const W = size.w * css
  const H = size.h * css

  useEffect(() => {
    const el = box.current
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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

  // Haute définition : le PDF d'origine, chargé à la demande
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

  // Rendu net à tout zoom : seule la partie visible est dessinée, à la bonne résolution
  useEffect(() => {
    if (useImage || !pdf || !stage.w) return
    const st = box.current
    let task, raf, off = false
    const draw = async () => {
      if (task) task.cancel()
      const c = canvas.current
      if (!c) return
      const p = await pdf.getPage(page)
      if (off) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const nw = Math.round(Math.min(st.clientWidth, W) * dpr)
      const nh = Math.round(Math.min(st.clientHeight, H) * dpr)
      const buf = document.createElement('canvas') // dessin hors écran : l'ancien rendu reste visible jusqu'à la fin
      buf.width = nw; buf.height = nh
      const vp = p.getViewport({ scale: css * dpr, offsetX: -st.scrollLeft * dpr, offsetY: -st.scrollTop * dpr })
      task = p.render({ canvasContext: buf.getContext('2d'), viewport: vp })
      try { await task.promise } catch { return }
      if (off) return
      c.width = nw; c.height = nh
      c.style.width = nw / dpr + 'px'; c.style.height = nh / dpr + 'px'
      c.getContext('2d').drawImage(buf, 0, 0)
    }
    const onScroll = () => { clearTimeout(raf); raf = setTimeout(draw, 90) }
    st.addEventListener('scroll', onScroll)
    draw()
    return () => { off = true; if (task) task.cancel(); clearTimeout(raf); st.removeEventListener('scroll', onScroll) }
  }, [pdf, page, zoom, stage, useImage])

  // Garde le centre de la vue en place quand on zoome
  useLayoutEffect(() => {
    const p = pending.current
    if (p && box.current) { box.current.scrollLeft = p.x; box.current.scrollTop = p.y; pending.current = null }
  }, [zoom])

  function zoomTo(nz) {
    nz = Math.min(MAX_ZOOM, Math.max(0.5, nz))
    const st = box.current
    const r = nz / zoom
    pending.current = nz === 1 ? { x: 0, y: 0 } : {
      x: (st.scrollLeft + st.clientWidth / 2) * r - st.clientWidth / 2,
      y: (st.scrollTop + st.clientHeight / 2) * r - st.clientHeight / 2,
    }
    setZoom(nz)
  }

  function placePoint(e) {
    const r = e.currentTarget.getBoundingClientRect()
    setSheet({ draft: { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, page } })
  }

  const loading = !error && (useImage ? !imgUrl : !pdf)

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
        <button onClick={() => zoomTo(zoom / 1.6)} aria-label="Dézoomer">−</button>
        <button onClick={() => zoomTo(1)}>Ajuster</button>
        <button onClick={() => zoomTo(zoom * 1.6)} aria-label="Zoomer">+</button>
        <span>{Math.round(zoom * 100)} %</span>
        {pages > 1 && (
          <>
            <button onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={page === 1}>‹</button>
            <span>{page} / {pages}</span>
            <button onClick={() => setPage((n) => Math.min(pages, n + 1))} disabled={page === pages}>›</button>
          </>
        )}
        <button className={annotate ? 'primary' : ''} onClick={() => setAnnotate((a) => !a)}>Annoter</button>
        <button onClick={() => setShowAnn((s) => !s)}>{showAnn ? 'Masquer' : 'Afficher'}</button>
        <button onClick={() => setShowDays((s) => !s)}>Jours</button>
        {hasDisplay && <button onClick={() => setHd((h) => !h)}>{hd ? 'Aperçu' : 'HD'}</button>}
      </div>
      {annotate && <p className="hint">Touchez le plan pour placer un point.</p>}
      {showDays && <DayFilter folders={folders} annots={annots} hidden={hidden} setHidden={setHidden} />}
      <div className="stage" ref={box}>
        {error && <p className="error msg">{error}</p>}
        {loading && <p className="muted msg">{useImage ? 'Chargement du plan…' : 'Chargement du PDF haute définition…'}</p>}
        <div className={'sizer' + (annotate ? ' annotating' : '')} style={{ width: W, height: H }} onClick={annotate ? placePoint : undefined}>
          {useImage ? (imgUrl && <img src={imgUrl} alt={plan.name} />) : <canvas ref={canvas} />}
          {showAnn && <Markers annots={annots} hidden={hidden} page={page} onSelect={(a) => setSheet({ annot: a })} />}
        </div>
      </div>
      {sheet && (
        <AnnotationSheet key={sheet.annot ? sheet.annot.id : 'new'} plan={plan} version={version} draft={sheet.draft} annot={sheet.annot}
          onClose={() => setSheet(null)} onSaved={() => { setSheet(null); reload() }} />
      )}
    </div>
  )
}
