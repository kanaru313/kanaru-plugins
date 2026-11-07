load("common.js");

function execute(input) {
    input = input || {};
    var url = trimText(input.url || "");
    if (!url) {
        return Response.error("Thiếu đường dẫn (url)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var bvid = extractBvid(url);
    if (!bvid) {
        return Response.error("Không tìm thấy mã video Bilibili (BV/av) từ đường dẫn", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var viewUrl = BILI_API_BASE + "/x/web-interface/view?bvid=" + encodeURIComponent(bvid);
    var rsp = fetchBili(viewUrl);

    if (rsp.status === 404) {
        return Response.error("Không tìm thấy video trên Bilibili", { kind: ERROR_KIND.UNAVAILABLE });
    }
    if (!rsp.ok) {
        return Response.error("Không thể lấy thông tin video Bilibili (HTTP " + rsp.status + ")", { kind: ERROR_KIND.NETWORK });
    }

    var json = safeJsonParse(rsp.text());
    if (!json || json.code !== 0 || !json.data) {
        return Response.error((json && json.message) || "Video Bilibili không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var card = parseTrackCard(json.data);
    if (!card) {
        return Response.error("Không đọc được dữ liệu video Bilibili", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    return Response.success(card);
}
