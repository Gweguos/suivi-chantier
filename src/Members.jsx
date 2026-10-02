import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { IconButton, TrashIcon } from './ui.jsx'

export default function Members({ project }) {
  const [rows, setRows] = useState(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [error, setError] = useState('')

  async function load() {
    const m = await supabase.from('project_members').select('*').eq('project_id', project.id)
    if (m.error) { setError('Impossible de charger les membres.'); return }
    const p = await supabase.from('profiles').select('id,email,full_name').in('id', m.data.map((x) => x.user_id))
    const byId = Object.fromEntries((p.data || []).map((x) => [x.id, x]))
    setRows(m.data.map((x) => ({ ...x, profile: byId[x.user_id] })))
  }
  useEffect(() => { load() }, [])

  async function add(e) {
    e.preventDefault(); setError('')
    const p = await supabase.from('profiles').select('id').eq('email', email.trim().toLowerCase()).maybeSingle()
    if (!p.data) { setError('Aucun compte avec cet e-mail. Créez-le d’abord dans Supabase (Authentication > Users).'); return }
    const r = await supabase.from('project_members').insert({ project_id: project.id, user_id: p.data.id, role })
    if (r.error) setError(r.error.code === '23505' ? 'Cette personne est déjà membre.' : 'Ajout impossible : réservé aux administrateurs du projet.')
    else { setEmail(''); load() }
  }

  async function changeRole(row, v) {
    const r = await supabase.from('project_members').update({ role: v }).eq('project_id', project.id).eq('user_id', row.user_id).select()
    if (r.error || !r.data.length) setError('Modification impossible : réservée aux administrateurs.')
    load()
  }

  async function remove(row) {
    const who = (row.profile && (row.profile.full_name || row.profile.email)) || 'ce membre'
    if (!window.confirm(`Retirer ${who} du projet ?`)) return
    const r = await supabase.from('project_members').delete().eq('project_id', project.id).eq('user_id', row.user_id).select()
    if (r.error || !r.data.length) setError('Retrait impossible : réservé aux administrateurs.')
    load()
  }

  return (
    <section className="plans">
      <h2>Membres</h2>
      {rows === null ? <p className="muted">Chargement…</p> : rows.map((r) => (
        <div key={r.user_id} className="member">
          <span>{r.profile ? r.profile.email : r.user_id}</span>
          <select value={r.role} onChange={(e) => changeRole(r, e.target.value)}>
            <option value="member">Membre</option>
            <option value="admin">Administrateur</option>
          </select>
          <IconButton label="Retirer du projet" danger onClick={() => remove(r)}><TrashIcon /></IconButton>
        </div>
      ))}
      <form className="panel" onSubmit={add}>
        <label>Ajouter un membre (e-mail de son compte)
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="member">Membre</option>
          <option value="admin">Administrateur</option>
        </select>
        {error && <p className="error">{error}</p>}
        <button className="primary">Ajouter</button>
      </form>
    </section>
  )
}
