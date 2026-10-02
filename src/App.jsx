import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Plans from './Plans.jsx'
import Members from './Members.jsx'

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('E-mail ou mot de passe incorrect.')
    setBusy(false)
  }

  return (
    <main className="login">
      <h1>Suivi de chantier</h1>
      <form onSubmit={submit}>
        <label>E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label>Mot de passe
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
      </form>
    </main>
  )
}

function ProjectPage({ project, onBack }) {
  return (
    <main>
      <button className="link" onClick={onBack}>‹ Projets</button>
      <h1>{project.name}</h1>
      {project.description && <p className="muted">{project.description}</p>}
      <Plans project={project} />
      <Members project={project} />
    </main>
  )
}

function Projects({ session }) {
  const [projects, setProjects] = useState(null)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [current, setCurrent] = useState(null)

  async function load() {
    const { data, error } = await supabase.from('projects').select('*').order('updated_at', { ascending: false })
    if (error) setError('Impossible de charger les projets.')
    else setProjects(data)
  }
  useEffect(() => { load() }, [])

  async function create(e) {
    e.preventDefault()
    setError('')
    const { error } = await supabase.from('projects').insert({ name: name.trim(), description: description.trim() || null })
    if (error) { setError('Création impossible : ' + error.message); return }
    setName(''); setDescription(''); setCreating(false)
    load()
  }

  if (current) return <ProjectPage project={current} onBack={() => setCurrent(null)} />

  const shown = (projects || []).filter(
    (p) => (showArchived || !p.archived) && p.name.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <main>
      <header className="top">
        <h1>Projets</h1>
        <button className="link" onClick={() => supabase.auth.signOut()} title={session.user.email}>Se déconnecter</button>
      </header>

      {creating ? (
        <form className="panel" onSubmit={create}>
          <label>Nom du projet
            <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </label>
          <label>Description (facultatif)
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <div className="row">
            <button className="primary">Créer le projet</button>
            <button type="button" onClick={() => setCreating(false)}>Annuler</button>
          </div>
        </form>
      ) : (
        <button className="primary" onClick={() => setCreating(true)}>Nouveau projet</button>
      )}

      {error && <p className="error">{error}</p>}

      <input className="search" type="search" placeholder="Rechercher un projet" value={query} onChange={(e) => setQuery(e.target.value)} />
      <label className="check">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Afficher les projets archivés
      </label>

      {projects === null ? (
        <p className="muted">Chargement…</p>
      ) : shown.length === 0 ? (
        <p className="empty">{projects.length === 0 ? 'Aucun projet pour le moment. Créez le premier.' : 'Aucun projet ne correspond.'}</p>
      ) : (
        <ul className="list">
          {shown.map((p) => (
            <li key={p.id}>
              <button className="item" onClick={() => setCurrent(p)}>
                <strong>{p.name}</strong>
                {p.description && <span>{p.description}</span>}
                <small>Modifié le {new Date(p.updated_at).toLocaleDateString('fr-FR')}{p.archived ? ' · archivé' : ''}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <p className="muted center">Chargement…</p>
  return session ? <Projects session={session} /> : <Login />
}
