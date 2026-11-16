// Kanaru language codes supported by Immersive Translate.
var IMT_TARGETS = {
  vi: 'vi',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-TW',
  fr: 'fr',
  de: 'de',
  es: 'es',
  it: 'it',
  ru: 'ru',
  pt: 'pt',
  th: 'th',
  id: 'id',
  hi: 'hi',
  ar: 'ar',
  nl: 'nl',
  sv: 'sv',
  pl: 'pl',
  tr: 'tr',
  uk: 'uk',
  cs: 'cs',
  el: 'el',
  fa: 'fa',
  ro: 'ro',
  ms: 'ms',
  he: 'he',
  fi: 'fi',
  da: 'da',
  no: 'no',
  hu: 'hu',
  cy: 'cy',
  sk: 'sk',
  sq: 'sq',
  hy: 'hy',
  eu: 'eu',
  my: 'my',
  ka: 'ka',
  is: 'is',
  mk: 'mk',
  mi: 'mi',
};

var IMT_SOURCE_TO_KANARU = {
  'zh-cn': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh': 'zh-Hans',
  'iw': 'he',
  'jw': 'jv',
  'tl': 'fil',
};

function targetLang(to) {
  if (!to || !Object.prototype.hasOwnProperty.call(IMT_TARGETS, to)) return null;
  return IMT_TARGETS[to];
}

function detectedTag(code) {
  if (typeof code !== 'string' || !code) return undefined;
  var tag = code.trim().toLowerCase();
  return IMT_SOURCE_TO_KANARU[tag] || tag;
}
