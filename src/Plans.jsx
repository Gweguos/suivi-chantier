import { useEffect, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.js?url'
import { supabase } from './supabase'
import { fetchPlan } from './cache.js'
import Viewer from './Viewer.jsx'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

// Niveaux de qualité de l'aperçu (la taille est aussi plafonnée en surface pour rester compatible iPhone).
const LEVELS = {
  standard: { label: 'Standard (rapide)', side: 3000, area: 8e6, q: 0.8 },
  elevee: { label: 'Élevée', side: 4500, area: 14e6, q: 0.82 },
  maximale: { label: 'Maximale (plus lent)', side: 6000, area: 16e6, q: 0.85 },
}
const THUMB = { side: 400, area: 1e9, q: 0.7 }
const MAX_MB = 50 // limite actuelle du plan gratuit Supabase

async function renderJpeg(page, lv) {
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

async function importPdf({ project, plan, file, name, label, quality, onProgress }) {
  const lv = LEVELS[quality] || LEVELS.standard
  if (file.size > MAX_MB * 1048576) {
    throw new Error(`Fichier trop lourd (${(file.size / 1048576).toFixed(1)} Mo, limite actuelle ${MAX_MB} Mo). Ré-exportez un PDF plus léger.`)
  }
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const planId = plan ? plan.id : crypto.randomUUID()
  const versionId = crypto.randomUUID()
  const base = `${project.id}/${planId}/${versionId}`
  const sizes = [], displayPaths = [], uploaded = []
  let thumbPath = null
  const put = async (p, blob, type) => {
    const r = await supabase.storage.from('plans').upload(p, blob, { contentType: type })
    if (r.error) throw r.error
    uploaded.push(p)
  }
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress(`Préparation de l’aperçu (page ${i}/${pdf.numPages})…`)
      const page = await pdf.getPage(i)
      const v = page.getViewport({ scale: 1 })
      sizes.push({ w: Math.round(v.width), h: Math.round(v.height) })
      const p = `${base}/p${i}.jpg`
      await put(p, await renderJpeg(page, lv), 'image/jpeg')
      displayPaths.push(p)
      if (i === 1) {
        thumbPath = `${base}/thumb.jpg`
        await put(thumbPath, await renderJpeg(page, THUMB), 'image/jpeg')
      }
    }
    onProgress('Envoi du PDF d’origine…')
    const path = `${base}.pdf`
    await put(path, file, 'application/pdf')
    if (!plan) {
      const r = await supabase.from('plans').insert({ id: planId, project_id: project.id, name })
      if (r.error) throw r.error
    }
    const previous = plan?.plan_versions.find((v) => v.is_current)
    const r = await supabase.from('plan_versions').insert({
      id: versionId, project_id: project.id, plan_id: planId, version_label: label,
      file_path: path, file_size: file.size, page_count: pdf.numPages, page_sizes: sizes,
      display_paths: displayPaths, thumb_path: thumbPath, display_width: lv.side,
      previous_version_id: previous ? previous.id : null,
    })
    if (r.error) throw r.error
    await supabase.from('plan_versions').update({ is_current: false }).eq('plan_id', planId).neq('id', versionId)
  } catch (e) {
    if (uploaded.length) await supabase.storage.from('plans').remove(uploaded)
    throw e
  } finally {
    pdf.destroy()
  }
}

function Thumb({ path }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!path) return
    let u, off = false
    fetchPlan(path).then((b) => { if (!off) { u = URL.createObjectURL(b); setUrl(u) } }).catch(() => {})
    return () => { off = true; if (u) URL.revokeObjectURL(u) }
  }, [path])
  return url ? <img className="thumb" src={url} alt="" /> : <div className="thumb" />
}

function ImportForm({ project, plan, onDone, onCancel }) {
  const [file, setFile] = useState(null)
  const [name, setName] = useState('')
  const [label, setLabel] = useState(plan ? '' : 'A')
  const [quality, setQuality] = useState(project.display_quality || 'standard')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  function chooseQuality(v) {
    setQuality(v)
    // mémorise le choix comme réglage par défaut du projet (ignoré si non autorisé)
    supabase.from('projects').update({ display_quality: v }).eq('id', project.id).then(() => {}, () => {})
  }

  async function submit(e) {
    e.preventDefault()
    setBusy('Lecture du PDF…'); setError('')
    try {
      await importPdf({ project, plan, file, name: name.trim(), label: label.trim(), quality, onProgress: setBusy })
      onDone()
    } catch (err) {
      setError(err.message || 'Import impossible.')
      setBusy('')
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <strong>{plan ? `Nouvelle version de « ${plan.name} »` : 'Importer un plan'}</strong>
      <label>Fichier PDF
        <input type="file" accept="application/pdf" required onChange={(e) => {
          const f = e.target.files[0]
          setFile(f)
          if (f && !plan && !name) setName(f.name.replace(/\.pdf$/i, ''))
        }} />
      </label>
      {!plan && <label>Nom du plan<input value={name} onChange={(e) => setName(e.target.value)} required /></label>}
      <label>Indice de la version<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="A, B, C…" required /></label>
      <label>Qualité de l’aperçu
        <select value={quality} onChange={(e) => chooseQuality(e.target.value)}>
          {Object.entries(LEVELS).map(([k, l]) => <option key={k} value={k}>{l.label}</option>)}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      {busy && <p className="muted">{busy}</p>}
      <div className="row">
        <button className="primary" disabled={!!busy || !file}>Importer</button>
        <button type="button" onClick={onCancel} disabled={!!busy}>Annuler</button>
      </div>
    </form>
  )
}

export default function Plans({ project }) {
  const [plans, setPlans] = useState(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState(null)
  const [open, setOpen] = useState(null)

  async function load() {
    const { data, error } = await supabase.from('plans').select('*, plan_versions(*)').eq('project_id', project.id).order('name')
    if (error) setError('Impossible de charger les plans.')
    else setPlans(data)
  }
  useEffect(() => { load() }, [])

  return (
    <section className="plans">
      <h2>Plans</h2>
      {form ? (
        <ImportForm project={project} plan={form.plan} onCancel={() => setForm(null)} onDone={() => { setForm(null); load() }} />
      ) : (
        <button className="primary" onClick={() => setForm({})}>Importer un plan</button>
      )}
      {error && <p className="error">{error}</p>}
      {plans === null ? <p className="muted">Chargement…</p> : plans.length === 0 ? (
        <p className="empty">Aucun plan dans ce projet. Importez le premier PDF.</p>
      ) : (
        <ul className="list">
          {plans.map((p) => {
            const cur = p.plan_versions.find((v) => v.is_current) || p.plan_versions[0]
            return (
              <li key={p.id} className="planrow">
                <button className="item withthumb" onClick={() => setOpen(p)}>
                  <Thumb path={cur && cur.thumb_path} />
                  <div>
                    <strong>{p.name}</strong><br />
                    <small>{cur ? `Indice ${cur.version_label} · ${cur.page_count} page${cur.page_count > 1 ? 's' : ''}` : 'Sans fichier'} · {p.plan_versions.length} version{p.plan_versions.length > 1 ? 's' : ''}</small>
                  </div>
                </button>
                <button onClick={() => setForm({ plan: p })}>Nouvelle version</button>
              </li>
            )
          })}
        </ul>
      )}
      {open && <Viewer plan={open} onClose={() => setOpen(null)} />}
    </section>
  )
}
