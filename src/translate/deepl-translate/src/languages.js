// Kanaru language codes that DeepL can produce, and the DeepL `target_lang`
// each one maps to. `en` and `pt` depend on the user's variant settings, so
// they are resolved in targetLang(); keep the keys equal to
// `translate.languages` in plugin.json (tools/check_deepl_translate.js checks).
var DEEPL_TARGETS = {
  vi: 'VI', en: 'EN-US', ja: 'JA', ko: 'KO', 'zh-Hans': 'ZH-HANS', 'zh-Hant': 'ZH-HANT',
  fr: 'FR', de: 'DE', es: 'ES', it: 'IT', ru: 'RU', pt: 'PT-BR', th: 'TH', id: 'ID',
  ar: 'AR', nl: 'NL', sv: 'SV', pl: 'PL', tr: 'TR', uk: 'UK', cs: 'CS', el: 'EL',
  ro: 'RO', he: 'HE', fi: 'FI', da: 'DA', no: 'NB', hu: 'HU', sk: 'SK',
};

// DeepL names Norwegian Bokmål `NB`; the app's table calls it `no`.
var DEEPL_SOURCE_TO_KANARU = { nb: 'no' };

/** DeepL target code for Kanaru code [to], or null when DeepL cannot produce it. */
function targetLang(to, settings) {
  if (!Object.prototype.hasOwnProperty.call(DEEPL_TARGETS, to)) return null;
  if (to === 'en') return settings.englishVariant === 'en-GB' ? 'EN-GB' : 'EN-US';
  if (to === 'pt') return settings.portugueseVariant === 'pt-PT' ? 'PT-PT' : 'PT-BR';
  return DEEPL_TARGETS[to];
}

/**
 * Language tag of the source line from DeepL's `detected_source_language`
 * ("EN", "NB", "ZH"). Bare `zh` is a valid tag; the app only compares it with
 * the target by its base language, so it never hides a Chinese line wrongly.
 */
function detectedTag(code) {
  if (typeof code !== 'string' || !code) return undefined;
  var tag = code.toLowerCase();
  return DEEPL_SOURCE_TO_KANARU[tag] || tag;
}
