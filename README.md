# kanaru-plugins

Lyrics source plugins for [Kanaru](https://github.com/hieu313/kanaru).

Each plugin lives in `src/<slug>/` with the layout Kanaru expects:

```
src/<slug>/
├── plugin.json      metadata / script / config
├── icon.png         optional, ≤ 256×256, ≤ 64 KB
└── src/
    ├── search.js    execute(query) → Response.success([{ id, title, artist, album?, durationMs?, lyrics? }])
    └── lyrics.js    execute(id)    → Response.success({ data, type?, instrumental? }) | Response.success(null)
```

The plugin API is described in Kanaru's `docs/lyrics-plugin-api.md`.

## Plugins

### NetEase Cloud Music (`netease`)

Finds lyrics at NetEase Cloud Music (`music.163.com`) through its **unofficial** web API.

- Search by title and primary artist (or the text typed in the manual search), up to 20 results.
- Returns synced LRC lyrics when NetEase has them, plain text otherwise.
- Marks instrumental songs (`pureMusic` / `nolyric`) so the app shows "instrumental" instead of "no lyrics". NetEase's "no lyrics yet" placeholder counts as no lyrics.
- No translation: `tlyric` and `klyric` are ignored.
- No cookie, key or login; only the host `music.163.com` is used.

### Genius: not shipped

There is no Genius plugin on purpose. The Genius Terms of Service (Last Updated January 13, 2026, https://genius.com/static/terms) say: "In connection with your use of the Service you shall not engage in or use any data mining, robots, scraping or similar data gathering or extraction methods" and "you agree not to modify, copy, frame, scrape, ... the Service or the Genius Content". The official Genius API returns no lyrics, so a plugin would have to scrape the lyric pages, which the terms forbid.

## Legal note

The plugins here use unofficial APIs. They are not affiliated with, endorsed by or sponsored by NetEase or any other service. Use them at your own responsibility and check the terms of each service. An unofficial API can change or disappear without notice, so a plugin can break when the service changes.

## Build

```bash
python3 tools/build.py
```

Zips every `src/<slug>/` into `dist/<slug>/plugin.zip` and rewrites `plugins.json`
(the catalog). Catalog paths are relative, so the same catalog works from GitHub and
from a local server.

## Use

- **Install one plugin locally**: Kanaru → Settings → Lyrics → Lyrics sources → Plugin store → ⋮ → Install from file… → pick `dist/<slug>/plugin.zip`.
- **Repository (remote)**: add `https://raw.githubusercontent.com/kanaru313/kanaru-plugins/main/plugins.json`.
- **Repository (local)**: `python3 -m http.server 8765` in this folder, then add `http://localhost:8765/plugins.json`.

When you change a plugin, bump `metadata.version` in its `plugin.json` and rebuild.
