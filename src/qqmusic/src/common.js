// Helpers shared by search.js and lyrics.js. A script reaches this file with
// load('common.js'): every file of src/ runs in one global scope.
//
// QQ Music (QQ音乐) web API client. Communicates with c.y.qq.com.
var QQ_SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
var QQ_LYRIC_URL = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';

var QQ_HEADERS = {
  'Referer': 'https://y.qq.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

var PLACEHOLDER = '暂无歌词';
var PURE_MUSIC = /^(此歌曲为(?:没有填词的)?)?纯音乐[，,\s]*请(您)?欣赏[。.!！]?$/;
var TIME_TAG = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g;
var META_LINE = /^\[[a-z]+:.*\]$/i;

var CREDIT_ROOTS = [
  '作词', '作詞', '作曲', '编曲', '編曲', '制作', '监制', '混音', '母带',
  '录音', '錄音', '和声', '和聲', '和音', '吉他', '贝斯', '貝斯', '鼓手',
  '弦乐', '弦樂', '键盘', '鍵盤', '钢琴', '鋼琴', '配唱', '出品', '发行',
  '發行', '企划', '企劃', '统筹', '統籌', '策划', '策劃', '演唱', '原唱', '翻唱'
];

var CREDIT = new RegExp(
  '^\\s*(?:(?:written|composed|arranged|arranger|produced|producer|lyrics?|mixed|mastered|recorded|vocals?|guitars?|bass|drums?)\\s*(?:by)?|(?:' +
  CREDIT_ROOTS.join('|') + ')[\u3400-\u9fff]{0,6}|词|曲)\\s*[:：]', 'i');

function invalidResponse(why) {
  return Response.error(why, { kind: 'invalidResponse' });
}

function htmlDecode(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#58;/g, ':')
    .replace(/&#32;/g, ' ')
    .replace(/&#40;/g, '(')
    .replace(/&#41;/g, ')')
    .replace(/&#(\d+);/g, function(match, dec) {
      return String.fromCharCode(dec);
    })
    .replace(/&amp;/g, '&');
}

function qqGet(url, queries) {
  var res = fetch(url, {
    headers: QQ_HEADERS,
    queries: queries
  });

  if (res.status === 429) {
    var retryAfter = 60;
    var h = res.header('retry-after');
    if (h) {
      var parsed = parseInt(h, 10);
      if (!isNaN(parsed) && parsed > 0) retryAfter = parsed;
    }
    return { failure: Response.error('rate limited by QQ Music', { kind: 'rateLimited', retryAfterSec: retryAfter }) };
  }

  if (res.status !== 200) {
    return { failure: Response.error('HTTP ' + res.status + ' from QQ Music', { kind: 'server' }) };
  }

  var data;
  try {
    data = res.json();
  } catch (e) {
    return { failure: invalidResponse('bad JSON response from QQ Music') };
  }

  return { data: data };
}

function content(line) {
  return line.replace(TIME_TAG, '').trim().normalize('NFC');
}

function realLines(text) {
  var out = [];
  var all = text.split(/\r?\n/);
  for (var i = 0; i < all.length; i++) {
    var c = content(all[i]);
    if (c !== '' && !META_LINE.test(c) && !CREDIT.test(c)) {
      out.push(c);
    }
  }
  return out;
}

function stripCredits(text) {
  var all = text.split(/\r?\n/);
  var start = 0;
  for (var i = 0; i < all.length; i++) {
    var c = content(all[i]);
    if (CREDIT.test(c)) start = i + 1;
    else if (c !== '' && !META_LINE.test(c)) break;
  }
  var end = all.length;
  while (end > start) {
    var rawLine = all[end - 1].trim();
    var d = content(rawLine);
    if (rawLine === '' || CREDIT.test(d)) end--;
    else break;
  }
  if (start === 0 && end === all.length) return text;
  return all.slice(start, end).join('\n');
}
