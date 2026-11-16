// Entry of the Immersive Translate lyrics translator (`translate` plugin type).
//
// execute({lines, to, song?}) → Response.success([{text, detected?}]), one
// item per input line, in order.
load('languages.js');

var IMT_API_BASE = 'https://api2.immersivetranslate.com/';

var IMT_MODELS = {
  'babelfast-pro': {
    name: 'BabelFast Pro',
    kind: 'babelfast',
    endpoint: 'auto/translate',
  },
  'deepl-pro': {
    name: 'DeepL Pro',
    kind: 'deepl',
    endpoint: 'deepl/translate',
  },
  'openai-pro': {
    name: 'GPT-5 mini Pro',
    model: 'gpt-5-mini',
    endpoint: 'openai/v1/chat/completions',
    body: { reasoning_effort: 'minimal' },
  },
  'claude-pro': {
    name: 'Claude Haiku 4.5 Pro',
    model: 'claude-haiku-4.5-20251001',
    endpoint: 'claude/translate',
    body: { temperature: 0, max_tokens: 2048 },
  },
  'deepseek-pro': {
    name: 'DeepSeek-V4-Flash Pro',
    model: 'DeepSeek-V4-Flash',
    endpoint: 'deepseek/translate',
    body: { thinking: { type: 'disabled' } },
  },
  'gemini-pro': {
    name: 'Gemini 3 Flash Pro',
    model: 'gemini-3-flash-preview',
    endpoint: 'gemini/translate',
    body: {},
  },
  'qwen-pro': {
    name: 'Qwen 3.5 Plus Pro',
    model: 'qwen3.5-plus',
    endpoint: 'qwen/translate',
    body: { enable_thinking: false },
  },
  'grok-pro': {
    name: 'Grok 4.3 Pro',
    model: 'grok-4-3',
    endpoint: 'grok/translate',
    body: {},
  },
  'openai-max': {
    name: 'GPT-5.4 Max',
    model: 'gpt-5.4',
    endpoint: 'openai/v1/chat/completions',
    body: { reasoning_effort: 'none' },
  },
  'claude-max': {
    name: 'Claude Sonnet 4.6 Max',
    model: 'claude-sonnet-4-6',
    endpoint: 'claude/translate',
    body: { temperature: 0, max_tokens: 2048, thinking: { type: 'disabled' } },
  },
  'gemini-max': {
    name: 'Gemini 3.1 Pro Max',
    model: 'gemini-3.1-pro-preview',
    endpoint: 'gemini/translate',
    body: {},
  },
  'kimi-max': {
    name: 'Kimi K2.5 Max',
    model: 'kimi-k2.5',
    endpoint: 'kimi/translate',
    body: {},
  },
  'zhipu-max': {
    name: 'GLM-5 Max',
    model: 'GLM-5',
    endpoint: 'bigmodel/translate',
    body: { temperature: 0.01, top_p: 0.1, max_tokens: 2048, thinking: { type: 'disabled' } },
  },
};

function execute(input) {
  var lines = input && input.lines;
  if (!Array.isArray(lines)) return Response.error('The app sent no lines to translate');

  var settings = readSettings();
  var target = targetLang(String(input.to || ''));
  if (!target) return Response.error('Immersive Translate cannot translate into "' + input.to + '"');
  if (!settings.userToken) {
    return Response.error('Add your Immersive Translate user token in the plugin settings', { kind: 'auth' });
  }

  // Blank lines and symbol lines without letters (♪, "...", "(x2)") go back as they are.
  var out = lines.map(function (line) {
    return (settings.keepSymbols && !hasWords(line)) ? { text: String(line == null ? '' : line) } : null;
  });

  var todo = [];
  for (var i = 0; i < lines.length; i++) {
    if (!out[i]) todo.push(i);
  }
  if (todo.length === 0) return Response.success(out);

  var todoLines = todo.map(function (idx) {
    return String(lines[idx] == null ? '' : lines[idx]);
  });

  var modelConfig = IMT_MODELS[settings.model] || IMT_MODELS['babelfast-pro'];
  var response;

  if (modelConfig.kind === 'babelfast') {
    response = translateBabelFast(todoLines, target, settings.userToken, modelConfig);
  } else if (modelConfig.kind === 'deepl') {
    response = translateDeepL(todoLines, target, settings.userToken, modelConfig);
  } else {
    response = translateLLM(todoLines, target, settings.userToken, modelConfig);
  }

  if (!response || response.ok === false || response.error) return response;

  var translations = response.data !== undefined ? response.data : response.ok;
  for (var k = 0; k < todo.length; k++) {
    out[todo[k]] = translations[k];
  }

  return Response.success(out);
}

function translateBabelFast(lines, target, token, model) {
  var items = [];
  for (var i = 0; i < lines.length; i++) {
    items.push({ id: i, s: [{ k: 'p', cnt: lines[i] }] });
  }

  var body = {
    items: items,
    to: target,
    from: 'auto',
    rp: { tp: 'speed' },
  };

  var res = fetch(IMT_API_BASE + model.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'text/event-stream',
      'accept-language': 'vi',
      'token': token,
    },
    body: JSON.stringify(body),
    timeout: 35000,
  });

  if (!res.ok) return failure(res, model.name);

  var raw = String(res.text() || '');
  var sseLines = raw.split(/\r?\n/);
  var byId = {};

  for (var idx = 0; idx < sseLines.length; idx++) {
    var line = sseLines[idx].trim();
    if (line.indexOf('data:') !== 0) continue;
    var dataStr = line.substring(5).trim();
    if (!dataStr || dataStr === '[DONE]') continue;
    var json;
    try {
      json = JSON.parse(dataStr);
    } catch (_) {
      continue;
    }
    if (json.code && json.code !== 0) {
      return Response.error('Immersive Translate: ' + (json.errorMessage || json.error || 'code ' + json.code), { kind: 'auth' });
    }
    var rows = json.tr || [];
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j];
      if (row && row.k === 'ok' && typeof row.id === 'number') {
        var pieces = row.tr || [];
        var values = [];
        for (var p = 0; p < pieces.length; p++) {
          if (pieces[p] && typeof pieces[p].cnt === 'string') values.push(pieces[p].cnt);
        }
        byId[row.id] = values.join('');
      }
    }
  }

  var results = [];
  for (var k = 0; k < lines.length; k++) {
    var translatedText = typeof byId[k] === 'string' ? byId[k].trim() : '';
    results.push({
      text: decodeHtml(translatedText || lines[k]),
    });
  }
  return Response.success(results);
}

function translateDeepL(lines, target, token, model) {
  var body = {
    text: lines,
    target_lang: target.toUpperCase(),
    model_type: 'quality_optimized',
  };

  var res = fetch(IMT_API_BASE + model.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'token': token,
    },
    body: JSON.stringify(body),
    timeout: 35000,
  });

  if (!res.ok) return failure(res, model.name);

  var data;
  try {
    data = res.json();
  } catch (e) {
    return Response.error('DeepL Pro sent non-JSON response', { kind: 'invalidResponse' });
  }

  var translations = data && (data.translations || (data.data && data.data.translations));
  if (!Array.isArray(translations) || translations.length !== lines.length) {
    return Response.error('DeepL Pro returned unexpected format', { kind: 'invalidResponse' });
  }

  var results = [];
  for (var i = 0; i < lines.length; i++) {
    var t = translations[i];
    results.push({
      text: decodeHtml(String((t && t.text) || '').trim()),
      detected: detectedTag(t && t.detected_source_language),
    });
  }
  return Response.success(results);
}

function translateLLM(lines, target, token, model) {
  var promptLines = lines.map(function (l, i) {
    return '[' + (i + 1) + '] ' + l;
  }).join('\n');

  var systemPrompt = 'You are a professional lyrics translator. Translate each numbered line from the song into ' +
    target + '. Keep the exact line numbers [1], [2] at the beginning of each translated line. Output only the numbered lines.';

  var body = {
    model: model.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: promptLines },
    ],
  };

  if (model.body) {
    for (var key in model.body) {
      if (Object.prototype.hasOwnProperty.call(model.body, key)) {
        body[key] = model.body[key];
      }
    }
  }

  var res = fetch(IMT_API_BASE + model.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept-language': 'vi',
      'token': token,
    },
    body: JSON.stringify(body),
    timeout: 40000,
  });

  if (!res.ok) return failure(res, model.name);

  var data;
  try {
    data = res.json();
  } catch (e) {
    return Response.error(model.name + ' returned non-JSON reply', { kind: 'invalidResponse' });
  }

  var content = '';
  if (data && data.choices && data.choices[0] && data.choices[0].message) {
    content = String(data.choices[0].message.content || '');
  } else if (data && data.text) {
    content = String(data.text);
  } else if (data && data.result) {
    content = String(data.result);
  }

  var parsedMap = {};
  var outLines = content.split(/\r?\n/);
  for (var i = 0; i < outLines.length; i++) {
    var m = outLines[i].match(/^\s*\[(\d+)\]\s*(.*)$/);
    if (m) {
      var num = parseInt(m[1], 10) - 1;
      parsedMap[num] = m[2].trim();
    }
  }

  var results = [];
  for (var k = 0; k < lines.length; k++) {
    var text = parsedMap[k] !== undefined ? parsedMap[k] : (outLines[k] || lines[k]);
    results.push({
      text: decodeHtml(String(text).trim()),
    });
  }
  return Response.success(results);
}

function failure(res, name) {
  var detail = '';
  try {
    var data = res.json();
    if (data && (data.errorMessage || data.error)) {
      detail = ': ' + String(data.errorMessage || data.error).slice(0, 300);
    }
  } catch (_) {}

  var message = (name || 'Immersive Translate') + ' HTTP ' + res.status + detail;
  var s = res.status;
  if (s === 401 || s === 403) return Response.error(message, { kind: 'auth' });
  if (s === 429) return Response.error(message, { kind: 'rateLimited' });
  return Response.error(message, { kind: 'server' });
}

function hasWords(line) {
  if (typeof line !== 'string') return false;
  return /\p{L}/u.test(line.replace(/[(\[]?\s*[x×]\s*\d+\s*[)\]]?/gi, ''));
}

function decodeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}

function readSettings() {
  var tokenVal = localConfig.getItem('userToken');
  var tokenStr = '';
  if (Array.isArray(tokenVal) && tokenVal.length > 0) {
    tokenStr = String(tokenVal[0] || '').trim();
  } else if (typeof tokenVal === 'string') {
    tokenStr = tokenVal.trim();
  }

  return {
    userToken: tokenStr,
    model: readText('model', 'babelfast-pro'),
    keepSymbols: readBoolean('keepSymbols', true),
  };
}

function readText(key, fallback) {
  var value = localConfig.getItem(key);
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function readBoolean(key, fallback) {
  var value = localConfig.getItem(key);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return fallback;
}
