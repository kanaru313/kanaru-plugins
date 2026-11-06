// Kanaru language codes mapped to Naver Papago Translation API codes.
var PAPAGO_TARGETS = {
  ko: 'ko',
  en: 'en',
  ja: 'ja',
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-TW',
  vi: 'vi',
  id: 'id',
  th: 'th',
  fr: 'fr',
  es: 'es',
  ru: 'ru',
  de: 'de',
  it: 'it',
  pt: 'pt',
};

var PAPAGO_SOURCE_TO_KANARU = {
  ko: 'ko',
  en: 'en',
  ja: 'ja',
  'zh-cn': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  zh: 'zh-Hans',
  vi: 'vi',
  id: 'id',
  th: 'th',
  fr: 'fr',
  es: 'es',
  ru: 'ru',
  de: 'de',
  it: 'it',
  pt: 'pt',
};

function targetLang(to) {
  if (!to || !Object.prototype.hasOwnProperty.call(PAPAGO_TARGETS, to)) return null;
  return PAPAGO_TARGETS[to];
}

function detectedTag(code) {
  if (typeof code !== 'string' || !code) return undefined;
  var tag = code.trim().toLowerCase();
  return PAPAGO_SOURCE_TO_KANARU[tag] || tag;
}
