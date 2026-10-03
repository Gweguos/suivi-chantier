import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { IconButton, TrashIcon, PencilIcon } from './ui.jsx'

// Points de contrôle suggérés (communs à toute l'équipe, avec remarque automatique associée)
// + droit de les gérer + choix du membre pour le remplissage automatique des remarques
export function useSuggestions() {
  const [suggs, setSuggs] = useState([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [autoRemarks, setAuto] = useState(true)
  const [uid, setUid] = useState(null)
  const reload = useCallback(async () => {
    const [s, a, u] = await Promise.all([
      supabase.from('comment_suggestions').select('*').order('position').order('created_at'),
      supabase.from('app_admins').select('user_id'),
      supabase.auth.getUser(),
    ])
    if (s.data) setSuggs(s.data)
    setIsAdmin(!!(a.data && a.data.length))
    const id = u && u.data && u.data.user ? u.data.user.id : null
    setUid(id)
    if (id) {
      const p = await supabase.from('profiles').select('auto_remarks').eq('id', id).maybeSingle()
      if (p.data && typeof p.data.auto_remarks === 'boolean') setAuto(p.data.auto_remarks)
    }
  }, [])
  useEffect(() => { reload() }, [reload])
  const setAutoRemarks = (v) => {
    setAuto(v)
    if (uid) supabase.from('profiles').update({ auto_remarks: v }).eq('id', uid).then(() => {}, () => {})
  }
  return { suggs, isAdmin, reload, autoRemarks, setAutoRemarks }
}

// Puces discrètes sous le champ Points de contrôle : un clic insère la phrase à l'endroit du curseur
export function SuggestionChips({ sugg, probId, note, onPick, onManage }) {
  const list = sugg.suggs.filter((s) => (s.problematique_id || '') === (probId || '') && !note.includes(s.text))
  if (!list.length && !sugg.isAdmin) return null
  return (
    <div className="chips">
      {list.map((s) => <button key={s.id} type="button" className="chip" onClick={() => onPick(s)}>{s.text}</button>)}
      {sugg.isAdmin && <button type="button" className="chip admin" onClick={onManage}>{list.length ? 'Gérer' : '+ Suggestions'}</button>}
    </div>
  )
}

// Gestion (administrateurs) : ajouter, modifier, supprimer
export function SuggestionsManager({ sugg, probs, initialProb, onClose }) {
  const [probId, setProbId] = useState(initialProb || '')
  const [editing, setEditing] = useState(null) // suggestion en cours de modification
  const [text, setText] = useState('')
  const [remark, setRemark] = useState('')
  const [error, setError] = useState('')
  const list = sugg.suggs.filter((s) => (s.problematique_id || '') === probId)

  const reset = () => { setEditing(null); setText(''); setRemark('') }
  function edit(s) { setEditing(s); setText(s.text); setRemark(s.remark || '') }

  async function submit(e) {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    const fields = { text: t, remark: remark.trim() || null }
    let r
    if (editing) r = await supabase.from('comment_suggestions').update(fields).eq('id', editing.id).select()
    else {
      const next = Math.max(0, ...sugg.suggs.map((s) => s.position || 0)) + 1
      r = await supabase.from('comment_suggestions').insert({ ...fields, problematique_id: probId || null, position: next }).select()
    }
    if (r.error || !r.data.length) { setError('Enregistrement impossible : réservé aux administrateurs (ou script SQL de l’étape 21 non lancé).'); return }
    setError(''); reset(); sugg.reload()
  }
  async function remove(s) {
    if (!window.confirm('Supprimer ce point de contrôle suggéré ?')) return
    const r = await supabase.from('comment_suggestions').delete().eq('id', s.id).select()
    if (r.error || !r.data.length) setError('Suppression impossible.')
    if (editing && editing.id === s.id) reset()
    sugg.reload()
  }

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modalbox suggbox">
        <strong>Points de contrôle suggérés</strong>
        <label>Composants
          <select value={probId} onChange={(e) => { setProbId(e.target.value); reset() }}>
            <option value="">Générale</option>
            {probs.map((p) => <option key={p.id} value={p.id}>{p.name}{p.project_id ? ' (projet)' : ''}</option>)}
          </select>
        </label>
        {list.length === 0 && <p className="muted">Aucune suggestion pour ce composant.</p>}
        <ul className="list">
          {list.map((s) => (
            <li key={s.id} className={'suggrow' + (editing && editing.id === s.id ? ' editing' : '')}>
              <span>{s.text}{s.remark && <small>Remarque : {s.remark}</small>}</span>
              <IconButton label="Modifier" onClick={() => edit(s)}><PencilIcon /></IconButton>
              <IconButton label="Supprimer" danger onClick={() => remove(s)}><TrashIcon /></IconButton>
            </li>
          ))}
        </ul>
        <form className="suggform" onSubmit={submit}>
          <strong className="muted">{editing ? 'Modifier la suggestion' : 'Nouvelle suggestion'}</strong>
          <label>Point de contrôle<input value={text} onChange={(e) => setText(e.target.value)} /></label>
          <label>Remarque automatique (facultatif)<textarea rows="2" value={remark} onChange={(e) => setRemark(e.target.value)} /></label>
          <div className="row">
            <button className="primary" disabled={!text.trim()}>{editing ? 'Enregistrer' : 'Ajouter'}</button>
            {editing && <button type="button" onClick={reset}>Annuler</button>}
          </div>
        </form>
        {error && <p className="error">{error}</p>}
        <div className="row"><button onClick={onClose}>Fermer</button></div>
      </div>
    </div>
  )
}
