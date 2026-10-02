import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { fetchPlan } from './cache.js'
import { IconButton, TrashIcon, PencilIcon } from './ui.jsx'
import { loadBitmap, centerCrop, squareJpeg } from './photo.js'

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
  const reload = useCallback(async () => {
    const [a, f] = await Promise.all([
      supabase.from('annotations').select('*, annotation_photos(*)').eq('plan_version_id', version.id).is('deleted_at', null).order('created_at'),
      supabase.from('annotation_folders').select('*').eq('plan_id', plan.id).order('folder_date', { ascending: false }),
    ])
    if (a.data) setAnnots(a.data)
    if (f.data) setFolders([...f.data].sort((x, y) => layerName(x).localeCompare(layerName(y), 'fr', { numeric: true })))
  }, [plan.id, version.id])
  useEffect(() => { reload() }, [reload])
  return { annots, folders, reload }
}

export function Markers({ annots, hidden, page, onSelect }) {
  return annots.filter((a) => a.page === page && !hidden.has(a.folder_id)).map((a) => (
    <button key={a.id} className="marker" aria-label="Annotation"
      style={{ left: a.geometry.x * 100 + '%', top: a.geometry.y * 100 + '%', background: (STATUTS[a.color] || STATUTS.rouge).color }}
      onClick={(e) => { e.stopPropagation(); onSelect(a) }} />
  ))
}

const layerName = (f) => f.name || 'Visite du ' + dayLabel(f.folder_date)

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

export function AnnotationList({ annots, folders, hidden, onSelect }) {
  const shown = annots.filter((a) => !hidden.has(a.folder_id))
  const layer = (id) => { const f = folders.find((x) => x.id === id); return f ? layerName(f) : '' }
  return (
    <div className="annlist">
      {Object.entries(STATUTS).map(([k, s]) => {
        const list = shown
          .filter((a) => (STATUTS[a.color] ? a.color : 'rouge') === k)
          .sort((a, b) => layer(a.folder_id).localeCompare(layer(b.folder_id), 'fr', { numeric: true }))
        return (
          <section key={k}>
            <h3 style={{ '--c': s.color }}><i />{s.label} ({list.length})</h3>
            {list.length === 0 ? <p className="muted">Aucune</p> : list.map((a) => {
              const n = a.annotation_photos.filter((p) => !p.deleted_at).length
              return (
                <button key={a.id} className="annrow" onClick={() => onSelect(a)}>
                  <strong>{a.note || 'Sans remarque'}</strong>
                  <small>{layer(a.folder_id)} · page {a.page}{n ? ` · ${n} photo${n > 1 ? 's' : ''}` : ''}</small>
                </button>
              )
            })}
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

function PhotoPicker({ items, setItems }) {
  const [queue, setQueue] = useState([])
  const [edit, setEdit] = useState(null)
  const add = (src, blob) => setItems((l) => [...l, { id: crypto.randomUUID(), src, blob, url: URL.createObjectURL(blob) }])

  async function fromCamera(e) {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f) return
    const bmp = await loadBitmap(f)
    add(f, await squareJpeg(bmp, centerCrop(bmp))) // photo prise : carré centré automatique
  }
  function fromGallery(e) {
    setQueue([...e.target.files])
    e.target.value = ''
  }
  const current = edit ? edit.file : queue[0]

  return (
    <>
      <div className="row">
        <label className="btn">Prendre une photo<input type="file" accept="image/*" capture="environment" hidden onChange={fromCamera} /></label>
        <label className="btn">Importer des photos<input type="file" accept="image/*" multiple hidden onChange={fromGallery} /></label>
      </div>
      {items.length > 0 && (
        <div className="photos">
          {items.map((it) => (
            <div key={it.id} className="pending">
              <img src={it.url} alt="" onClick={() => setEdit({ id: it.id, file: it.src })} />
              <button type="button" aria-label="Retirer la photo" onClick={() => setItems((l) => l.filter((x) => x.id !== it.id))}><TrashIcon /></button>
            </div>
          ))}
        </div>
      )}
      {current && (
        <CropDialog file={current}
          onCancel={() => (edit ? setEdit(null) : setQueue((q) => q.slice(1)))}
          onDone={(blob) => {
            if (edit) { setItems((l) => l.map((x) => (x.id === edit.id ? { ...x, blob, url: URL.createObjectURL(blob) } : x))); setEdit(null) }
            else { add(queue[0], blob); setQueue((q) => q.slice(1)) }
          }} />
      )}
    </>
  )
}

export function AnnotationSheet({ plan, version, draft, annot, folders, activeFolder, onLayer, reload, onClose, onSaved }) {
  const [note, setNote] = useState(annot ? annot.note || '' : '')
  const [color, setColor] = useState(annot && STATUTS[annot.color] ? annot.color : 'rouge')
  const [items, setItems] = useState([])
  const [folderId, setFolderId] = useState(annot ? annot.folder_id : (folders.some((f) => f.id === activeFolder) ? activeFolder : (folders[0] && folders[0].id) || ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const photos = annot ? annot.annotation_photos.filter((p) => !p.deleted_at) : []

  async function save() {
    setBusy(true); setError('')
    try {
      const id = annot ? annot.id : crypto.randomUUID()
      const text = note.trim() || null
      const fid = folderId || (await createLayer(plan, 'Calque 1'))
      if (annot) {
        const r = await supabase.from('annotations').update({ note: text, color, folder_id: fid }).eq('id', id)
        if (r.error) throw r.error
      } else {
        const r = await supabase.from('annotations').insert({
          id, project_id: plan.project_id, folder_id: fid, plan_version_id: version.id,
          page: draft.page, kind: 'point', color, geometry: { x: draft.x, y: draft.y }, note: text,
        })
        if (r.error) throw r.error
      }
      for (const { blob } of items) {
        const path = `${plan.project_id}/${id}/${crypto.randomUUID()}.jpg`
        const up = await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' })
        if (up.error) throw up.error
        const ph = await supabase.from('annotation_photos').insert({ project_id: plan.project_id, annotation_id: id, file_path: path })
        if (ph.error) throw ph.error
      }
      onLayer(fid)
      onSaved()
    } catch (e) {
      setError(e.message || 'Enregistrement impossible.')
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm('Supprimer cette annotation ?')) return
    setBusy(true)
    const r = await supabase.from('annotations').update({ deleted_at: new Date().toISOString() }).eq('id', annot.id)
    if (r.error) { setError('Suppression impossible.'); setBusy(false); return }
    onSaved()
  }

  return (
    <div className="sheet">
      <div className="top"><strong>{annot ? 'Annotation' : 'Nouvelle annotation'}</strong><button onClick={onClose}>Fermer</button></div>
      <label>Remarque<textarea rows="3" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="statuts">
        {Object.entries(STATUTS).map(([k, s]) => (
          <button key={k} type="button" className={'statut' + (color === k ? ' on' : '')} style={{ '--c': s.color }} onClick={() => setColor(k)}>
            <i />{s.label}
          </button>
        ))}
      </div>
      {photos.length > 0 && <div className="photos">{photos.map((p) => <Photo key={p.id} path={p.file_path} />)}</div>}
      <label>Calque
        <select value={folderId} onChange={async (e) => {
          if (e.target.value !== '__new') { setFolderId(e.target.value); return }
          const n = window.prompt('Nom du nouveau calque')
          if (!n || !n.trim()) return
          try { const id = await createLayer(plan, n.trim()); await reload(); setFolderId(id) } catch { setError('Création du calque impossible.') }
        }}>
          {folders.length === 0 && <option value="">Calque 1 (créé à l’enregistrement)</option>}
          {folders.map((f) => <option key={f.id} value={f.id}>{layerName(f)}</option>)}
          <option value="__new">+ Nouveau calque…</option>
        </select>
      </label>
      <PhotoPicker items={items} setItems={setItems} />
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        {annot && <IconButton label="Supprimer l’annotation" danger disabled={busy} onClick={remove}><TrashIcon /></IconButton>}
      </div>
    </div>
  )
}
