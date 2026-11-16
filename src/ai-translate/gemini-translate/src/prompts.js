// Prompt pieces of the Gemini lyrics translator: language names, the four
// styles and the default system prompt. The default prompt must stay equal to
// `config.systemPrompt.default` in plugin.json (tools/check_gemini_translate.js checks).

var LANGUAGE_NAMES = {
  vi: 'Vietnamese', en: 'English', ja: 'Japanese', ko: 'Korean',
  'zh-Hans': 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese',
  fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', ru: 'Russian',
  pt: 'Portuguese', th: 'Thai', id: 'Indonesian', hi: 'Hindi', ar: 'Arabic',
  nl: 'Dutch', sv: 'Swedish', pl: 'Polish', tr: 'Turkish', uk: 'Ukrainian',
  cs: 'Czech', el: 'Greek', fa: 'Persian', ro: 'Romanian', ms: 'Malay',
  he: 'Hebrew', fi: 'Finnish', da: 'Danish', no: 'Norwegian (Bokmål)',
  hu: 'Hungarian', cy: 'Welsh', sk: 'Slovak', sq: 'Albanian', hy: 'Armenian',
  eu: 'Basque', my: 'Burmese', ka: 'Georgian', is: 'Icelandic',
  mk: 'Macedonian', mi: 'Māori',
};

// One rule per `style` option of plugin.json.
var STYLE_RULES = {
  natural:
    'STYLE: natural. Say what each line means the way a fluent native speaker ' +
    'would say it, and keep its feeling (tender, bitter, playful, proud).',
  literal:
    'STYLE: close to the original. Keep the wording and the images of each ' +
    'line so a learner can match it word by word with the source; stay ' +
    'grammatical, but prefer accuracy over elegance.',
  poetic:
    'STYLE: poetic. Render each line as poetry: keep its images, metaphors ' +
    'and rhythm, and pick lyrical words, but never add an image the source ' +
    'does not have.',
  singable:
    'STYLE: singable. Each line should fit the original melody: aim for about ' +
    'the same number of syllables and the same stress pattern, and rhyme ' +
    'where the original rhymes, while keeping the core meaning of the line.',
};

// Extra advice for some target languages, where lyrics go wrong most often.
var TARGET_NOTES = {
  vi:
    'Vietnamese has no neutral "I/you": choose one pronoun pair (anh/em, ' +
    'em/anh, tôi/em, ta/người, mình/cậu…) that fits the singer and the ' +
    'relationship the song describes, and keep it for the whole song.',
  ja: 'Keep one consistent first-person pronoun (私, 僕, 俺…) that fits the singer.',
  ko: 'Keep one speech level (반말 or 존댓말) for the whole song.',
};

var DEFAULT_SYSTEM_PROMPT =
  'You translate song lyrics into {target_language}. The source language is ' +
  'not given and may change from line to line: detect it for each line.\n' +
  '\n' +
  'The user message is JSON. "lines" is a list of {"i": number, "t": text}: ' +
  'the lines to translate. "song", when present, describes the song and may ' +
  'hold its full lyrics: it is context only, never translate or return it.\n' +
  '\n' +
  'Rules:\n' +
  '- Return exactly one item per input line, with the same "i". Never merge, ' +
  'split, drop, reorder or add lines, even when a sentence runs over several ' +
  'lines.\n' +
  '- "t" is the translation of that line alone; "l" is the language you ' +
  'detected for the original line, as a BCP 47 code ("ja", "en", "ko"; for ' +
  'Chinese always "zh-Hans" or "zh-Hant"). Give "l" for every line.\n' +
  '- A line already in {target_language}, or a line that is only a name, an ' +
  'ad-lib or a sound ("oh", "yeah", "la la la", "na na na"), comes back ' +
  'unchanged.\n' +
  '- The singer\'s voice stays the same over all lines: who "I" and "you" ' +
  'are, and the tone between them.\n' +
  '- Keep proper nouns and numbers. Add no notes, quotes, romanization or ' +
  'explanations.\n' +
  '\n' +
  '{target_notes}\n' +
  '\n' +
  '{style_prompt}\n' +
  '\n' +
  '{song_prompt}\n' +
  '\n' +
  '{custom_instruction}';

/** Display name of a language code for the prompt. */
function languageName(code) {
  return LANGUAGE_NAMES[code] || code;
}

/**
 * Fills [template] (the user's system prompt, or the default when empty).
 * Unknown `{names}` are left as written; empty parts collapse.
 */
function buildSystemPrompt(template, to, settings, song) {
  var values = {
    target_language: languageName(to),
    target_notes: TARGET_NOTES[to] || '',
    style_prompt: STYLE_RULES[settings.style] || STYLE_RULES.natural,
    song_prompt: songPrompt(song),
    custom_instruction: settings.customInstruction
      ? 'USER REQUEST (follow it unless it breaks the line rules):\n' + settings.customInstruction
      : '',
  };
  var text = template || DEFAULT_SYSTEM_PROMPT;
  for (var key in values) {
    text = text.split('{' + key + '}').join(values[key]);
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function songPrompt(song) {
  if (!song) return '';
  var parts = [];
  if (song.title) parts.push('"' + song.title + '"');
  if (song.artist) parts.push('by ' + song.artist);
  var about = parts.length ? 'The song is ' + parts.join(' ') + '. ' : '';
  var lyrics = song.lyrics ? 'Its full lyrics are in "song.lyrics"; use them to keep the lines consistent.' : '';
  return (about + lyrics).trim();
}
