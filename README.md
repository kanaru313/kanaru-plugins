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
- Removes NetEase's credit lines (作词, 作曲, 编曲 …) at the start and end of the lyrics; a credit-looking line in the middle stays. Lyrics saved before this update keep their credits until you clear this plugin's saved lyrics (Sources → plugin → Data).
- No translation: `tlyric` and `klyric` are ignored.
- No cookie, key or login; only the host `music.163.com` is used.

### ZingMP3 (`zingmp3`)

Finds synced LRC lyrics at ZingMP3 (`zingmp3.vn`, files from `static-zmp3.zmdcdn.me`) through the **unofficial** web API of the site.

- Search by title and primary artist (then by title alone), or the text typed in the manual search; songs without lyrics are not listed.
- Requests are signed like the web client does. The API key, secret key and client version are plugin settings with the web client's public values as defaults; if the plugin reports `signature refused`, ZingMP3 changed them and you can paste new ones.
- A session cookie from the home page is kept in the plugin's storage and renewed by itself.
- Removes credit lines (`Bài hát:`, `Ca sĩ:` …) at the start and end of the lyrics.
- Using the unofficial API may go against ZingMP3's terms of service; that risk is yours.

### NhacCuaTui (`nhaccuatui`)

Finds synced (LRC) lyrics at NhacCuaTui (`nhaccuatui.com`, files from `lyric.nct.vn`) through the **unofficial** web API of the site.

- Search by title and primary artist (then by title alone), or the text typed in the manual search.
- Decrypts synced LRC lyrics from NCT's encrypted timed lyric files using RC4 stream cipher.
- Falls back to plain text lyrics if no synced lyric is available.
- Removes credit lines (`Bài hát:`, `Ca sĩ:`, `Lời bài hát:` …) at the start and end of the lyrics.
- No cookie, key or login required; only the hosts `graph.nhaccuatui.com` and `lyric.nct.vn` are used.

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
