# kanaru-plugins

Lyrics source and lyrics translate plugins for [Kanaru](https://github.com/hieu313/kanaru).

Each plugin lives in `src/<slug>/` with the layout Kanaru expects:

```
src/<slug>/
├── plugin.json      metadata / script / config
├── icon.png         optional, ≤ 256×256, ≤ 64 KB
└── src/
    ├── search.js    execute(query) → Response.success([{ id, title, artist, album?, durationMs?, lyrics? }])
    └── lyrics.js    execute(id)    → Response.success({ data, type?, instrumental? }) | Response.success(null)
```

A translate plugin (`metadata.type: "translate"`) has one script instead:

```
src/<slug>/
├── plugin.json      metadata / script.translate / translate{languages,maxLines,maxChars,timeoutSec} / config
└── src/
    └── translate.js execute({ lines, to, song? }) → Response.success([{ text, detected? }]), one per line
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

### Musixmatch (`musixmatch`)

Finds synced (LRC) lyrics at Musixmatch through its mobile API (`apic-appmobile.musixmatch.com`).

- Search by title and primary artist (or manual search text).
- Returns synced LRC lyrics when available, plain text otherwise.
- Identifies and marks instrumental tracks (`instrumental: true`).
- Removes promotional watermarks, disclaimers, and metadata credit headers/footers.
- Automatic user token generation and caching, with fallback default token and optional custom `userToken` setting in plugin preferences.
- Only the host `apic-appmobile.musixmatch.com` is used.

### QQ Music (`qqmusic`)

Finds synced (LRC) lyrics at QQ Music (`qq.com`, API hosts `c.y.qq.com`, `i.y.qq.com`, `u.y.qq.com`) through its unofficial web API.

- Search by title and primary artist (or manual search text).
- Returns synced LRC lyrics when available, plain text otherwise.
- Identifies and marks instrumental tracks (`此歌曲为没有填词的纯音乐，请您欣赏`).
- Decodes HTML entities and removes credit lines (`作词`, `作曲`, `编曲`, `Written by`, `Composed by` …) at the start and end of the lyrics.
- No cookie, key or login required; only the hosts `c.y.qq.com`, `i.y.qq.com`, and `u.y.qq.com` are used.

### PetitLyrics (`petitlyrics`)

Finds synced (LRC) lyrics at PetitLyrics (プチリリ, `on.petitlyrics.com`) through its mobile API.

- Search by title and primary artist (or manual search text).
- Decodes word-synced (WSY) and line-synced (LSY) formats into standard synced LRC.
- Falls back to plain text lyrics when synced lyrics are not available.
- Decodes HTML entities and handles Japanese multi-byte UTF-8 encoding.
- No cookie, key or login required; only the hosts `on.petitlyrics.com` and `petitlyrics.com` are used.

### Kugou Music (`kugou`)

Finds synced (LRC) lyrics at Kugou Music (酷狗音乐, `lyrics.kugou.com`) through its desktop lyric API.

- Search by title and primary artist (with `Artist - Title` indexing), or manual search text.
- Optional track duration matching to rank closest lyric matches.
- Returns synced LRC lyrics decoded from Base64 UTF-8.
- Identifies and marks instrumental tracks (`纯音乐，请欣赏`).
- Decodes HTML entities and removes credit lines (`作词`, `作曲`, `编曲`, `Written by`, `Composed by` …) at the start and end of the lyrics.
- No cookie, key or login required; only the host `lyrics.kugou.com` is used.

### Spotify (`spotify`)

Finds synced (LRC) lyrics at Spotify (`open.spotify.com`, `spclient.wg.spotify.com`) through its Web Player internal API.

- Search by title and primary artist (or manual search text) via the Spotify Web API.
- Converts `LINE_SYNCED` time codes into standard synced LRC lyrics, with fallback to plain text.
- Generates dynamic TOTP tokens against Spotify's server-time challenge using bundled and auto-updating cipher dictionaries.
- Requires your user session cookie (`sp_dc`) configured in the plugin settings (stored securely in the OS keyring as a secret).
- Hosts used: `open.spotify.com`, `api.spotify.com`, `spclient.wg.spotify.com`, and `raw.githubusercontent.com`.

### J-Lyric (`jlyric`)

Finds lyrics at J-Lyric.net (`j-lyric.net`) for Japanese music (J-Pop, Anisong, Vocaloid, Enka, Idol).

- Search by title and primary artist, or manual search text.
- Fallback multi-step search strategies to handle artist/title permutations.
- Returns clean plain text lyrics with furigana/ruby reading tags cleaned up.
- Licensed officially by JASRAC and NexTone.
- No cookie, key or login required; only the host `j-lyric.net` is used.

### Color Coded Lyrics (`colorcodedlyrics`)

Finds multi-version K-Pop and Asian pop lyrics at Color Coded Lyrics (`colorcodedlyrics.com`).

- Search by title and primary artist, or manual search text. Includes fallback strategies for short titles and slug aliases (e.g. `twice-tt`).
- Automatically parses and separates multi-column structures (Hangul / Original language, Latin Romanization, English translation) and member line attributions across modern Gutenberg columns and classic tables.
- Filter out non-song index/discography posts to keep results relevant.
- Configurable `preferredSection` setting in plugin preferences: choose between "All sections" (default), "Romanization only", "Original language only", or "English translation only".
- No cookie, key or login required; only the host `colorcodedlyrics.com` is used.

### Gemini Translate (`gemini-translate`)

Translates lyrics line by line with the Google Gemini API (`generativelanguage.googleapis.com`), keeping the singer's voice and the line count.

- Needs Kanaru with translate plugin support (PR #100) and your own API key from https://aistudio.google.com/app/apikey. The key is kept in the system keyring, never in the database or logs. Several keys can be listed; the next is used when one is refused or out of quota.
- **What is sent to Google:** the lines to translate; with *Send the song as context* on (default), also the title, artist and the full lyrics of the song. Check Google's terms and data policy for the API tier of your key.
- Gemini detects the source language of each line; lines already in the target language are hidden by the app.
- Options: model, style (natural, close, poetic, singable), thinking, temperature, safety filter, retry of skipped lines, your own instruction and a full system prompt.
- Errors: all keys refused is *key*, a daily quota is *quota*, a per-minute limit is *rate limited*. A run uses at most 10 sends.

### DeepL Translate (`deepl-translate`)

Translates lyrics line by line with the DeepL API v2 (`api-free.deepl.com` for keys ending in `:fx`, `api.deepl.com` otherwise).

- Needs Kanaru with translate plugin support (PR #100) and your own DeepL API key (the Free plan works). The key is kept in the system keyring.
- **What is sent to DeepL:** the lines to translate; with *Send the song as context* on (default), also a short context text with the title and artist (not translated, not billed). The lyrics themselves are not sent as context.
- Options: formality (`prefer_more` / `prefer_less`, used only where DeepL supports it), English variant (US/GB), Portuguese variant (BR/PT).
- Languages: the 29 languages of Kanaru's table that DeepL can produce. Hindi, Persian, Malay, Welsh, Albanian, Armenian, Basque, Burmese, Georgian, Icelandic, Macedonian and Maori are not offered.
- One send per chunk of up to 50 lines. Errors: 403 is *key*, 456 *quota*, 429/529 *rate limited*, 5xx *server*.

### Genius: not shipped

There is no Genius plugin on purpose. The Genius Terms of Service (Last Updated January 13, 2026, https://genius.com/static/terms) say: "In connection with your use of the Service you shall not engage in or use any data mining, robots, scraping or similar data gathering or extraction methods" and "you agree not to modify, copy, frame, scrape, ... the Service or the Genius Content". The official Genius API returns no lyrics, so a plugin would have to scrape the lyric pages, which the terms forbid.

## Legal note

The plugins here use unofficial APIs. They are not affiliated with, endorsed by or sponsored by NetEase or any other service. Use them at your own responsibility and check the terms of each service. An unofficial API can change or disappear without notice, so a plugin can break when the service changes.

## Tests

Offline tests with Node (host globals stubbed in `tools/translate_harness.js`):

```bash
node tools/check_gemini_translate.js
node tools/check_deepl_translate.js
GEMINI_API_KEY=... node tools/run_gemini_translate_live.js [to] [model] [style]   # live, optional
```

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
