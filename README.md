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

Chi tiết tài liệu hướng dẫn phát triển và quy chuẩn viết plugin xem tại:
👉 **[Tài liệu hướng dẫn phát triển Plugin (templates/README.md)](./templates/README.md)**

### Config Schema Reference

Mục `config` trong `plugin.json` hỗ trợ tối đa 20 trường. Kanaru hỗ trợ chính xác **5 mode** cấu hình (theo `lib/core/lyrics/plugins/package/plugin_config_parser.dart`):

| Mode | Format | Các thuộc tính bổ sung | Kiểu `default` | Giá trị khi đọc `localConfig.getItem(key)` |
| :--- | :--- | :--- | :--- | :--- |
| `input` | `text` *(mặc định)* | `placeholder`, `minLength`, `maxLength` | `string` | `string` hoặc `null` |
| `input` | `multiline` | `rows` (1–10, mặc định 3), `minLength`, `maxLength` | `string` | `string` hoặc `null` |
| `input` | `number` | `min`, `max`, `step` (số thực) | finite number | `number` hoặc `null` |
| `input` | `integer` | `min`, `max`, `step` (số nguyên) | integer | `number` hoặc `null` |
| `input` | `secret` | `placeholder` (lưu an toàn trong OS Keyring) | *không có* | `string` hoặc `null` |
| `input` | `url` | `placeholder` | string URL (`https://...`) | `string` hoặc `null` |
| `select` | `single` *(mặc định)* | `options: [{ value, title, subtitle? }]` | `string` (thuộc options) | `string` hoặc `null` |
| `select` | `multiple` | `options`, `minItems`, `maxItems` | `string[]` | `string[]` hoặc `null` |
| `toggle` | *(không có)* | *(không có)* | `boolean` (`true`/`false`) | `boolean` hoặc `null` |
| `list` | `text` / `number` / `integer` / `url` | `placeholder`, `minItems`, `maxItems` (≤ 50) | `Array` tương ứng | `Array` hoặc `null` |
| `map` | `text` *(hoặc để trống)* | `maxItems` (≤ 50) | Object key-value | `Object` hoặc `null` |

> **Lưu ý**: Tuyệt đối không dùng các mode ngoài 5 mode trên (ví dụ không dùng `textarea`, hãy dùng `mode: "input"` với `format: "multiline"`).

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

### LRCLIB (`lrclib`)

Finds synced (LRC) and plain text lyrics from LRCLIB (`lrclib.net`), the largest open community-driven lyrics database.

- Direct access via LRCLIB's official public REST API (`lrclib.net/api`).
- Returns high-quality synchronized LRC lyrics when available, plain text otherwise.
- Identifies and marks instrumental tracks (`instrumental: true`).
- Supports search by song tags (title, artist, album, duration) and manual search queries.
- Completely free with no API key, cookie, or login required; only the host `lrclib.net` is used.

### Megalobiz (`megalobiz`)

Finds synchronized (LRC) lyrics from Megalobiz (`megalobiz.com`) through its official public developer API (`api.megalobiz.com`).

- Search by title, artist, duration matching, or free text query.
- Returns synchronized LRC timestamps. Automatically cleans Megalobiz metadata headers.
- Works out of the box with free anonymous access; optionally accepts a custom API key from https://megalobiz.com/developers for higher rate limits.
- Only the host `api.megalobiz.com` is used.

### Vocaloid Lyrics Wiki (`vocaloidlyrics`)

Finds multi-version Vocaloid, CeVIO, Utaite, and Synthesizer V lyrics from Vocaloid Lyrics Wiki (`vocaloidlyrics.miraheze.org`).

- Search by song title, producer/artist, or free text query via the MediaWiki search API.
- Extracts original Japanese lyrics, Romaji transliteration, and English translation from wiki tables.
- Configurable `preferredSection` setting: "All sections (Japanese, Romaji, English)" (default), "Romaji only", "Original Japanese only", or "English translation only".
- Completely free with no API key or login required; only the host `vocaloidlyrics.miraheze.org` is used.

### Anime Song Lyrics (`animesonglyrics`)

Finds Japanese anime songs, opening, and ending themes from Anime Song Lyrics (`animesonglyrics.com`).

- Search by song title and artist.
- Extracts side-by-side lyrics: Romaji, Kanji / Japanese, and English translation.
- Configurable `preferredSection` setting: "All sections (Romaji, Kanji, English)" (default), "Romaji only", "Kanji only", or "English only".
- Only the host `www.animesonglyrics.com` is used.

### Kuwo Music (`kuwo`)

Finds synchronized (LRC) lyrics from Kuwo Music (酷我音乐, `kuwo.cn` / `search.kuwo.cn`).

- Search by song title, artist, or query text using Kuwo's search API.
- Fetches synchronized LRC lyrics via Kuwo's lyric service, decoding numeric character references and formatting timestamps (`[mm:ss.xx]`).
- Detects instrumental tracks (`此歌曲为没有填词的纯音乐，请您欣赏`).
- Cleans intro/outro credit tags (`作词`, `作曲`, `编曲`, etc.).
- Only the hosts `search.kuwo.cn` and `kuwo.cn` are used.

### Hợp Âm Chuẩn (`hopamchuan`)

Finds Vietnamese lyrics and guitar chords from Hợp Âm Chuẩn (`hopamchuan.com`).

- Search by song title and singer/composer name.
- Extracts song lyrics with inline guitar chords (`[Am]`, `[F]`, `[C]`, `[G]`).
- Configurable `showChords` setting: toggle inline chord display on (default) or off (pure lyrics without chord annotations).
- Only the host `hopamchuan.com` is used.

### Gemini Translate (`gemini-translate`)

Translates lyrics line by line with the Google Gemini API (`generativelanguage.googleapis.com`), keeping the singer's voice and the line count.

- Needs Kanaru with translate plugin support (PR #100) and your own API key from https://aistudio.google.com/app/apikey. The key is kept in the system keyring, never in the database or logs. Several keys can be listed; the next is used when one is refused or out of quota.
- **What is sent to Google:** the lines to translate; with *Send the song as context* on (default), also the title, artist and the full lyrics of the song. Check Google's terms and data policy for the API tier of your key.
- Gemini detects the source language of each line; lines already in the target language are hidden by the app.
- Options: model, style (natural, close, poetic, singable), thinking, temperature, safety filter, retry of skipped lines, your own instruction and a full system prompt.
- Errors: all keys refused is *key*, a daily quota is *quota*, a per-minute limit is *rate limited*. A run uses at most 10 sends.

### ChatGPT Translate (`chatgpt-translate`)

Translates lyrics line by line with the OpenAI ChatGPT API (`api.openai.com`), keeping the singer's voice and the lines in sync.

- Needs Kanaru with translate plugin support and your own OpenAI API key from https://platform.openai.com/api-keys. Multiple keys can be specified; the next key is used when one is refused or out of quota.
- **What is sent to OpenAI:** the lines to translate; with *Send the song as context* on (default), also the title, artist and full lyrics of the song as context.
- Model list: `gpt-6-luna` (default), `gpt-6.1-sol`, `gpt-6-astra`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5`, `gpt-4.1`, `gpt-4o`, etc.
- Options: model, reasoning effort (`auto`, `none`, `low`, `medium`, `high`), style (natural, literal, poetic, singable), temperature, max output tokens, retry of skipped lines, custom instruction, full system prompt.
- Errors: 401/403 is *key*, 429 quota is *quota*, 429 rate limit is *rate limited*. A run uses at most 10 sends.

### Claude Translate (`claude-translate`)

Translates lyrics line by line with the Anthropic Claude API (`api.anthropic.com`), keeping the singer's voice and the lines in sync.

- Needs Kanaru with translate plugin support and your own Anthropic API key from https://console.anthropic.com. Multiple keys can be specified; rotates upon failure.
- **What is sent to Anthropic:** the lines to translate; with *Send the song as context* on (default), also the title, artist and lyrics context.
- Model list: `claude-opus-5` (default), `claude-fable-5-1`, `claude-sonnet-5`, `claude-haiku-4-5`, `claude-3-7-sonnet-latest`, `claude-3-5-sonnet-latest`, etc.
- Options: model, style (natural, literal, poetic, singable), temperature (on models that accept temperature), max output tokens, retry of skipped lines, custom instruction, full system prompt.
- Errors: 401/403 is *key*, 429 is *rate limited*, 529 is overloaded server.

### DeepSeek Translate (`deepseek-translate`)

Translates lyrics line by line with the DeepSeek API (`api.deepseek.com`), keeping the singer's voice and the lines in sync.

- Needs Kanaru with translate plugin support and your own DeepSeek API key from https://platform.deepseek.com. Multiple keys can be specified; rotates upon failure.
- **What is sent to DeepSeek:** the lines to translate; with *Send the song as context* on (default), also the title, artist and lyrics context.
- Model list: `deepseek-flash` (default), `deepseek-flash-thinking`, `deepseek-v4-pro`, `deepseek-v4-pro-thinking`, `deepseek-chat`, `deepseek-reasoner`.
- Options: model, style (natural, literal, poetic, singable), temperature, max output tokens, retry of skipped lines, custom instruction, full system prompt.
- Errors: 401/403 is *key*, 402 is *quota* (Insufficient Balance), 429 is *rate limited*.

### Grok Translate (`grok-translate`)

Translates lyrics line by line with the xAI Grok API (`api.x.ai`), keeping the singer's voice and the lines in sync.

- Needs Kanaru with translate plugin support and your own xAI API key from https://console.x.ai. Multiple keys can be specified; rotates upon failure.
- **What is sent to xAI:** the lines to translate; with *Send the song as context* on (default), also the title, artist and lyrics context.
- Model list: `grok-4.20-0309-non-reasoning` (default), `grok-4.20-0309-reasoning`, `grok-4.3`, `grok-4.5`, `grok-4.7`, `grok-2-latest`, `grok-beta`.
- Options: model, reasoning effort, style (natural, literal, poetic, singable), temperature, max output tokens, retry of skipped lines, custom instruction, full system prompt.
- Errors: 401/403 is *key*, 429 is *rate limited* or *quota*.

### OpenAI-compatible Translate (`openai-compatible`)

Translates lyrics line by line with any OpenAI-compatible API (DeepSeek, OpenRouter, Groq, Together AI, SiliconFlow, Mistral, etc.), keeping the singer's voice and the lines in sync.

- Connects to any service implementing the OpenAI chat completions format. Default base URL is `https://api.deepseek.com/v1`, default model is `deepseek-chat`.
- Automatically normalizes the base URL, appends `/v1` when missing, and handles Google Gemini's `/openai` layer.
- Options: Base URL, API keys, model name (free-form text input), style, temperature, max output tokens, retry of skipped lines, custom instruction, system prompt.
- Supported hosts declared in manifest: DeepSeek, OpenAI, OpenRouter, Groq, Together, Mistral, Google Gemini, SiliconFlow, Moonshot, MiniMax, Qwen DashScope, Novita, Fireworks, xAI, Perplexity, Cohere, Cloudflare, DeepInfra.

### DeepL Translate (`deepl-translate`)

Translates lyrics line by line with the DeepL API v2 (`api-free.deepl.com` for keys ending in `:fx`, `api.deepl.com` otherwise).

- Needs Kanaru with translate plugin support (PR #100) and your own DeepL API key (the Free plan works). The key is kept in the system keyring.
- **What is sent to DeepL:** the lines to translate; with *Send the song as context* on (default), also a short context text with the title and artist (not translated, not billed). The lyrics themselves are not sent as context.
- Options: formality (`prefer_more` / `prefer_less`, used only where DeepL supports it), English variant (US/GB), Portuguese variant (BR/PT).
- Languages: the 29 languages of Kanaru's table that DeepL can produce. Hindi, Persian, Malay, Welsh, Albanian, Armenian, Basque, Burmese, Georgian, Icelandic, Macedonian and Maori are not offered.
- One send per chunk of up to 50 lines. Errors: 403 is *key*, 456 *quota*, 429/529 *rate limited*, 5xx *server*.

### Google Translate (`google-translate`)

Translates lyrics line by line using Google Translate.

- **Works out of the box without an API key** using the free web service (`translate.googleapis.com` or `translate.google.com`).
- Optionally supports official **Google Cloud Translation API v2** keys (`translation.googleapis.com`) with automatic key rotation upon rate-limiting or quota exhaustion.
- Options: Google Translate service domain (`translate.googleapis.com` / `translate.google.com`), optional Cloud Translation API keys, preserve empty and musical symbol lines (`♪`, `(x2)`).
- Languages: supports all 41 languages in Kanaru's standard language table.
- Automatic HTML entity decoding and source language detection mapping.

### Immersive Translate (`immersive-translate`)

Translates lyrics line by line using Immersive Translate's AI engines.

- Uses your own `user_token` from the official Immersive Translate extension or account profile (https://immersivetranslate.com/profile/).
- Model list: `babelfast-pro` (BabelFast, fast and optimized), `deepl-pro` (DeepL Pro), `deepseek-pro`, `gemini-pro`, `openai-pro`, `claude-pro`, `qwen-pro`, `grok-pro`, `openai-max` (GPT-5.4), `claude-max` (Claude Sonnet 4.6), `gemini-max`, `kimi-max`, `zhipu-max`.
- Supports SSE streaming response and preserves musical symbol lines (`♪`, `(x2)`).

### Edge Translate (`edge-translate`)

Translates lyrics line by line using Microsoft Edge's translation service (`edge.microsoft.com`).

- **Works out of the box with no API key or token required**.
- Sends text chunks as structured JSON arrays, matching the Edge browser translator.
- Preserves empty and musical symbol lines (`♪`, `(x2)`).

### Baidu Translate (`baidu-translate`)

Translates lyrics line by line using the official Baidu Translation Open API (`fanyi-api.baidu.com`).

- Requires your own Baidu Translation App ID and Secret Key from https://fanyi-api.baidu.com.
- Uses MD5 request signing (`load('crypto.js')`) and maps Baidu language codes (`vie`, `zh`, `cht`, `jp`, `kor`, `fra`, `spa`...).
- Preserves empty and musical symbol lines (`♪`, `(x2)`).

### Naver Papago Translate (`papago-translate`)

Translates lyrics line by line using the official Naver Papago Translation API (`papago.apigw.ntruss.com` or `openapi.naver.com`).

- Renowned for industry-leading translation quality for Korean (K-Pop) and Japanese (J-Pop/Anime).
- Supports both **NAVER Cloud Platform (NCP)** (`X-NCP-APIGW-API-KEY-ID` / `X-NCP-APIGW-API-KEY`) and **Naver Developers** (`X-Naver-Client-Id` / `X-Naver-Client-Secret`).
- Automatic source language detection (`source=auto`) and language code mapping (`ko`, `ja`, `zh-CN`, `zh-TW`, `vi`, `id`, `th`, `en`...).
- Optional honorific speech style (존댓말) toggle for Korean translations (`honorific=true`).
- Automatic fallback to line-by-line translation if a multiline batch returns mismatched line counts.
- Preserves empty and musical symbol lines (`♪`, `(x2)`).

### Qwen Translate (`qwen-translate`)

Translates lyrics line by line using Alibaba Cloud DashScope (Qwen) API (`dashscope-intl.aliyuncs.com` or `dashscope.aliyuncs.com`).

- Renowned for outstanding comprehension of Chinese, Japanese, and multilingual nuance.
- Uses OpenAI-compatible API format with structured JSON outputs.
- Multiple model choices: `qwen-plus` (balanced default), `qwen-turbo` (fast), `qwen-max` (flagship), specialized machine translation models (`qwen-mt-plus`, `qwen-mt-turbo`), open weights `qwen2.5-72b-instruct` / `qwen2.5-32b-instruct` / `qwen2.5-14b-instruct` / `qwen2.5-7b-instruct`, or custom model names.
- Region selection: International (Singapore) or China Mainland (Beijing), plus optional custom endpoint override.
- Automatic key rotation, retry on untranslated lines, and musical symbol line preservation (`♪`, `(x2)`).

### Genius: not shipped

There is no Genius plugin on purpose. The Genius Terms of Service (Last Updated January 13, 2026, https://genius.com/static/terms) say: "In connection with your use of the Service you shall not engage in or use any data mining, robots, scraping or similar data gathering or extraction methods" and "you agree not to modify, copy, frame, scrape, ... the Service or the Genius Content". The official Genius API returns no lyrics, so a plugin would have to scrape the lyric pages, which the terms forbid.

## Legal note

The plugins here use unofficial APIs. They are not affiliated with, endorsed by or sponsored by NetEase or any other service. Use them at your own responsibility and check the terms of each service. An unofficial API can change or disappear without notice, so a plugin can break when the service changes.

## Tests

Offline tests with Node (host globals stubbed in `tools/translate_harness.js`):

```bash
node tools/check_gemini_translate.js
node tools/check_deepl_translate.js
node tools/check_google_translate.js
node tools/check_immersive_translate.js
node tools/check_edge_translate.js
node tools/check_baidu_translate.js
node tools/check_papago_translate.js
node tools/check_chatgpt_translate.js
node tools/check_claude_translate.js
node tools/check_deepseek_translate.js
node tools/check_qwen_translate.js
node tools/check_grok_translate.js
node tools/check_openai_compatible.js
node tools/check_lrclib_lyrics.js
node tools/check_megalobiz_lyrics.js
node tools/check_vocaloidlyrics_lyrics.js
node tools/check_animesonglyrics_lyrics.js
node tools/check_kuwo_lyrics.js
node tools/check_hopamchuan_lyrics.js
GEMINI_API_KEY=... node tools/run_gemini_translate_live.js [to] [model] [style]   # live, optional
```

## Build

```bash
python3 tools/build.py
```

Zips every `src/<slug>/` into `dist/<slug>/plugin.zip` and rewrites `plugins.json`
(the catalog). Catalog paths are relative, so the same catalog works from GitHub and
from a local server.

### Languages

`metadata.languages` (optional) lists the languages a plugin serves, as ISO 639 codes
(639-1 preferred: `"vi"`, `"zh"`, `"ja"`, `"ko"`) or `"*"` for global. `tools/build.py` copies it
into each `plugins.json` entry. Kanaru's plugin store uses it for the Language filter; a missing
field means global. For translate plugins it describes the lyrics languages, not the
`translate.languages` target list.

## Use

- **Install one plugin locally**: Kanaru → Settings → Lyrics → Lyrics sources → Plugin store → ⋮ → Install from file… → pick `dist/<slug>/plugin.zip`.
- **Repository (remote)**: add `https://raw.githubusercontent.com/kanaru313/kanaru-plugins/main/plugins.json`.
- **Repository (local)**: `python3 -m http.server 8765` in this folder, then add `http://localhost:8765/plugins.json`.

When you change a plugin, bump `metadata.version` in its `plugin.json` and rebuild.
