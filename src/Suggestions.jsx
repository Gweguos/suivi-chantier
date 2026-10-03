import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { IconButton, TrashIcon, PencilIcon } from './ui.jsx'

// Suggestions de commentaires (communes à toute l'équipe) + droit de les gérer
export function useSuggestions() {
  const [suggs, setSuggs] = useState([])
  const [isAdmin, setIsAdmin] = useState(false)
  const reload = useCallback(async () => {
    const [s, a] = await Promise.all([
      supabase.from('comment_suggestions').select('*').order('position').order('created_at'),
      supabase.from('app_admins').select('user_id'),
    ])
    if (s.data) setSuggs(s.data)
    setIsAdmin(!!(a.data && a.data.length))
  }, [])
  useEffect(() => { reload() }, [reload])
  return { suggs, isAdmin, reload }
}

// Puces discrètes sous le champ Commentaire : un clic insère la phrase à l'endroit du curseur
export function SuggestionChips({ sugg, probId, note, onPick, onManage }) {
  const list = sugg.suggs.filter((s) => (s.problematique_id || '') === (probId || '') && !note.includes(s.text))
  if (!list.length && !sugg.isAdmin) return null
  return (
    <div className="chips">
      {list.map((s) => <button key={s.id} type="button" className="chip" onClick={() => onPick(s.text)}>{s.text}</button>)}
      {sugg.isAdmin && <button type="button" className="chip admin" onClick={onManage}>{list.length ? 'Gérer' : '+ Suggestions'}</button>}
    </div>
  )
}

// Gestion (administrateurs) : ajouter, modifier, supprimer
export function SuggestionsManager({ sugg, probs, initialProb, onClose }) {
  const [probId, setProbId] = useState(initialProb || '')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const list = sugg.suggs.filter((s) => (s.problematique_id || '') === probId)

  async function add(e) {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    const next = Math.max(0, ...sugg.suggs.map((s) => s.position || 0)) + 1
    const r = await supabase.from('comment_suggestions').insert({ problematique_id: probId || null, text: t, position: next })
    if (r.error) { setError('Ajout impossible : réservé aux administrateurs.'); return }
    setText(''); setError(''); sugg.reload()
  }
  async function edit(s) {
    const t = window.prompt('Modifier la suggestion', s.text)
    if (!t || !t.trim() || t.trim() === s.text) return
    const r = await supabase.from('comment_suggestions').update({ text: t.trim() }).eq('id', s.id).select()
    if (r.error || !r.data.length) setError('Modification impossible.')
    sugg.reload()
  }
  async function remove(s) {
    if (!window.confirm('Supprimer cette suggestion ?')) return
    const r = await supabase.from('comment_suggestions').delete().eq('id', s.id).select()
    if (r.error || !r.data.length) setError('Suppression impossible.')
    sugg.reload()
  }

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modalbox suggbox">
        <strong>Suggestions de commentaires</strong>
        <label>Problématique
          <select value={probId} onChange={(e) => setProbId(e.target.value)}>
            <option value="">Générale</option>
            {probs.map((p) => <option key={p.id} value={p.id}>{p.name}{p.project_id ? ' (projet)' : ''}</option>)}
          </select>
        </label>
        {list.length === 0 && <p className="muted">Aucune suggestion pour cette problématique.</p>}
        <ul className="list">
          {list.map((s) => (
            <li key={s.id} className="suggrow">
              <span>{s.text}</span>
              <IconButton label="Modifier" onClick={() => edit(s)}><PencilIcon /></IconButton>
              <IconButton label="Supprimer" danger onClick={() => remove(s)}><TrashIcon /></IconButton>
            </li>
          ))}
        </ul>
        <form className="row" onSubmit={add}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nouvelle suggestion…" style={{ flex: 1 }} />
          <button className="primary" disabled={!text.trim()}>Ajouter</button>
        </form>
        {error && <p className="error">{error}</p>}
        <div className="row"><button onClick={onClose}>Fermer</button></div>
      </div>
    </div>
  )
}
