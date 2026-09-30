import { createClient } from '@supabase/supabase-js'

// L'URL et la clé "publishable" sont faites pour être visibles dans l'application :
// ce sont les règles de sécurité de la base qui protègent les données.
export const supabase = createClient(
  'https://jvxupqdfpghmawqgwfhb.supabase.co',
  'sb_publishable_XUAQf9nwbdnGn34pkMPTfQ_Gw01Sssp'
)
