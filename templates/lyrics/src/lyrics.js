load('common.js');

/**
 * lyrics.js — Entry point for fetching lyric content by track ID.
 *
 * =============================================================================
 * ĐẦU VÀO (input):
 * -----------------------------------------------------------------------------
 * App sẽ gọi `execute(id)` với tham số:
 * - `id`: (string) Chuỗi định danh cố định của bài hát từ search.js.
 * =============================================================================
 *
 * =============================================================================
 * ĐẦU RA (output):
 * -----------------------------------------------------------------------------
 * Trả về `Response.success(value)` với 1 trong các dạng sau:
 *
 * 1. Bài hát có lời:
 *    {
 *      data: "[00:12.34]Lời câu 1\n[00:15.67]Lời câu 2...", // (string, ≤ 1 MiB)
 *      type: "lrc" // (Tùy chọn) 'lrc' (đồng bộ) hoặc 'txt' (plain text).
 *                  // Nếu bỏ qua, app tự động kiểm tra cú pháp [mm:ss.xx].
 *    }
 *
 * 2. Bài hát không lời (nhạc hòa tấu / instrumental):
 *    {
 *      instrumental: true
 *    }
 *
 * 3. Không tìm thấy lời cho bài hát này:
 *    null   (hoặc Response.success(null))
 *
 * Nếu xảy ra lỗi mạng / server / auth:
 *    Response.error(message, { kind, retryAfterSec })
 * =============================================================================
 */
function execute(id) {
  if (!id || typeof id !== 'string') {
    return Response.error('Track ID is required');
  }

  // 1. Đọc cấu hình
  var server = readConfigText('serverUrl', BASE_URL);
  var shouldCleanCredits = readConfigBool('stripCredits', true);
  var apiKey = readConfigText('apiKey', null);

  var headers = {
    'accept': 'application/json',
    'user-agent': 'KanaruPlugin/1.0'
  };
  if (apiKey) {
    headers['authorization'] = 'Bearer ' + apiKey;
  }

  // 2. Gửi request lấy lời bài hát
  var res = fetch(server + '/lyrics/' + encodeURIComponent(id), {
    method: 'GET',
    headers: headers,
    timeout: 15000
  });

  // Nếu bài hát không có trên server (404), trả về null = không tìm thấy lời
  if (res.status === 404) {
    return Response.success(null);
  }

  if (!res.ok) {
    return handleHttpError(res);
  }

  // 3. Phân tích kết quả
  var data;
  try {
    data = res.json();
  } catch (e) {
    return Response.error('Lyrics API returned invalid JSON', { kind: 'invalidResponse' });
  }

  // Kiểm tra bài hát không lời
  if (data.isInstrumental || data.pureMusic) {
    return Response.success({ instrumental: true });
  }

  var rawLyrics = data.lyricText || data.lrc || '';
  if (!rawLyrics || typeof rawLyrics !== 'string') {
    return Response.success(null);
  }

  // 4. Tiền xử lý / làm sạch lời nếu được cấu hình
  var finalLyricText = shouldCleanCredits ? stripCredits(rawLyrics) : rawLyrics.trim();
  if (!finalLyricText) {
    return Response.success(null);
  }

  // 5. Xác định định dạng lời (lrc hoặc txt)
  var isSynced = /\[\d{2}:\d{2}\.\d{2,3}\]/.test(finalLyricText);

  return Response.success({
    data: finalLyricText,
    type: isSynced ? 'lrc' : 'txt'
  });
}
