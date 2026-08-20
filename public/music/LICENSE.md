# Bundled music — provenance

Every file in this directory is royalty-free audio cleared for commercial use.
This file records where each one came from. Provenance that lives only in
someone's memory is provenance this project does not have — and a track whose
licence cannot be produced on request has to be pulled.

**Adding a track?** Add a row here in the same commit. A file in this directory
with no row is treated as unlicensed.

All four files carry Pixabay's download naming convention —
`uploader-title-id.mp3`, where the trailing number is Pixabay's own track id.
Each **Source URL** below was fetched and read on 2026-08-20; the title,
uploader and licence in that row are what the page itself says, not what the
filename implies.

| File | Track title | Uploader | Source URL | Licence |
|---|---|---|---|---|
| `alex-morgan-lofi-chill-vlog-beats-573883.mp3` | Lofi Chill Vlog Beats | alex-morgan | https://pixabay.com/music/lofi-chill-vlog-beats-573883/ | Pixabay Content License |
| `alex-morgan-lofi-sunny-cafe-568156.mp3` | Lofi Sunny Cafe | alex-morgan | https://pixabay.com/music/lofi-sunny-cafe-568156/ | Pixabay Content License |
| `alex-morgan-lofi-restaurant-568157.mp3` | Lofi Restaurant | alex-morgan | https://pixabay.com/music/lofi-restaurant-568157/ | Pixabay Content License |
| `kulakovka-lofi-relax-570489.mp3` | LoFi Relax | Kulakovka | https://pixabay.com/music/lofi-relax-570489/ | Pixabay Content License |

Pixabay resolves a music URL by its trailing id, so these links survive a title
being edited upstream — which is the property a provenance record needs and a
slug does not have.

**The Pixabay Content License** permits commercial use and does not require
attribution. The uploaders are recorded here anyway: attribution not being
required is not a reason to stop knowing whose work this is.

The catalog Chroneli actually serves is `src/lib/music/catalog.ts`, and
`track-ref.test.ts` fails if a file here has no entry there or an entry there
names a file that is not here. Neither of those tests checks this file — a row
missing from the table is the one failure mode still left to a human.
