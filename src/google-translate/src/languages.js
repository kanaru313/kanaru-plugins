// Kanaru language codes that Google Translate can produce, and the target code
// each one maps to. Keep the keys equal to `translate.languages` in plugin.json.
var GOOGLE_TARGETS = {
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

// Google Translate detected language codes mapped to Kanaru language codes.
var GOOGLE_SOURCE_TO_KANARU = {
  'zh-cn': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh': 'zh-Hans',
  'iw': 'he',
  'jw': 'jv',
  'tl': 'fil',
};

/** Google Translate target code for Kanaru code [to], or null when unsupported. */
function targetLang(to) {
  if (!to || !Object.prototype.hasOwnProperty.call(GOOGLE_TARGETS, to)) return null;
  return GOOGLE_TARGETS[to];
}

/**
 * Maps a detected source language code from Google Translate to Kanaru's tag.
 */
function detectedTag(code) {
  if (typeof code !== 'string' || !code) return undefined;
  var tag = code.trim().toLowerCase();
  return GOOGLE_SOURCE_TO_KANARU[tag] || tag;
}
