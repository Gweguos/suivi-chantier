import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { fetchPlan } from './cache.js'
import { supabase } from './supabase'
import { LEVELS, THUMB, renderJpeg } from './preview.js'
import { useMeasure } from './Measure.jsx'
import { CameraIcon, PlusIcon, MinusIcon, FitIcon, PinIcon, RulerIcon, EyeIcon, EyeOffIcon, LayersIcon, ListIcon, ChevronUpIcon, ChevronDownIcon, ImageIcon } from './ui.jsx'
import { useAnnotations, Markers, AnnotationSheet, DayFilter, AnnotationList, STATUTS } from './Annotations.jsx'

const HD_MAX_DPR = 1.5  // finesse du rendu HD (plus bas = plus rapide)
const MAX_ZOOM = 30     // zoom maximal : 3000 % (multiple de la vue « Ajuster »)

function FabBtn({ label, on, disabled, onClick, children }) {
  return <button type="button" className={'fab' + (on ? ' on' : '')} aria-label={label} title={label} aria-pressed={on === undefined ? undefined : !!on} disabled={disabled} onClick={onClick}>{children}</button>
}

export default function Viewer({ plan, onClose, onChanged }) {
  const versions = [...plan.plan_versions].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const [version, setVersion] = useState(versions.find((v) => v.is_current) || versions[0])
  const [hd, setHd] = useState(false)
  const [pdf, setPdf] = useState(null)
  const [imgUrl, setImgUrl] = useState(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const [error, setError] = useState('')
  const { annots, folders, probs, reload } = useAnnotations(plan, version)
  const [annotate, setAnnotate] = useState(false)
  const [photoMode, setPhotoMode] = useState(false)
  const [showAnn, setShowAnn] = useState(true)
  const [showDays, setShowDays] = useState(false)
  const [hidden, setHidden] = useState(new Set())
  const [sheet, setSheet] = useState(null)
  const [nav, setNav] = useState(null) // parcours d'une problématique : { ids, i, title }
  const focusRef = useRef(null) // annotation à garder visible, hors de la zone couverte par la fiche
  const [tick, setTick] = useState(0)
  const sheetEl = useRef(null)
  const [pad, setPad] = useState({ r: 0, b: 0 })
  const dirtyRef = useRef(false)
  // Avertit avant d'abandonner une fiche modifiée mais non enregistrée
  function guard(fn) {
    if (dirtyRef.current && !window.confirm('Vous avez des modifications non enregistrées.\n\nAnnuler : revenir à la fiche pour l’enregistrer.\nOK : abandonner les modifications.')) return
    dirtyRef.current = false
    fn()
  }
  const [activeFolder, setActiveFolder] = useState(null)
  const [drawing, setDrawing] = useState(false)
  const [building, setBuilding] = useState(false)
  const lastPdf = useRef(null)
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
  const measure = useMeasure(version, size, page)

  useEffect(() => {
    const el = box.current
    const ro = new ResizeObserver(() => setStage((s) => (!s.w || Math.abs(s.w - el.clientWidth) > 24 || Math.abs(s.h - el.clientHeight) > 24 ? { w: el.clientWidth, h: el.clientHeight } : s)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => { setPage(1); setZoom(1); setHd(false); setPdf(null); setImgUrl(null); setError('') }, [version])

  // Aperçu allégé (image) : rapide
  useEffect(() => {
    if (!hasDisplay) return
    let url, off = false
    setImgUrl(null)
    fetchPlan(version.display_paths[page - 1])
      .then((b) => { if (!off) { url = URL.createObjectURL(b); setImgUrl(url) } })
      .catch((e) => { if (!off) setError('Impossible de charger le plan : ' + (e && e.message ? e.message : e)) })
    return () => { off = true; if (url) URL.revokeObjectURL(url) }
  }, [version, page, hasDisplay])

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
      const dpr = Math.min(window.devicePixelRatio || 1, HD_MAX_DPR)
      const nw = Math.round(Math.min(st.clientWidth, W) * dpr)
      const nh = Math.round(Math.min(st.clientHeight, H) * dpr)
      const buf = document.createElement('canvas') // dessin hors écran : l'ancien rendu reste visible jusqu'à la fin
      buf.width = nw; buf.height = nh
      const vp = p.getViewport({ scale: css * dpr, offsetX: -st.scrollLeft * dpr, offsetY: -st.scrollTop * dpr })
      task = p.render({ canvasContext: buf.getContext('2d'), viewport: vp, annotationMode: 0 })
      try { await task.promise } catch (e) {
        if (e && e.name !== 'RenderingCancelledException') { setDrawing(false); setError('Rendu impossible : ' + (e.message || e)) }
        return
      }
      if (off) return
      c.width = nw; c.height = nh
      c.style.width = nw / dpr + 'px'; c.style.height = nh / dpr + 'px'
      c.getContext('2d').drawImage(buf, 0, 0)
      c.style.opacity = '1'
      setDrawing(false)
    }
    const hide = () => { if (hasDisplay && canvas.current) canvas.current.style.opacity = '0' } // l'aperçu reste visible dessous
    const onScroll = () => { hide(); clearTimeout(raf); raf = setTimeout(draw, 150) }
    st.addEventListener('scroll', onScroll)
    hide()
    raf = setTimeout(draw, lastPdf.current === pdf ? 150 : 0)
    lastPdf.current = pdf
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
    focusRef.current = null // l'utilisateur déplace la vue : on arrête de recentrer
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
    focusRef.current = null
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
    const stop = (e) => e.preventDefault() // Safari : empêche le zoom natif de la page
    const onTouch = (e) => { if (e.touches.length > 1) e.preventDefault() }
    st.addEventListener('wheel', onWheel, { passive: false })
    st.addEventListener('gesturestart', stop)
    st.addEventListener('touchmove', onTouch, { passive: false })
    return () => {
      st.removeEventListener('wheel', onWheel)
      st.removeEventListener('gesturestart', stop)
      st.removeEventListener('touchmove', onTouch)
    }
  }, [])

  // Glisser = déplacer (souris, clic molette, un doigt) ; deux doigts = zoom + déplacement
  function onPointerDown(e) {
    moved.current = false
    if (e.isPrimary) ptrs.current.clear() // un nouvel appui principal : les anciens doigts sont oubliés
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

  // La fiche recouvre une partie du plan : on laisse de la marge pour pouvoir faire défiler le plan hors de sa zone
  useLayoutEffect(() => {
    const el = sheetEl.current, st = box.current
    if (!sheet || !el || !st) { setPad((p) => (p.r || p.b ? { r: 0, b: 0 } : p)); return }
    const measureSheet = () => {
      const s = st.getBoundingClientRect(), h = el.getBoundingClientRect()
      const bottom = h.width > s.width * 0.8 // fiche en bas (téléphone) ou à droite (ordinateur)
      const r = bottom ? 0 : Math.max(0, Math.round(s.right - h.left))
      const b = bottom ? Math.max(0, Math.round(s.bottom - h.top)) : 0
      setPad((p) => (p.r === r && p.b === b ? p : { r, b }))
    }
    measureSheet()
    const ro = new ResizeObserver(measureSheet)
    ro.observe(el)
    return () => ro.disconnect()
  }, [sheet, listOpen, stage.w])

  // Centre l'annotation dans la partie visible du plan (celle qui n'est pas sous la fiche)
  function centerOn(a) {
    if (!a.geometry) { focusRef.current = null; return }
    focusRef.current = a
    if (a.page !== page) setPage(a.page)
    setTick((n) => n + 1)
  }
  useLayoutEffect(() => {
    const a = focusRef.current, st = box.current
    if (!a || !st || a.page !== page) return
    const s = st.getBoundingClientRect()
    const h = sheetEl.current && sheetEl.current.getBoundingClientRect()
    let fw = s.width, fh = s.height
    if (h && h.width > 0) {
      if (h.width > s.width * 0.8) fh = Math.max(80, Math.min(s.height, h.top - s.top))
      else fw = Math.max(80, Math.min(s.width, h.left - s.left))
    }
    st.scrollLeft = a.geometry.x * W - fw / 2
    st.scrollTop = a.geometry.y * H - fh / 2
  }, [tick, pad.r, pad.b, page, W, H, stage.w])

  function openGroup(statut, name, items) {
    guard(() => openGroupNow(statut, name, items))
  }
  function openGroupNow(statut, name, items) {
    setNav({ ids: items.map((a) => a.id), i: 0, title: `${STATUTS[statut].label} · ${name}` })
    setSheet({ annot: items[0] })
    centerOn(items[0])
    if (!window.matchMedia('(min-width: 900px)').matches) setListOpen(false)
  }
  function goTo(i) {
    guard(() => goToNow(i))
  }
  function goToNow(i) {
    if (!nav) return
    const j = (i + nav.ids.length) % nav.ids.length
    const a = annots.find((x) => x.id === nav.ids[j])
    if (!a) return
    setNav({ ...nav, i: j })
    setSheet({ annot: a })
    centerOn(a)
  }
  const closeSheet = () => { setSheet(null); setNav(null) }
  const openDraft = (draft) => guard(() => { setNav(null); setSheet({ draft }) })

  async function makePreview() {
    setBuilding(true); setError('')
    try {
      const base = version.file_path.replace(/\.pdf$/, '')
      const up = async (p, blob) => {
        const r = await supabase.storage.from('plans').upload(p, blob, { contentType: 'image/jpeg', upsert: true })
        if (r.error) throw r.error
      }
      const paths = []
      let thumb = null
      for (let i = 1; i <= pdf.numPages; i++) {
        const pg = await pdf.getPage(i)
        const p = `${base}/p${i}.jpg`
        await up(p, await renderJpeg(pg, LEVELS.elevee))
        paths.push(p)
        if (i === 1) { thumb = `${base}/thumb.jpg`; await up(thumb, await renderJpeg(pg, THUMB)) }
      }
      const patch = { display_paths: paths, thumb_path: thumb, display_width: LEVELS.elevee.side }
      const r = await supabase.from('plan_versions').update(patch).eq('id', version.id)
      if (r.error) throw r.error
      setVersion({ ...version, ...patch })
      if (onChanged) onChanged()
    } catch (e) {
      setError('Création de l’aperçu impossible : ' + (e && e.message ? e.message : e))
    }
    setBuilding(false)
  }

  function placeMeasure(e) {
    if (moved.current) return
    const r = e.currentTarget.getBoundingClientRect()
    measure.addPoint((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
  }

  function placePoint(e) {
    if (moved.current) return
    const r = e.currentTarget.getBoundingClientRect()
    openDraft({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, page, photo: photoMode })
  }

  const loading = !error && (useImage ? !imgUrl : !pdf)

  return (
    <div className="viewer">
      <header>
        <button onClick={() => guard(onClose)}>Fermer</button>
        <strong>{plan.name}</strong>
        <select value={version.id} onChange={(e) => setVersion(versions.find((v) => v.id === e.target.value))}>
          {versions.map((v) => <option key={v.id} value={v.id}>Indice {v.version_label}{v.is_current ? ' (actuel)' : ''}</option>)}
        </select>
      </header>
      {(annotate || photoMode) && (
        <div className="hint">
          <span>{photoMode ? 'Touchez le plan pour placer une photo.' : 'Touchez le plan pour placer un point.'}</span>
          {annotate && <button onClick={() => openDraft({ global: true })}>Annotation globale</button>}
        </div>
      )}
      {measure.panel}
      {showDays && <DayFilter plan={plan} folders={folders} annots={annots} hidden={hidden} setHidden={setHidden} reload={reload} />}
      <div className="body">
        <div className="floattools">
          <div className="grp">
            <FabBtn label="Zoomer" onClick={() => view({ z: zoom * 1.6 })}><PlusIcon /></FabBtn>
            <button className="zoomval" title="Ajuster le plan à l’écran" onClick={fitView}>{Math.round(zoom * 100)}%</button>
            <FabBtn label="Dézoomer" onClick={() => view({ z: zoom / 1.6 })}><MinusIcon /></FabBtn>
            <FabBtn label="Ajuster le plan à l’écran" onClick={fitView}><FitIcon /></FabBtn>
          </div>
          {pages > 1 && (
            <div className="grp">
              <FabBtn label="Page précédente" disabled={page === 1} onClick={() => setPage((n) => Math.max(1, n - 1))}><ChevronUpIcon /></FabBtn>
              <span className="pageval">{page}/{pages}</span>
              <FabBtn label="Page suivante" disabled={page === pages} onClick={() => setPage((n) => Math.min(pages, n + 1))}><ChevronDownIcon /></FabBtn>
            </div>
          )}
          <div className="grp">
            <FabBtn label="Annoter : placer un point" on={annotate} onClick={() => { setAnnotate((a) => !a); setPhotoMode(false); measure.setOn(false) }}><PinIcon /></FabBtn>
            <FabBtn label="Placer une photo" on={photoMode} onClick={() => { setPhotoMode((p) => !p); setAnnotate(false); measure.setOn(false) }}><CameraIcon /></FabBtn>
            <FabBtn label="Mesurer" on={measure.on} onClick={() => { measure.setOn(!measure.on); setAnnotate(false); setPhotoMode(false) }}><RulerIcon /></FabBtn>
          </div>
          <div className="grp">
            <FabBtn label={showAnn ? 'Masquer les annotations' : 'Afficher les annotations'} onClick={() => setShowAnn((x) => !x)}>{showAnn ? <EyeIcon /> : <EyeOffIcon />}</FabBtn>
            <FabBtn label="Calques" on={showDays} onClick={() => setShowDays((x) => !x)}><LayersIcon /></FabBtn>
            <FabBtn label="Liste des annotations" on={listOpen} onClick={() => setListOpen((o) => !o)}><ListIcon /></FabBtn>
          </div>
          {(hasDisplay || pdf) && (
            <div className="grp">
              {hasDisplay && <FabBtn label={hd ? 'Haute définition active : revenir à l’aperçu' : 'Activer la haute définition'} on={hd} onClick={() => setHd((h) => !h)}><span className="hdtxt">HD</span></FabBtn>}
              {!hasDisplay && pdf && <FabBtn label="Créer l’aperçu rapide" disabled={building} onClick={makePreview}><ImageIcon /></FabBtn>}
            </div>
          )}
        </div>
      <div className="stage" ref={box} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onLostPointerCapture={onPointerUp} onMouseDown={(e) => e.button === 1 && e.preventDefault()}>
        <div className="msgwrap">
        {error && <p className="error msg">{error}</p>}
        {loading && <p className="muted msg">{useImage ? 'Chargement du plan…' : 'Chargement du PDF haute définition…'}</p>}
        {!useImage && drawing && !loading && !error && <p className="muted msg">Rendu en cours…</p>}
        {building && <p className="muted msg">Création de l’aperçu…</p>}
        </div>
        <div className="padbox" style={{ width: W + pad.r, height: H + pad.b }}>
        <div className={'sizer' + (annotate || photoMode || measure.on ? ' annotating' : '')} style={{ width: W, height: H }} onClick={annotate || photoMode ? placePoint : measure.on ? placeMeasure : undefined}>
          {hasDisplay && imgUrl && <img src={imgUrl} alt={plan.name} />}
          {!useImage && <canvas ref={canvas} />}
          {measure.overlay}
          {showAnn && <Markers annots={annots} hidden={hidden} page={page} activeId={sheet && sheet.annot ? sheet.annot.id : null} onSelect={(a) => guard(() => { setNav(null); setSheet({ annot: a }); centerOn(a) })} />}
        </div>
        </div>
      </div>
      {listOpen && (
        <aside className="side">
          <div className="top"><strong>Annotations</strong><button onClick={() => setListOpen(false)}>Fermer</button></div>
          <AnnotationList annots={annots} probs={probs} hidden={hidden} onOpen={openGroup}
            onGlobal={() => { openDraft({ global: true }); if (!window.matchMedia('(min-width: 900px)').matches) setListOpen(false) }} />
        </aside>
      )}
      {sheet && (
        <AnnotationSheet key={sheet.annot ? sheet.annot.id : 'new' + JSON.stringify(sheet.draft)} plan={plan} version={version} draft={sheet.draft} annot={sheet.annot} folders={folders} probs={probs} activeFolder={activeFolder} onLayer={setActiveFolder} reload={reload}
          nav={nav && { title: nav.title, index: nav.i, total: nav.ids.length, onPrev: () => goTo(nav.i - 1), onNext: () => goTo(nav.i + 1) }}
          rootRef={sheetEl} dirtyRef={dirtyRef} onClose={() => guard(closeSheet)} onSaved={() => { dirtyRef.current = false; closeSheet(); reload() }} />
      )}
      </div>
    </div>
  )
}
