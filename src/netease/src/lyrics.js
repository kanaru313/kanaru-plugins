// lyrics.js: the lyrics of one NetEase song.
//
// input is the `id` string of a search result. Returns
//   null                        the song has no lyrics
//   {instrumental: true}        the song has no words
//   {data, type: 'lrc'|'txt'}   synced or plain text
// tlyric (translation) and klyric (word by word) are ignored on purpose.
load('common.js');

// What NetEase puts in `lrc.lyric` when it has nothing: "no lyrics yet".
var PLACEHOLDER = '暂无歌词';
// Credit lines NetEase puts first ("作曲 : name"): not lyrics.
var CREDIT = /^\s*(作词|作曲|编曲|制作人|混音|母带)\s*[:：]/;
// "Pure music, please enjoy": the text of an instrumental without the flag.
var PURE_MUSIC = /^(此歌曲为没有填词的)?纯音乐[，,]\s*请(您)?欣赏[。.!！]?$/;
// Time tags [mm:ss], [mm:ss.xx], [mm:ss:xx] and metadata lines [ti:..], [ar:..].
// NetEase also writes a "-1" style suffix after the time ("[00:00.00-1]");
// group 1 is the plain time the app's LRC parser reads.
var TIME_TAG = /\[(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)(?:-\d+)?\]/g;
var META_LINE = /^\[[a-z]+:.*\]$/i;

function execute(id) {
  // An id that is not digits cannot come from search.js: a bug, so an error.
  if (!/^\d{1,20}$/.test(String(id))) {
    return invalidResponse('the id is not a NetEase song id');
  }
  var got = neteaseGet('/api/song/lyric', { id: String(id), lv: -1, tv: -1, kv: -1 });
  if (got.failure) return got.failure;

  var json = got.json;
  if (json.pureMusic === true || json.nolyric === true) {
    return Response.success({ instrumental: true });
  }
  // A known "no lyrics" flag explains a missing lrc; without one, a missing
  // lrc means the format changed.
  var noLyricsFlag = json.uncollected === true || json.needDesc === true;

  var lrc = json.lrc;
  if (lrc != null && (typeof lrc !== 'object' || Array.isArray(lrc))) {
    return invalidResponse('lrc is not an object');
  }
  var text = lrc == null ? null : lrc.lyric;
  if (text != null && typeof text !== 'string') {
    return invalidResponse('lrc.lyric is not a string');
  }
  if (text == null) {
    return noLyricsFlag ? Response.success(null) : invalidResponse('the answer has no lrc.lyric');
  }

  // Real lyrics win even when `uncollected` is set; only what is left after
  // removing stamps and credits decides.
  var lines = realLines(text);
  if (lines.length === 0) return Response.success(null);
  if (lines.length === 1 && lines[0] === PLACEHOLDER) return Response.success(null);
  if (lines.length === 1 && PURE_MUSIC.test(lines[0])) {
    return Response.success({ instrumental: true });
  }
  // The full text is returned, credits included. Synced when a [mm:ss stamp
  // is present, plain text otherwise.
  // NetEase's odd stamps are rewritten to the plain form the app reads.
  var synced = /\[\d{1,3}:\d{1,2}/.test(text);
  if (synced) text = text.replace(TIME_TAG, '[$1]');
  return Response.success({ data: text, type: synced ? 'lrc' : 'txt' });
}

// The lines of the text without time tags, metadata lines, credit lines and
// blank lines. Other brackets such as [Chorus] are lyrics and stay.
function realLines(text) {
  var out = [];
  var all = text.split(/\r?\n/);
  for (var i = 0; i < all.length; i++) {
    var line = all[i].replace(TIME_TAG, '').trim();
    if (line !== '' && !META_LINE.test(line) && !CREDIT.test(line)) out.push(line);
  }
  return out;
}
