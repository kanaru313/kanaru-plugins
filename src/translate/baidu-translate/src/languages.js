// Kanaru language codes mapped to Baidu Translation Open API codes.
var BAIDU_TARGETS = {
  vi: 'vie',
  en: 'en',
  ja: 'jp',
  ko: 'kor',
  'zh-Hans': 'zh',
  'zh-Hant': 'cht',
  fr: 'fra',
  de: 'de',
  es: 'spa',
  it: 'it',
  ru: 'ru',
  pt: 'pt',
  th: 'th',
  id: 'id',
  hi: 'hi',
  ar: 'ara',
  nl: 'nl',
  sv: 'swe',
  pl: 'pl',
  tr: 'tr',
  uk: 'ukr',
  cs: 'cs',
  el: 'el',
  fa: 'per',
  ro: 'rom',
  ms: 'may',
  he: 'heb',
  fi: 'fin',
  da: 'dan',
  no: 'nor',
  hu: 'hu',
  cy: 'wel',
  sk: 'sk',
  sq: 'alb',
  hy: 'arm',
  eu: 'baq',
  my: 'bur',
  ka: 'geo',
  is: 'ice',
  mk: 'mac',
  mi: 'mao',
};

var BAIDU_SOURCE_TO_KANARU = {
  zh: 'zh-Hans',
  cht: 'zh-Hant',
  vie: 'vi',
  jp: 'ja',
  kor: 'ko',
  fra: 'fr',
  spa: 'es',
  ara: 'ar',
  ben: 'bn',
  per: 'fa',
  may: 'ms',
  heb: 'he',
  swe: 'sv',
  ukr: 'uk',
  rom: 'ro',
  dan: 'da',
  fin: 'fi',
  nor: 'no',
};

function targetLang(to) {
  if (!to || !Object.prototype.hasOwnProperty.call(BAIDU_TARGETS, to)) return null;
  return BAIDU_TARGETS[to];
}

function detectedTag(code) {
  if (typeof code !== 'string' || !code) return undefined;
  var tag = code.trim().toLowerCase();
  return BAIDU_SOURCE_TO_KANARU[tag] || tag;
}
