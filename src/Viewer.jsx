import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { fetchPlan } from './cache.js'
import { useAnnotations, Markers, AnnotationSheet, DayFilter, AnnotationList } from './Annotations.jsx'

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
  const [activeFolder, setActiveFolder] = useState(null)
  const [drawing, setDrawing] = useState(false)
  const [listOpen, setListOpen] = useState(() => window.matchMedia('(min-width: 900px)').matches)
  const ptrs = useRef(new Map())
  const moved = useRef(false)
  const zoomRef = useRef(1)
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
    const ro = new ResizeObserver(() => setStage((s) => (!s.w || Math.abs(s.w - el.clientWidth) > 24 || Math.abs(s.h - el.clientHeight) > 24 ? { w: el.clientWidth, h: el.clientHeight } : s)))
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
      .catch((e) => { if (!off) setError('Impossible de charger le plan : ' + (e && e.message ? e.message : e)) })
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
      .catch((e) => { if (!off) setError('Impossible de charger le plan : ' + (e && e.message ? e.message : e)) })
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
      setDrawing(true)
      const p = await pdf.getPage(page)
      if (off) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const nw = Math.round(Math.min(st.clientWidth, W) * dpr)
      const nh = Math.round(Math.min(st.clientHeight, H) * dpr)
      const buf = document.createElement('canvas') // dessin hors écran : l'ancien rendu reste visible jusqu'à la fin
      buf.width = nw; buf.height = nh
      const vp = p.getViewport({ scale: css * dpr, offsetX: -st.scrollLeft * dpr, offsetY: -st.scrollTop * dpr })
      task = p.render({ canvasContext: buf.getContext('2d'), viewport: vp })
      try { await task.promise } catch (e) {
        if (e && e.name !== 'RenderingCancelledException') { setDrawing(false); setError('Rendu impossible : ' + (e.message || e)) }
        return
      }
      if (off) return
      c.width = nw; c.height = nh
      c.style.width = nw / dpr + 'px'; c.style.height = nh / dpr + 'px'
      c.getContext('2d').drawImage(buf, 0, 0)
      setDrawing(false)
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

  useEffect(() => { zoomRef.current = zoom }, [zoom])

  // Zoom (ancré sur un point de la vue) et/ou déplacement
  function view({ z, ax, ay, dx = 0, dy = 0 }) {
    const st = box.current
    const nz = Math.min(MAX_ZOOM, Math.max(0.5, z === undefined ? zoomRef.current : z))
    const r = nz / zoomRef.current
    const cur = pending.current || { x: st.scrollLeft, y: st.scrollTop }
    const px = ax === undefined ? st.clientWidth / 2 : ax
    const py = ay === undefined ? st.clientHeight / 2 : ay
    const x = (cur.x + px) * r - px - dx
    const y = (cur.y + py) * r - py - dy
    zoomRef.current = nz
    if (r === 1) { st.scrollLeft = x; st.scrollTop = y; pending.current = null }
    else { pending.current = { x, y }; setZoom(nz) }
  }
  function fitView() {
    const st = box.current
    pending.current = { x: 0, y: 0 }
    zoomRef.current = 1
    if (zoom === 1) { st.scrollLeft = 0; st.scrollTop = 0; pending.current = null } else setZoom(1)
  }

  // Molette = zoom au curseur (sur ordinateur)
  useEffect(() => {
    const st = box.current
    const onWheel = (e) => {
      e.preventDefault()
      const rect = st.getBoundingClientRect()
      view({ z: zoomRef.current * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), ax: e.clientX - rect.left, ay: e.clientY - rect.top })
    }
    st.addEventListener('wheel', onWheel, { passive: false })
    return () => st.removeEventListener('wheel', onWheel)
  }, [])

  // Glisser = déplacer (souris, clic molette, un doigt) ; deux doigts = zoom + déplacement
  function onPointerDown(e) {
    if (e.target.closest('.marker')) return
    if (e.pointerType === 'mouse' && e.button !== 1) return // souris : seul le clic molette déplace
    e.currentTarget.setPointerCapture(e.pointerId)
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    moved.current = false
  }
  function onPointerMove(e) {
    const m = ptrs.current
    const prev = m.get(e.pointerId)
    if (!prev) return
    const next = { x: e.clientX, y: e.clientY }
    if (m.size === 1) {
      const dx = next.x - prev.x, dy = next.y - prev.y
      if (!moved.current && Math.hypot(dx, dy) < 4) return
      moved.current = true
      m.set(e.pointerId, next)
      view({ dx, dy })
    } else if (m.size === 2) {
      const other = [...m.entries()].find(([id]) => id !== e.pointerId)[1]
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y) || 1
      const d1 = Math.hypot(next.x - other.x, next.y - other.y)
      const rect = box.current.getBoundingClientRect()
      moved.current = true
      m.set(e.pointerId, next)
      view({ z: zoomRef.current * (d1 / d0), ax: (next.x + other.x) / 2 - rect.left, ay: (next.y + other.y) / 2 - rect.top, dx: (next.x - prev.x) / 2, dy: (next.y - prev.y) / 2 })
    }
  }
  const onPointerUp = (e) => { ptrs.current.delete(e.pointerId) }

  function focusAnnot(a) {
    setSheet({ annot: a })
    if (!window.matchMedia('(min-width: 900px)').matches) setListOpen(false)
    if (a.page !== page) { setPage(a.page); return }
    const st = box.current
    st.scrollLeft = a.geometry.x * W - st.clientWidth / 2
    st.scrollTop = a.geometry.y * H - st.clientHeight / 2
  }

  function placePoint(e) {
    if (moved.current) return
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
        <button onClick={() => view({ z: zoom / 1.6 })} aria-label="Dézoomer">−</button>
        <button onClick={fitView}>Ajuster</button>
        <button onClick={() => view({ z: zoom * 1.6 })} aria-label="Zoomer">+</button>
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
        <button onClick={() => setShowDays((s) => !s)}>Calques</button>
        <button onClick={() => setListOpen((o) => !o)}>Liste</button>
        {hasDisplay && <button onClick={() => setHd((h) => !h)}>{hd ? 'Aperçu' : 'HD'}</button>}
      </div>
      {annotate && <p className="hint">Touchez le plan pour placer un point.</p>}
      {showDays && <DayFilter plan={plan} folders={folders} annots={annots} hidden={hidden} setHidden={setHidden} reload={reload} />}
      <div className="body">
      <div className="stage" ref={box} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onMouseDown={(e) => e.button === 1 && e.preventDefault()}>
        {error && <p className="error msg">{error}</p>}
        {loading && <p className="muted msg">{useImage ? 'Chargement du plan…' : 'Chargement du PDF haute définition…'}</p>}
        {!useImage && drawing && !loading && !error && <p className="muted msg">Rendu en cours…</p>}
        <div className={'sizer' + (annotate ? ' annotating' : '')} style={{ width: W, height: H }} onClick={annotate ? placePoint : undefined}>
          {useImage ? (imgUrl && <img src={imgUrl} alt={plan.name} />) : <canvas ref={canvas} />}
          {showAnn && <Markers annots={annots} hidden={hidden} page={page} onSelect={(a) => setSheet({ annot: a })} />}
        </div>
      </div>
      {listOpen && (
        <aside className="side">
          <div className="top"><strong>Annotations</strong><button onClick={() => setListOpen(false)}>Fermer</button></div>
          <AnnotationList annots={annots} folders={folders} hidden={hidden} onSelect={focusAnnot} />
        </aside>
      )}
      </div>
      {sheet && (
        <AnnotationSheet key={sheet.annot ? sheet.annot.id : 'new'} plan={plan} version={version} draft={sheet.draft} annot={sheet.annot} folders={folders} activeFolder={activeFolder} onLayer={setActiveFolder} reload={reload}
          onClose={() => setSheet(null)} onSaved={() => { setSheet(null); reload() }} />
      )}
    </div>
  )
}
