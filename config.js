// ════════════════════════════════════════════════
// CONSTELLATION BOARD — SHARED WORKSPACE CONFIG
// ════════════════════════════════════════════════
//
// Fill these in to turn the app into a shared workspace: every person who
// opens the page sees and edits the same boards.
//
// Leave them empty and the app runs exactly as before — boards stay in the
// browser's own localStorage and are visible to nobody else.
//
// Get both values from your Supabase project:
//   Project Settings → Data API → Project URL
//   Project Settings → API Keys → anon / public
//
// The anon key is meant to be public, so committing it is fine. But note
// that with the policies in supabase/schema.sql there is NO login: anyone
// who can reach this page can read and edit every board. See README.md.

window.CONSTELLATION_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',

  // Storage bucket that holds uploaded images. Must match schema.sql.
  bucket: 'board-images',
};
