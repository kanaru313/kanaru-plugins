// Kanaru language codes supported by Microsoft Edge Translate.
var EDGE_TARGETS = {
  vi: 'vi',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  'zh-Hans': 'zh-Hans',
  'zh-Hant': 'zh-Hant',
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
  no: 'nb',
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

var EDGE_SOURCE_TO_KANARU = {
  'zh-hans': 'zh-Hans',
  'zh-hant': 'zh-Hant',
  'zh-cn': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh': 'zh-Hans',
  'nb': 'no',
  'iw': 'he',
  'jw': 'jv',
  'tl': 'fil',
};

function targetLang(to) {
  if (!to || !Object.prototype.hasOwnProperty.call(EDGE_TARGETS, to)) return null;
  return EDGE_TARGETS[to];
}

function detectedTag(code) {
  if (typeof code !== 'string' || !code) return undefined;
  var tag = code.trim().toLowerCase();
  return EDGE_SOURCE_TO_KANARU[tag] || tag;
}
