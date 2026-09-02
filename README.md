# Constellation Board

Warburg Style Arrangement

An infinite canvas for arranging images and text into panels, plus board tabs,
PDF export, and JSON import/export. The whole app is one static `index.html`, so
it runs from GitHub Pages, any static host, or a local file.

## Shared boards

Out of the box a board lives in the browser's own `localStorage`, so two people
never see the same board and the whole workspace is capped at roughly 5 MB.
Filling in `config.js` moves the boards into a Supabase project instead, and
everyone who opens the page works on the same set of boards.

There is no login. Anyone who can reach the page can read and edit every board.
If you need per-user boards or private ones, this is not the right setup.

### Setup

1. Create a project at [supabase.com](https://supabase.com) (the free tier is
   enough).
2. Open **SQL Editor → New query**, paste in
   [`supabase/schema.sql`](supabase/schema.sql), and run it. It creates the
   `boards` table, its access policies, and the `board-images` storage bucket.
   Re-running it later is safe.
3. Copy two values out of the dashboard:
   - **Project Settings → Data API → Project URL**
   - **Project Settings → API Keys → `anon` / public**
4. Put them in `config.js`:

   ```js
   window.CONSTELLATION_CONFIG = {
     supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
     supabaseAnonKey: 'eyJhbGciOi...',
     bucket: 'board-images',
   };
   ```

5. Commit and deploy. The next person to open the page sees the same boards you
   do.

The anon key is designed to be published, so committing it is fine. What it
grants is whatever the policies allow, which here is full access to the boards
table and the image bucket. Treat the page URL as the thing worth keeping
private.

The first time you connect a browser that already has boards in it, those boards
are uploaded into the empty shared workspace and their images are moved into
storage, so nothing has to be rebuilt by hand.

### How syncing behaves

- **Saving is automatic.** Edits are pushed about a second after you stop, and
  the badge in the board bar shows `Saving` then `Saved`.
- **Seeing other people's edits is manual.** Press **Sync**, or reload. There is
  no live multiplayer; you will not watch someone else's cursor move.
- **Stale writes ask first.** If someone changed a board since you opened it,
  saving prompts you to either keep your version or drop yours and load theirs,
  rather than silently overwriting their work.
- **The backend going down is survivable.** Boards keep working from a local
  cache, the badge turns red and reads `Not synced`, and pending changes are
  retried until they land.
- **Images go to storage, not into the board.** Uploads become URLs in the
  `board-images` bucket, which is what keeps boards small enough to share.
  Imported JSON containing base64 images is converted on import.

### Running without Supabase

Leave `config.js` empty. The badge reads `Local only`, the Sync button is
hidden, and the app behaves exactly as it did before: boards in `localStorage`,
images inlined as base64, nothing leaves the browser. Export All still produces
a workspace JSON you can hand to someone else.
