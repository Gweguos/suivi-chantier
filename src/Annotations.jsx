import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { fetchPlan } from './cache.js'
import { IconButton, TrashIcon, PencilIcon, CameraIcon } from './ui.jsx'
import { loadBitmap, centerCrop, squareJpeg } from './photo.js'
import { SuggestionChips, SuggestionsManager } from './Suggestions.jsx'

export const STATUTS = {
  rouge: { label: 'À reprendre', color: '#d62828' },
  bleu: { label: 'Demande d’information', color: '#1d6fd1' },
  vert: { label: 'Conforme', color: '#2a9d4a' },
}
const pad = (n) => String(n).padStart(2, '0')
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const dayLabel = (s) => new Date(s + 'T12:00:00').toLocaleDateString('fr-FR')

export function useAnnotations(plan, version) {
  const [annots, setAnnots] = useState([])
  const [folders, setFolders] = useState([])
  const [probs, setProbs] = useState([])
  const reload = useCallback(async () => {
    const [a, f, p] = await Promise.all([
      supabase.from('annotations').select('*, annotation_photos(*)').eq('plan_version_id', version.id).is('deleted_at', null).order('created_at'),
      supabase.from('annotation_folders').select('*').eq('plan_id', plan.id),
      supabase.from('problematiques').select('*').or(`project_id.is.null,project_id.eq.${plan.project_id}`),
    ])
    if (a.data) setAnnots(a.data)
    if (f.data) setFolders([...f.data].sort((x, y) => layerName(x).localeCompare(layerName(y), 'fr', { numeric: true })))
    if (p.data) setProbs([...p.data].sort((x, y) => x.name.localeCompare(y.name, 'fr')))
  }, [plan.id, plan.project_id, version.id])
  useEffect(() => { reload() }, [reload])
  // mises à jour locales immédiates (la fiche enregistre toute seule)
  const patch = useCallback((id, row) => setAnnots((l) => (l.some((a) => a.id === id) ? l.map((a) => (a.id === id ? { ...a, ...row } : a)) : [...l, { ...row, id }])), [])
  const drop = useCallback((id) => setAnnots((l) => l.filter((a) => a.id !== id)), [])
  return { annots, folders, probs, reload, patch, drop }
}

export function Markers({ annots, hidden, page, activeId, onSelect }) {
  return annots.filter((a) => a.geometry && a.page === page && !hidden.has(a.folder_id)).map((a) => {
    const pos = { left: a.geometry.x * 100 + '%', top: a.geometry.y * 100 + '%' }
    const click = (e) => { e.stopPropagation(); onSelect(a) }
    return a.kind === 'photo' ? (
      <button key={a.id} className={'marker photo' + (a.id === activeId ? ' active' : '')} aria-label="Photos" style={pos} onClick={click}><CameraIcon width="16" height="16" /></button>
    ) : (
      <button key={a.id} className={'marker' + (a.id === activeId ? ' active' : '')} aria-label="Annotation" style={{ ...pos, background: (STATUTS[a.color] || STATUTS.rouge).color }} onClick={click} />
    )
  })
}

const layerName = (f) => f.name || 'Visite du ' + dayLabel(f.folder_date)

async function createProb(plan, name) {
  const id = crypto.randomUUID()
  const r = await supabase.from('problematiques').insert({ id, project_id: plan.project_id, name })
  if (r.error) throw r.error
  return id
}

async function createLayer(plan, name) {
  const id = crypto.randomUUID()
  const r = await supabase.from('annotation_folders').insert({ id, project_id: plan.project_id, plan_id: plan.id, name })
  if (r.error) throw r.error
  return id
}

export function DayFilter({ plan, folders, annots, hidden, setHidden, reload }) {
  const toggle = (id) => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n })
  async function rename(f) {
    const n = window.prompt('Nom du calque', layerName(f))
    if (!n || !n.trim()) return
    await supabase.from('annotation_folders').update({ name: n.trim() }).eq('id', f.id)
    reload()
  }
  async function remove(f) {
    const n = annots.filter((a) => a.folder_id === f.id).length
    if (!window.confirm(`Supprimer le calque « ${layerName(f)} » ?${n ? ` Ses annotations (${n} sur cette version) seront aussi supprimées.` : ''}`)) return
    const r = await supabase.from('annotation_folders').delete().eq('id', f.id).select()
    if (r.error || !r.data.length) window.alert('Suppression impossible : réservée aux administrateurs du projet.')
    reload()
  }
  async function add() {
    const n = window.prompt('Nom du nouveau calque')
    if (!n || !n.trim()) return
    try { await createLayer(plan, n.trim()); reload() } catch { window.alert('Création du calque impossible.') }
  }
  return (
    <div className="days">
      {folders.length === 0 && <p className="muted">Aucun calque : le premier sera créé avec votre première annotation.</p>}
      {folders.map((f) => (
        <div key={f.id} className="visit">
          <label className="check">
            <input type="checkbox" checked={!hidden.has(f.id)} onChange={() => toggle(f.id)} />
            {layerName(f)} ({annots.filter((a) => a.folder_id === f.id).length})
          </label>
          <IconButton label="Renommer le calque" onClick={() => rename(f)}><PencilIcon /></IconButton>
          <IconButton label="Supprimer le calque" danger onClick={() => remove(f)}><TrashIcon /></IconButton>
        </div>
      ))}
      <button onClick={add}>Nouveau calque</button>
    </div>
  )
}

export function AnnotationList({ annots, probs, hidden, onOpen, onGlobal }) {
  const shown = annots.filter((a) => a.kind !== 'photo' && !hidden.has(a.folder_id))
  const probName = (id) => (id ? (probs.find((p) => p.id === id) || {}).name || 'Problématique' : 'Générale')
  return (
    <div className="annlist">
      <button onClick={onGlobal}>+ Annotation globale</button>
      {shown.length === 0 && <p className="muted">Aucune annotation.</p>}
      {Object.entries(STATUTS).map(([k, s]) => {
        const list = shown.filter((a) => (STATUTS[a.color] ? a.color : 'rouge') === k)
        const byProb = {}
        for (const a of list) (byProb[a.problematique_id || ''] ||= []).push(a)
        const groups = Object.entries(byProb)
          .map(([key, items]) => ({ key, name: probName(key), items }))
          .sort((x, y) => (x.key === '' ? -1 : y.key === '' ? 1 : x.name.localeCompare(y.name, 'fr')))
        return (
          <section key={k}>
            <h3 style={{ '--c': s.color }}><i />{s.label} ({list.length})</h3>
            {groups.length === 0 ? <p className="muted">Aucune</p> : groups.map((g) => (
              <button key={g.key || 'generale'} className="annrow pr" onClick={() => onOpen(k, g.name, g.items)}>
                <strong>{g.name}</strong><span className="count">{g.items.length}</span>
              </button>
            ))}
          </section>
        )
      })}
    </div>
  )
}

function Photo({ path }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let u, off = false
    fetchPlan(path, 'photos').then((b) => { if (!off) { u = URL.createObjectURL(b); setUrl(u) } }).catch(() => {})
    return () => { off = true; if (u) URL.revokeObjectURL(u) }
  }, [path])
  return url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" /></a> : <div className="ph" />
}

function CropDialog({ file, onDone, onCancel }) {
  const F = 300
  const cv = useRef(null)
  const drag = useRef(null)
  const [bmp, setBmp] = useState(null)
  const [z, setZ] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const k = bmp ? (F / Math.min(bmp.width, bmp.height)) * z : 1

  useEffect(() => {
    let off = false
    loadBitmap(file).then((b) => {
      if (off) return
      const k0 = F / Math.min(b.width, b.height)
      setBmp(b); setZ(1); setPos({ x: (F - b.width * k0) / 2, y: (F - b.height * k0) / 2 })
    })
    return () => { off = true }
  }, [file])

  const clamp = (p, kk) => ({ x: Math.min(0, Math.max(F - bmp.width * kk, p.x)), y: Math.min(0, Math.max(F - bmp.height * kk, p.y)) })

  useEffect(() => {
    if (!bmp) return
    const c = cv.current, ctx = c.getContext('2d'), d = c.width / F
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, pos.x * d, pos.y * d, bmp.width * k * d, bmp.height * k * d)
  }, [bmp, k, pos])

  function zoomTo(nz) {
    const k2 = (F / Math.min(bmp.width, bmp.height)) * nz
    const cx = (F / 2 - pos.x) / k, cy = (F / 2 - pos.y) / k
    setZ(nz)
    setPos(clamp({ x: F / 2 - cx * k2, y: F / 2 - cy * k2 }, k2))
  }

  return (
    <div className="modal">
      <div className="modalbox">
        <strong>Rogner la photo (carré)</strong>
        <canvas ref={cv} width={F * 2} height={F * 2} style={{ width: F, height: F, touchAction: 'none' }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, p: pos } }}
          onPointerMove={(e) => { if (drag.current && bmp) setPos(clamp({ x: drag.current.p.x + e.clientX - drag.current.x, y: drag.current.p.y + e.clientY - drag.current.y }, k)) }}
          onPointerUp={() => { drag.current = null }} />
        <label>Zoom<input type="range" min="1" max="4" step="0.05" value={z} disabled={!bmp} onChange={(e) => zoomTo(Number(e.target.value))} /></label>
        <p className="muted">Faites glisser la photo pour la cadrer.</p>
        <div className="row">
          <button className="primary" disabled={!bmp} onClick={async () => onDone(await squareJpeg(bmp, { sx: -pos.x / k, sy: -pos.y / k, size: F / k }))}>Valider</button>
          <button onClick={onCancel}>Annuler</button>
        </div>
      </div>
    </div>
  )
}

function PhotoPicker({ onAdd, uploading }) {
  const [queue, setQueue] = useState([])

  async function fromCamera(e) {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f) return
    const bmp = await loadBitmap(f)
    onAdd(await squareJpeg(bmp, centerCrop(bmp))) // photo prise : carré centré automatique
  }
  function fromGallery(e) {
    setQueue([...e.target.files])
    e.target.value = ''
  }

  return (
    <>
      <div className="row">
        <label className="btn">Prendre une photo<input type="file" accept="image/*" capture="environment" hidden onChange={fromCamera} /></label>
        <label className="btn">Importer des photos<input type="file" accept="image/*" multiple hidden onChange={fromGallery} /></label>
      </div>
      {uploading > 0 && <p className="muted">Envoi de {uploading} photo{uploading > 1 ? 's' : ''}…</p>}
      {queue[0] && (
        <CropDialog file={queue[0]}
          onCancel={() => setQueue((q) => q.slice(1))}
          onDone={(blob) => { onAdd(blob); setQueue((q) => q.slice(1)) }} />
      )}
    </>
  )
}

// Fiche d'annotation : tout s'enregistre automatiquement
export function AnnotationSheet({ sugg, plan, version, draft, annot, folders, probs, nav, rootRef, activeFolder, onLayer, reload, patch, drop, onClose }) {
  const [note, setNote] = useState(annot ? annot.note || '' : '')
  const [color, setColor] = useState(annot && STATUTS[annot.color] ? annot.color : 'rouge')
  const isPhoto = annot ? annot.kind === 'photo' : !!(draft && draft.photo)
  const [probId, setProbId] = useState(annot && annot.problematique_id ? annot.problematique_id : '')
  const [folderId, setFolderId] = useState(annot ? annot.folder_id : (folders.some((f) => f.id === activeFolder) ? activeFolder : (folders[0] && folders[0].id) || ''))
  const [photos, setPhotos] = useState(annot ? annot.annotation_photos.filter((p) => !p.deleted_at) : [])
  const [uploading, setUploading] = useState(0)
  const [status, setStatus] = useState('') // '', 'saving', 'saved'
  const [error, setError] = useState('')
  const [managing, setManaging] = useState(false)
  const noteRef = useRef(null)

  const id = useRef(annot ? annot.id : crypto.randomUUID())
  const exists = useRef(!!annot)
  const removed = useRef(false)
  const latest = useRef({})
  latest.current = { note, color, probId, folderId }
  const photosRef = useRef(photos)
  const timer = useRef(null)
  const chain = useRef(Promise.resolve())
  const fresh = useRef({ patch, drop, onLayer, plan, version, draft, isPhoto })
  fresh.current = { patch, drop, onLayer, plan, version, draft, isPhoto }

  // Enregistre l'état courant de la fiche (crée l'annotation à la première modification)
  async function doSave(force) {
    const f = fresh.current
    if (removed.current) return
    if (!exists.current && f.isPhoto && !force) return // un repère photo n'existe qu'avec une photo
    const v = latest.current
    setStatus('saving'); setError('')
    try {
      const fid = v.folderId || (await createLayer(f.plan, 'Calque 1'))
      if (!v.folderId) setFolderId(fid)
      const fields = f.isPhoto ? { folder_id: fid } : { note: v.note.trim() || null, color: v.color, folder_id: fid, problematique_id: v.probId || null }
      if (exists.current) {
        const r = await supabase.from('annotations').update(fields).eq('id', id.current)
        if (r.error) throw r.error
        f.patch(id.current, fields)
      } else {
        const row = {
          id: id.current, project_id: f.plan.project_id, plan_version_id: f.version.id,
          page: f.draft.page || 1, kind: f.draft.global ? 'global' : f.isPhoto ? 'photo' : 'point', color: v.color,
          geometry: f.draft.global ? null : { x: f.draft.x, y: f.draft.y }, ...fields, ...(f.isPhoto ? { note: null, problematique_id: null } : {}),
        }
        const r = await supabase.from('annotations').insert(row)
        if (r.error) throw r.error
        exists.current = true
        f.patch(id.current, { ...row, annotation_photos: photosRef.current, created_at: new Date().toISOString(), deleted_at: null })
      }
      f.onLayer(fid)
      setStatus('saved')
    } catch (e) {
      setStatus(''); setError(e.message || 'Enregistrement impossible.')
    }
  }
  const enqueue = (force) => { chain.current = chain.current.then(() => doSave(force)); return chain.current }
  const schedule = (delay) => { clearTimeout(timer.current); timer.current = setTimeout(() => { timer.current = null; enqueue(false) }, delay) }

  // en quittant la fiche (changement d'annotation, fermeture) : enregistre ce qui est en attente
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; enqueue(false) }
  }, [])

  const changeNote = (v) => { setNote(v); latest.current = { ...latest.current, note: v }; schedule(700) }
  const changeColor = (v) => { setColor(v); latest.current = { ...latest.current, color: v }; schedule(150) }
  const changeProb = (v) => { setProbId(v); latest.current = { ...latest.current, probId: v }; schedule(150) }
  const changeFolder = (v) => { setFolderId(v); latest.current = { ...latest.current, folderId: v }; schedule(150) }

  // insère une suggestion à l'endroit du curseur
  function pickSuggestion(t) {
    const el = noteRef.current
    const a = el ? el.selectionStart : note.length, b = el ? el.selectionEnd : note.length
    const before = note.slice(0, a), after = note.slice(b)
    const lead = before && !/\s$/.test(before) ? ' ' : ''
    changeNote(before + lead + t + after)
    const pos = (before + lead + t).length
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(pos, pos) } })
  }

  async function addPhoto(blob) {
    setUploading((n) => n + 1); setError('')
    try {
      if (!exists.current) { clearTimeout(timer.current); timer.current = null; await enqueue(true) }
      if (!exists.current) throw new Error('Enregistrement de l’annotation impossible.')
      const path = `${fresh.current.plan.project_id}/${id.current}/${crypto.randomUUID()}.jpg`
      const up = await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' })
      if (up.error) throw up.error
      const ph = await supabase.from('annotation_photos').insert({ project_id: fresh.current.plan.project_id, annotation_id: id.current, file_path: path }).select().single()
      if (ph.error) throw ph.error
      photosRef.current = [...photosRef.current, ph.data]
      setPhotos(photosRef.current)
      fresh.current.patch(id.current, { annotation_photos: photosRef.current })
      setStatus('saved')
    } catch (e) {
      setError(e.message || 'Envoi de la photo impossible.')
    }
    setUploading((n) => n - 1)
  }

  async function removePhoto(ph) {
    if (!window.confirm('Supprimer cette photo ?')) return
    const r = await supabase.from('annotation_photos').update({ deleted_at: new Date().toISOString() }).eq('id', ph.id)
    if (r.error) { setError('Suppression de la photo impossible.'); return }
    photosRef.current = photosRef.current.filter((x) => x.id !== ph.id)
    setPhotos(photosRef.current)
    fresh.current.patch(id.current, { annotation_photos: photosRef.current.map((x) => x) })
  }

  async function remove() {
    if (!window.confirm('Supprimer cette annotation ?')) return
    removed.current = true
    clearTimeout(timer.current); timer.current = null
    const r = await supabase.from('annotations').update({ deleted_at: new Date().toISOString() }).eq('id', id.current)
    if (r.error) { removed.current = false; setError('Suppression impossible.'); return }
    fresh.current.drop(id.current)
    onClose()
  }

  return (
    <div className="sheet" ref={rootRef}>
      <div className="top">
        {nav ? (
          <div className="navbar">
            <button aria-label="Annotation précédente" onClick={nav.onPrev} disabled={nav.total < 2}>‹</button>
            <strong>{nav.title}</strong>
            <span>{nav.index + 1} / {nav.total}</span>
            <button aria-label="Annotation suivante" onClick={nav.onNext} disabled={nav.total < 2}>›</button>
          </div>
        ) : (
          <strong>{isPhoto ? 'Photos' : annot || exists.current ? 'Annotation' : draft && draft.global ? 'Annotation globale' : 'Nouvelle annotation'}</strong>
        )}
        <span className="savestate">{status === 'saving' ? 'Enregistrement…' : status === 'saved' ? 'Enregistré' : ''}</span>
        <button onClick={onClose}>Fermer</button>
      </div>
      {!isPhoto && (
        <label>Problématique
          <select value={probId} onChange={async (e) => {
            if (e.target.value !== '__new') { changeProb(e.target.value); return }
            const n = window.prompt('Nom de la nouvelle problématique (propre à ce projet)')
            if (!n || !n.trim()) return
            try { const nid = await createProb(plan, n.trim()); await reload(); changeProb(nid) } catch { setError('Création de la problématique impossible.') }
          }}>
            <option value="">Générale</option>
            {probs.map((p) => <option key={p.id} value={p.id}>{p.name}{p.project_id ? ' (projet)' : ''}</option>)}
            <option value="__new">+ Nouvelle problématique…</option>
          </select>
        </label>
      )}
      {!isPhoto && (
      <div className="statuts">
        {Object.entries(STATUTS).map(([k, s]) => (
          <button key={k} type="button" className={'statut' + (color === k ? ' on' : '')} style={{ '--c': s.color }} onClick={() => changeColor(k)}>
            <i />{s.label}
          </button>
        ))}
      </div>
      )}
      {!isPhoto && <label>Commentaire<textarea ref={noteRef} rows="2" value={note} onChange={(e) => changeNote(e.target.value)} /></label>}
      {!isPhoto && sugg && <SuggestionChips sugg={sugg} probId={probId} note={note} onPick={pickSuggestion} onManage={() => setManaging(true)} />}
      {managing && <SuggestionsManager sugg={sugg} probs={probs} initialProb={probId} onClose={() => setManaging(false)} />}
      {photos.length > 0 && (
        <div className="photos">
          {photos.map((p) => (
            <div key={p.id} className="pending">
              <Photo path={p.file_path} />
              <button type="button" aria-label="Supprimer la photo" onClick={() => removePhoto(p)}><TrashIcon /></button>
            </div>
          ))}
        </div>
      )}
      <label>Calque
        <select value={folderId} onChange={async (e) => {
          if (e.target.value !== '__new') { changeFolder(e.target.value); return }
          const n = window.prompt('Nom du nouveau calque')
          if (!n || !n.trim()) return
          try { const nid = await createLayer(plan, n.trim()); await reload(); changeFolder(nid) } catch { setError('Création du calque impossible.') }
        }}>
          {folders.length === 0 && <option value="">Calque 1 (créé automatiquement)</option>}
          {folders.map((f) => <option key={f.id} value={f.id}>{layerName(f)}</option>)}
          <option value="__new">+ Nouveau calque…</option>
        </select>
      </label>
      <PhotoPicker onAdd={addPhoto} uploading={uploading} />
      {error && <p className="error">{error}</p>}
      {(annot || exists.current) && (
        <div className="row">
          <IconButton label="Supprimer l’annotation" danger onClick={remove}><TrashIcon /></IconButton>
        </div>
      )}
    </div>
  )
}
