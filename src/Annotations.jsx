import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { fetchPlan } from './cache.js'
import { compressPhoto } from './photo.js'

export const COLORS = { rouge: '#d62828', orange: '#f77f00', bleu: '#1d6fd1', vert: '#2a9d4a' }
const URGENCY = { low: 'Faible', normal: 'Normale', high: 'Urgente' }
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
    if (f.data) setFolders(f.data)
  }, [plan.id, version.id])
  useEffect(() => { reload() }, [reload])
  return { annots, folders, reload }
}

export function Markers({ annots, hidden, page, onSelect }) {
  return annots.filter((a) => a.page === page && !hidden.has(a.folder_id)).map((a) => (
    <button key={a.id} className={'marker' + (a.urgency === 'high' ? ' high' : '')} aria-label="Annotation"
      style={{ left: a.geometry.x * 100 + '%', top: a.geometry.y * 100 + '%', background: COLORS[a.color] || '#d62828' }}
      onClick={(e) => { e.stopPropagation(); onSelect(a) }}>{a.urgency === 'high' ? '!' : ''}</button>
  ))
}

export function DayFilter({ folders, annots, hidden, setHidden }) {
  if (folders.length === 0) return <p className="hint">Aucun dossier d’annotations pour ce plan.</p>
  const toggle = (id) => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n })
  return (
    <div className="days">
      {folders.map((f) => (
        <label key={f.id} className="check">
          <input type="checkbox" checked={!hidden.has(f.id)} onChange={() => toggle(f.id)} />
          {dayLabel(f.folder_date)} ({annots.filter((a) => a.folder_id === f.id).length})
        </label>
      ))}
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

export function AnnotationSheet({ plan, version, draft, annot, onClose, onSaved }) {
  const [note, setNote] = useState(annot ? annot.note || '' : '')
  const [color, setColor] = useState(annot ? annot.color : 'rouge')
  const [urgency, setUrgency] = useState(annot ? annot.urgency : 'normal')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const photos = annot ? annot.annotation_photos.filter((p) => !p.deleted_at) : []

  async function getFolder() {
    const day = today()
    const find = () => supabase.from('annotation_folders').select('id').eq('plan_id', plan.id).eq('folder_date', day).maybeSingle()
    let r = await find()
    if (r.data) return r.data.id
    const id = crypto.randomUUID()
    const ins = await supabase.from('annotation_folders').insert({ id, project_id: plan.project_id, plan_id: plan.id, folder_date: day })
    if (!ins.error) return id
    r = await find()
    if (!r.data) throw ins.error
    return r.data.id
  }

  async function save() {
    setBusy(true); setError('')
    try {
      const id = annot ? annot.id : crypto.randomUUID()
      const text = note.trim() || null
      if (annot) {
        const r = await supabase.from('annotations').update({ note: text, color, urgency }).eq('id', id)
        if (r.error) throw r.error
      } else {
        const r = await supabase.from('annotations').insert({
          id, project_id: plan.project_id, folder_id: await getFolder(), plan_version_id: version.id,
          page: draft.page, kind: 'point', color, urgency, geometry: { x: draft.x, y: draft.y }, note: text,
        })
        if (r.error) throw r.error
      }
      for (const f of files) {
        const blob = await compressPhoto(f)
        const path = `${plan.project_id}/${id}/${crypto.randomUUID()}.jpg`
        const up = await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' })
        if (up.error) throw up.error
        const ph = await supabase.from('annotation_photos').insert({ project_id: plan.project_id, annotation_id: id, file_path: path })
        if (ph.error) throw ph.error
      }
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
      <div className="swatches">
        {Object.entries(COLORS).map(([k, c]) => (
          <button key={k} type="button" aria-label={k} className={'swatch' + (color === k ? ' on' : '')} style={{ background: c }} onClick={() => setColor(k)} />
        ))}
      </div>
      <label>Urgence
        <select value={urgency} onChange={(e) => setUrgency(e.target.value)}>
          {Object.entries(URGENCY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      {photos.length > 0 && <div className="photos">{photos.map((p) => <Photo key={p.id} path={p.file_path} />)}</div>}
      <label>Ajouter des photos
        <input type="file" accept="image/*" multiple onChange={(e) => setFiles([...e.target.files])} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        {annot && <button className="danger" disabled={busy} onClick={remove}>Supprimer</button>}
      </div>
    </div>
  )
}
