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
// Credit lines NetEase puts at the start or end ("作曲 : name", "录音师 : name"):
// not lyrics. A credit is a role root plus up to 6 more CJK chars (so 录音师,
// 混音工程师, 混音录音室 match) and a colon; the colon is required, so a lyric
// such as 曲终人散 stays. The single-char roles 词 and 曲 take no suffix, or
// 词不达意: would match. No Latin roles (OP, SP, ...): they collide with
// English lyrics. The block rule in stripCredits keeps a mid-song match.
var CREDIT_ROOTS = [
  '作词', '作詞', '作曲', '编曲', '編曲', '制作', '监制', '混音', '母带',
  '录音', '錄音', '和声', '和聲', '和音', '吉他', '贝斯', '貝斯', '鼓手',
  '弦乐', '弦樂', '键盘', '鍵盤', '钢琴', '鋼琴', '配唱', '出品', '发行',
  '發行', '企划', '企劃', '统筹', '統籌', '策划', '策劃', '演唱', '原唱', '翻唱'
];
var CREDIT = new RegExp(
  '^\\s*(?:(?:' + CREDIT_ROOTS.join('|') + ')[\u3400-\u9fff]{0,6}|词|曲)\\s*[:：]');
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
  // The text is returned without the credit lines at its start and end. Synced
  // when a [mm:ss stamp is present, plain text otherwise.
  // NetEase's odd stamps are rewritten to the plain form the app reads.
  text = stripCredits(text);
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

// The text without its leading and trailing credit blocks; a credit-looking
// line between lyric lines stays. Rule: the leading block is every credit,
// metadata or blank line before the first real line, cut after its last credit
// line, so metadata or blanks before or between credits go with it and
// metadata after the last credit stays. The trailing block is credit and blank
// lines at the end. Nothing to cut: the text is returned as it is.
function stripCredits(text) {
  var all = text.split(/\r?\n/);
  function content(i) { return all[i].replace(TIME_TAG, '').trim(); }
  var start = 0;
  for (var i = 0; i < all.length; i++) {
    var c = content(i);
    if (CREDIT.test(c)) start = i + 1;
    else if (c !== '' && !META_LINE.test(c)) break;
  }
  var end = all.length;
  while (end > start) {
    var d = content(end - 1);
    if (d === '' || CREDIT.test(d)) end--;
    else break;
  }
  if (start === 0 && end === all.length) return text;
  return all.slice(start, end).join('\n');
}
