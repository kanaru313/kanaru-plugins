load('common.js');

/**
 * search.js — Entry point for track candidate searching.
 *
 * =============================================================================
 * ĐẦU VÀO (input):
 * -----------------------------------------------------------------------------
 * App sẽ gọi `execute(input)` với 1 trong 2 dạng đối tượng:
 *
 * 1. Khi tự động tìm kiếm theo metadata của bài hát đang phát:
 *    {
 *      title: "Song Name",              // Tên bài hát (string hoặc null)
 *      artist: "Main Artist",           // Tên nghệ sĩ chính (string hoặc null)
 *      artists: ["Artist 1", "Artist 2"],// Danh sách toàn bộ nghệ sĩ (array string hoặc null)
 *      album: "Album Name",             // Tên album (string hoặc null)
 *      durationMs: 215000               // Thời lượng bài hát tính bằng ms (number hoặc null)
 *    }
 *
 * 2. Khi người dùng tự nhập từ khóa tìm kiếm thủ công:
 *    {
 *      text: "từ khóa người dùng gõ"    // Chuỗi truy vấn tự do
 *    }
 * =============================================================================
 *
 * =============================================================================
 * ĐẦU RA (output):
 * -----------------------------------------------------------------------------
 * Trả về `Response.success(items)` với `items` là mảng (tối đa 20 phần tử):
 * [
 *   {
 *     id: "track_12345",       // (Bắt buộc, string 1-256 ký tự) Mã định danh CỐ ĐỊNH (stable)
 *                              // để app lưu cache và chuyển tiếp sang lyrics.js(id).
 *     title: "Song Name",      // (Bắt buộc, string không rỗng) Tên bài hát tìm được.
 *     artist: "Artist Name",   // (Bắt buộc, string không rỗng) Tên nghệ sĩ.
 *     album: "Album Name",     // (Tùy chọn, string) Tên album.
 *     durationMs: 215000,      // (Tùy chọn, number > 0) Thời lượng bài hát để app tính điểm khớp.
 *     lyrics: "[00:01.00]..."  // (Tùy chọn, string) Lời bài hát nếu API search trả về sẵn
 *                              // (giúp app bỏ qua bước gọi lyrics.js).
 *   }
 * ]
 *
 * Nếu không có kết quả: trả về `Response.success([])`.
 * Nếu xảy ra lỗi: trả về `Response.error(message, { kind, retryAfterSec })`.
 * =============================================================================
 */
function execute(input) {
  // 1. Xác định từ khóa tìm kiếm từ input
  var queryText = '';
  if (input && typeof input.text === 'string') {
    queryText = input.text.trim();
  } else if (input && typeof input.title === 'string') {
    queryText = input.title.trim();
    if (input.artist) {
      queryText += ' ' + String(input.artist).trim();
    }
  }

  if (!queryText) {
    return Response.success([]);
  }

  // 2. Đọc cấu hình nếu cần
  var server = readConfigText('serverUrl', BASE_URL);
  var limit = readConfigNumber('resultLimit', 10, 1, 20);
  var apiKey = readConfigText('apiKey', null);

  var headers = {
    'accept': 'application/json',
    'user-agent': 'KanaruPlugin/1.0'
  };
  if (apiKey) {
    headers['authorization'] = 'Bearer ' + apiKey;
  }

  // 3. Gửi request tìm kiếm
  var res = fetch(server + '/search', {
    method: 'GET',
    headers: headers,
    queries: {
      q: queryText,
      limit: String(limit)
    },
    timeout: 10000
  });

  if (!res.ok) {
    return handleHttpError(res);
  }

  // 4. Phân tích kết quả JSON
  var data;
  try {
    data = res.json();
  } catch (e) {
    return Response.error('Search API returned invalid JSON', { kind: 'invalidResponse' });
  }

  var rawList = (data && data.results) || [];
  if (!Array.isArray(rawList)) {
    return Response.success([]);
  }

  // 5. Chuẩn hóa danh sách kết quả theo đúng hợp đồng của Kanaru
  var items = [];
  for (var i = 0; i < rawList.length; i++) {
    var item = rawList[i];
    if (!item || !item.id || !item.name) continue;

    items.push({
      id: String(item.id),
      title: String(item.name).trim(),
      artist: String(item.artist || 'Unknown').trim(),
      album: item.album ? String(item.album).trim() : undefined,
      durationMs: typeof item.duration === 'number' && item.duration > 0 ? Math.round(item.duration * 1000) : undefined
    });

    if (items.length >= 20) break; // Kanaru giới hạn tối đa 20 kết quả
  }

  return Response.success(items);
}
