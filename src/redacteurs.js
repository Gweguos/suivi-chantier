// Nom du rédacteur déduit de l'e-mail de connexion :
// prenom.nom@altia-acoustique.com  ->  « Prenom Nom »
// Pour un cas particulier, ajoutez une ligne :  'adresse@mail.fr': 'Prénom Nom',
export const EXCEPTIONS = {
  'erwangouerou12@gmail.com': 'Erwan Gouerou',
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()

export function nomRedacteur(email) {
  const e = (email || '').toLowerCase()
  if (EXCEPTIONS[e]) return EXCEPTIONS[e]
  return e.split('@')[0].replace(/[0-9]+/g, '').split(/[._-]+/).filter(Boolean).map(cap).join(' ')
}
