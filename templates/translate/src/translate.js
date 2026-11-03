load('common.js');

/**
 * translate.js — Entry point for lyrics line-by-line translation.
 *
 * =============================================================================
 * ĐẦU VÀO (input):
 * -----------------------------------------------------------------------------
 * App sẽ gọi `execute(input)` với đối tượng:
 * {
 *   lines: [                     // (Bắt buộc, string[]) Danh sách các câu lời bài hát trong chunk
 *     "Hello, how are you?",
 *     "I am singing in the rain",
 *     ""                         // Dòng trống vẫn có thể xuất hiện trong mảng
 *   ],
 *   to: "vi",                    // (Bắt buộc, string) Mã ngôn ngữ đích (ví dụ: vi, en, ja, ko, zh-Hans...)
 *   song: {                      // (Tùy chọn, object hoặc undefined) Ngữ cảnh bài hát
 *     title: "Song Title",
 *     artist: "Artist Name",
 *     lyrics: "Full song lyrics content..."
 *   }
 * }
 * =============================================================================
 *
 * =============================================================================
 * ĐẦU RA (output):
 * -----------------------------------------------------------------------------
 * Trả về `Response.success(results)`:
 * - BẮT BUỘC là mảng có SỐ LƯỢNG PHẦN TỬ BẰNG ĐÚNG `input.lines.length`.
 * - Thứ tự các phần tử phải tương ứng 1-1 với từng câu trong `input.lines`.
 *
 * [
 *   {
 *     text: "Xin chào, bạn khỏe không?", // (Bắt buộc, string) Câu đã dịch.
 *     detected: "en"                     // (Tùy chọn, string) Mã ngôn ngữ gốc phát hiện được.
 *   },
 *   {
 *     text: "Tôi đang hát dưới cơn mưa",
 *     detected: "en"
 *   },
 *   {
 *     text: ""                           // Dòng trống trả về text rỗng.
 *   }
 * ]
 *
 * Quy tắc quan trọng:
 * - Không được gộp dòng, tách dòng, bỏ sót hay đảo lộn thứ tự dòng.
 * - Các dòng trống, nhạc hiệu (♪, ♫), hoặc từ tượng thanh ("la la la", "oh oh") nên trả về nguyên gốc.
 * =============================================================================
 */
function execute(input) {
  var lines = input && input.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    return Response.error('No lines provided to translate');
  }

  var targetLang = String(input.to || '').trim();
  if (!targetLang) {
    return Response.error('Target language is required');
  }

  // 1. Đọc cấu hình plugin (Schema v2 typed)
  var apiKeys = readApiKeys('apiKey');
  if (apiKeys.length === 0) {
    // Với field "required": true, app sẽ chặn không chạy nếu trống.
    // Giữ check phòng thủ ở đây:
    return Response.error('API key is required. Please open plugin settings.', { kind: 'auth' });
  }
  var apiKey = apiKeys[0];

  var model = readText('model', 'model-fast');
  var temperature = readNumber('temperature', 0.3, 0.0, 2.0);
  var maxTokens = Math.round(readNumber('maxOutputTokens', 4096, 256, 8192));
  var useSongContext = readBoolean('useSongContext', true);
  var customInstruction = readText('customInstruction', '').trim();
  var systemPromptTemplate = readText('systemPrompt', '');

  // 2. Tối ưu: Lọc ra các dòng cần gửi API (bỏ qua dòng trống, ký hiệu)
  var results = new Array(lines.length);
  var todo = []; // Danh sách { index, text }

  for (var i = 0; i < lines.length; i++) {
    var rawLine = lines[i];
    var lineStr = rawLine === null || rawLine === undefined ? '' : String(rawLine);
    var trimmed = lineStr.trim();

    // Dòng trống hoặc chỉ có nốt nhạc/ký hiệu đặc biệt -> giữ nguyên không cần dịch
    if (!trimmed || /^([♪♫\s\.,!\?…—–\-~]+)$/.test(trimmed)) {
      results[i] = { text: lineStr };
    } else {
      todo.push({ i: i, t: trimmed });
    }
  }

  // Nếu toàn bộ chunk là dòng trống hoặc nốt nhạc
  if (todo.length === 0) {
    return Response.success(results);
  }

  // 3. Chuẩn bị prompt và body gửi dịch
  var prompt = systemPromptTemplate
    .replace('{target_language}', targetLang)
    .replace('{custom_instruction}', customInstruction ? 'Custom note: ' + customInstruction : '');

  var payload = {
    model: model,
    temperature: temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: JSON.stringify({
          context: useSongContext ? buildSongContext(input.song) : undefined,
          lines: todo
        })
      }
    ]
  };

  // 4. Gửi request
  var res = fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify(payload),
    timeout: 30000
  });

  if (!res.ok) {
    return handleTranslateError(res);
  }

  // 5. Phân tích kết quả trả về từ API
  var data;
  try {
    data = res.json();
  } catch (e) {
    return Response.error('Model reply is not valid JSON', { kind: 'invalidResponse' });
  }

  var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    return Response.error('Empty response from translation model', { kind: 'invalidResponse' });
  }

  var parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return Response.error('Model response text could not be parsed as JSON', { kind: 'invalidResponse' });
  }

  var translatedLines = (parsed && parsed.lines) || [];
  var mapByIndex = {};
  for (var k = 0; k < translatedLines.length; k++) {
    var item = translatedLines[k];
    if (item && typeof item.i === 'number') {
      mapByIndex[item.i] = item;
    }
  }

  // 6. Gán các dòng đã dịch vào đúng vị trí ban đầu
  for (var j = 0; j < todo.length; j++) {
    var originalIndex = todo[j].i;
    var match = mapByIndex[originalIndex];
    if (match && typeof match.t === 'string') {
      results[originalIndex] = {
        text: match.t,
        detected: typeof match.l === 'string' ? match.l : undefined
      };
    } else {
      // Fallback nếu model bỏ sót dòng
      results[originalIndex] = { text: todo[j].t };
    }
  }

  return Response.success(results);
}
