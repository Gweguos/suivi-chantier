import { useEffect, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.js?url'
import { supabase } from './supabase'
import Viewer from './Viewer.jsx'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc
const MAX_MB = 50

async function inspectPdf(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const sizes = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const v = (await pdf.getPage(i)).getViewport({ scale: 1 })
    sizes.push({ w: Math.round(v.width), h: Math.round(v.height) })
  }
  return { count: pdf.numPages, sizes }
}

async function importPdf({ project, plan, file, name, label }) {
  if (file.size > MAX_MB * 1048576) {
    throw new Error(`Fichier trop lourd (${(file.size / 1048576).toFixed(1)} Mo, limite actuelle ${MAX_MB} Mo). Ré-exportez un PDF plus léger.`)
  }
  const { count, sizes } = await inspectPdf(file)
  const planId = plan ? plan.id : crypto.randomUUID()
  const versionId = crypto.randomUUID()
  const path = `${project.id}/${planId}/${versionId}.pdf`
  const up = await supabase.storage.from('plans').upload(path, file, { contentType: 'application/pdf' })
  if (up.error) throw up.error
  try {
    if (!plan) {
      const r = await supabase.from('plans').insert({ id: planId, project_id: project.id, name })
      if (r.error) throw r.error
    }
    const previous = plan?.plan_versions.find((v) => v.is_current)
    const r = await supabase.from('plan_versions').insert({
      id: versionId, project_id: project.id, plan_id: planId, version_label: label,
      file_path: path, page_count: count, page_sizes: sizes, previous_version_id: previous ? previous.id : null,
    })
    if (r.error) throw r.error
    await supabase.from('plan_versions').update({ is_current: false }).eq('plan_id', planId).neq('id', versionId)
  } catch (e) {
    await supabase.storage.from('plans').remove([path])
    throw e
  }
}

function ImportForm({ project, plan, onDone, onCancel }) {
  const [file, setFile] = useState(null)
  const [name, setName] = useState('')
  const [label, setLabel] = useState(plan ? '' : 'A')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      await importPdf({ project, plan, file, name: name.trim(), label: label.trim() })
      onDone()
    } catch (err) {
      setError(err.message || 'Import impossible.')
      setBusy(false)
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
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy || !file}>{busy ? 'Import en cours…' : 'Importer'}</button>
        <button type="button" onClick={onCancel} disabled={busy}>Annuler</button>
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
                <button className="item" onClick={() => setOpen(p)}>
                  <strong>{p.name}</strong>
                  <small>{cur ? `Indice ${cur.version_label} · ${cur.page_count} page${cur.page_count > 1 ? 's' : ''}` : 'Sans fichier'} · {p.plan_versions.length} version{p.plan_versions.length > 1 ? 's' : ''}</small>
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
