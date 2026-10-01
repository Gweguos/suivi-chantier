import { supabase } from './supabase'

// Télécharge un fichier du stockage "plans" et le garde sur l'appareil :
// la deuxième ouverture est instantanée (et c'est la base du mode hors ligne).
const NAME = 'plans-v1'

export async function fetchPlan(path, bucket = 'plans') {
  const key = '/__c/' + (bucket === 'plans' ? '' : bucket + '/') + path
  let cache = null
  try {
    cache = await caches.open(NAME)
    const hit = await cache.match(key)
    if (hit) return await hit.blob()
  } catch { cache = null }
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error) throw error
  try { if (cache) await cache.put(key, new Response(data)) } catch { /* cache indisponible */ }
  return data
}

// Efface du cache de l'appareil les fichiers d'un plan supprimé
export async function forgetPlan(paths) {
  try {
    const c = await caches.open(NAME)
    await Promise.all(paths.map((p) => c.delete('/__c/' + p)))
  } catch { /* cache indisponible */ }
}
