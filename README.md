# kanaru-plugins

Lyrics source plugins for [Kanaru](https://github.com/hieu313/kanaru).

Each plugin lives in `src/<slug>/` with the layout Kanaru expects:

```
src/<slug>/
├── plugin.json      metadata / script / config
├── icon.png         optional, ≤ 256×256, ≤ 64 KB
└── src/
    ├── search.js    execute(query) → Response.success([{ id, title, artist, album?, durationMs?, lyrics? }])
    └── lyrics.js    execute(id)    → Response.success({ data, type?, instrumental?, language? }) | Response.success(null)
```

The plugin API is described in Kanaru's `docs/lyrics-plugin-api.md`.

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
