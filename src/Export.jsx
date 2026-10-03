import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { fetchPlan } from './cache.js'
import { STATUTS } from './Annotations.jsx'
import { buildWord } from './exportWord.js'
import { nomRedacteur } from './redacteurs.js'
import logoUrl from './assets/logo-altia.png?url'

const pad = (n) => String(n).padStart(2, '0')
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const layerName = (f) => f.name || 'Visite du ' + new Date(f.folder_date + 'T12:00:00').toLocaleDateString('fr-FR')
const ORDER = { rouge: 0, bleu: 1, vert: 2 }
const cmp = (a, b) => a.localeCompare(b, 'fr', { numeric: true })
const store = {
  get: (k) => { try { return localStorage.getItem(k) || '' } catch { return '' } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignoré */ } },
}

// Photo réduite (carré 480 px) pour garder un fichier Word léger
async function smallJpeg(path) {
  const bmp = await createImageBitmap(await fetchPlan(path, 'photos'), { imageOrientation: 'from-image' })
  const size = Math.min(bmp.width, bmp.height)
  const side = Math.min(480, size)
  const c = document.createElement('canvas')
  c.width = c.height = side
  c.getContext('2d').drawImage(bmp, (bmp.width - size) / 2, (bmp.height - size) / 2, size, size, 0, 0, side, side)
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8))
  return new Uint8Array(await blob.arrayBuffer())
}

export default function ExportDialog({ project, plans, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [author, setAuthor] = useState({ name: '', email: '' })
  const [dateIso, setDateIso] = useState(todayIso())
  const [dossier, setDossier] = useState(store.get('dossier:' + project.id))
  const [offPlans, setOffPlans] = useState(new Set())
  const [offStatuts, setOffStatuts] = useState(new Set())
  const [offLayers, setOffLayers] = useState(new Set())

  const current = useMemo(() => plans.map((p) => ({ plan: p, version: p.plan_versions.find((v) => v.is_current) || p.plan_versions[0] })).filter((x) => x.version), [plans])

  useEffect(() => {
    let off = false
    ;(async () => {
      const { data: u } = await supabase.auth.getUser()
      const email = (u && u.user && u.user.email) || ''
      if (!off) setAuthor({ email, name: nomRedacteur(email) })
      const ids = current.map((x) => x.version.id)
      const [a, f, p] = await Promise.all([
        supabase.from('annotations').select('*, annotation_photos(*)').eq('project_id', project.id).in('plan_version_id', ids).is('deleted_at', null).order('created_at'),
        supabase.from('annotation_folders').select('*').eq('project_id', project.id),
        supabase.from('problematiques').select('*').or(`project_id.is.null,project_id.eq.${project.id}`),
      ])
      if (off) return
      if (a.error || f.error || p.error) { setError('Impossible de charger les annotations.'); return }
      setData({ annots: a.data, folders: f.data, probs: p.data })
    })()
    return () => { off = true }
  }, [])

  const versionPlan = useMemo(() => Object.fromEntries(current.map((x) => [x.version.id, x.plan.id])), [current])
  const folderById = useMemo(() => Object.fromEntries((data ? data.folders : []).map((f) => [f.id, f])), [data])
  const layerOf = (a) => (folderById[a.folder_id] ? layerName(folderById[a.folder_id]) : '—')

  // annotations des plans cochés : sert aux listes de calques et aux compteurs
  const inPlans = useMemo(() => (data ? data.annots.filter((a) => !offPlans.has(versionPlan[a.plan_version_id])) : []), [data, offPlans, versionPlan])
  const layers = useMemo(() => {
    const m = new Map()
    inPlans.forEach((a) => { const n = layerOf(a); m.set(n, (m.get(n) || 0) + 1) })
    return [...m.entries()].sort((x, y) => cmp(x[0], y[0]))
  }, [inPlans, folderById])
  const selected = useMemo(() => inPlans.filter((a) => !offStatuts.has(a.color) && !offLayers.has(layerOf(a))), [inPlans, offStatuts, offLayers, folderById])
  const countPlan = (id) => (data ? data.annots.filter((a) => versionPlan[a.plan_version_id] === id).length : 0)
  const countStatut = (s) => inPlans.filter((a) => a.color === s).length

  const toggle = (set, setSet, k) => setSet((o) => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n })

  async function generate() {
    setError('')
    try {
      store.set('dossier:' + project.id, dossier)
      const probName = (a) => (a.problematique_id ? (data.probs.find((p) => p.id === a.problematique_id) || {}).name || 'Composant' : 'Générale')
      const sorted = selected.map((a) => ({ a, prob: probName(a), layer: layerOf(a) })).sort((x, y) =>
        (x.prob === 'Générale' ? -1 : y.prob === 'Générale' ? 1 : cmp(x.prob, y.prob)) ||
        (ORDER[x.a.color] ?? 9) - (ORDER[y.a.color] ?? 9) || cmp(x.layer, y.layer) || x.a.created_at.localeCompare(y.a.created_at))
      const rows = []
      for (let i = 0; i < sorted.length; i++) {
        setBusy(`Préparation des photos (${i + 1}/${sorted.length})…`)
        const { a, prob, layer } = sorted[i]
        const photos = []
        for (const ph of (a.annotation_photos || []).filter((x) => !x.deleted_at).sort((x, y) => x.created_at.localeCompare(y.created_at))) {
          try { photos.push(await smallJpeg(ph.file_path)) } catch { /* photo illisible : ignorée */ }
        }
        rows.push({ prob, statut: a.color, layer, note: a.note || '', remarks: a.remarks || '', photos })
      }
      setBusy('Création du document Word…')
      const logo = new Uint8Array(await (await fetch(logoUrl)).arrayBuffer())
      const blob = await buildWord({ logo, projectName: project.name, dateIso, dossier: dossier.trim(), author, rows })
      const url = URL.createObjectURL(blob)
      const el = document.createElement('a')
      el.href = url
      el.download = `Compte-rendu - ${project.name} - ${dateIso}.docx`
      document.body.appendChild(el); el.click(); el.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      setBusy('')
      onClose()
    } catch (e) {
      setBusy('')
      setError('Export impossible : ' + (e && e.message ? e.message : e))
    }
  }

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modalbox exportbox">
        <strong>Exporter un compte-rendu (Word)</strong>
        {!data && !error && <p className="muted">Chargement des annotations…</p>}
        {data && (
          <>
            <div className="grid2">
              <label>Date de la visite<input type="date" value={dateIso} onChange={(e) => setDateIso(e.target.value)} required /></label>
              <label>N° de dossier<input value={dossier} onChange={(e) => setDossier(e.target.value)} /></label>
            </div>
            <p className="muted small">Rédacteur : {author.name}{author.email ? ` · ${author.email}` : ''}</p>

            <fieldset><legend>Plans</legend>
              {current.map(({ plan }) => (
                <label key={plan.id} className="check"><input type="checkbox" checked={!offPlans.has(plan.id)} onChange={() => toggle(offPlans, setOffPlans, plan.id)} />{plan.name} <span className="muted">({countPlan(plan.id)})</span></label>
              ))}
            </fieldset>
            <fieldset><legend>Priorités</legend>
              {Object.entries(STATUTS).map(([k, s]) => (
                <label key={k} className="check"><input type="checkbox" checked={!offStatuts.has(k)} onChange={() => toggle(offStatuts, setOffStatuts, k)} /><i className="dot" style={{ background: s.color }} />{s.label} <span className="muted">({countStatut(k)})</span></label>
              ))}
            </fieldset>
            <fieldset><legend>Calques</legend>
              {layers.length === 0 && <span className="muted">Aucune annotation.</span>}
              {layers.map(([n, c]) => (
                <label key={n} className="check"><input type="checkbox" checked={!offLayers.has(n)} onChange={() => toggle(offLayers, setOffLayers, n)} />{n} <span className="muted">({c})</span></label>
              ))}
            </fieldset>
            <p><strong>{selected.length}</strong> annotation{selected.length > 1 ? 's' : ''} dans l’export.</p>
          </>
        )}
        {error && <p className="error">{error}</p>}
        {busy && <p className="muted">{busy}</p>}
        <div className="row">
          <button className="primary" disabled={!data || !selected.length || !!busy || !dateIso} onClick={generate}>Générer le Word</button>
          <button onClick={onClose} disabled={!!busy}>Annuler</button>
        </div>
      </div>
    </div>
  )
}
