load("common.js");

function execute(input) {
    input = input || {};
    var url = trimText(input.url || "");
    if (!url) {
        return Response.error("Thiếu đường dẫn (url)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var resolveUrl = SC_API_BASE + "/resolve?url=" + encodeURIComponent(url);
    var rsp = fetchWithAuth(resolveUrl);

    if (rsp.status === 404) {
        return Response.error("Không tìm thấy nội dung SoundCloud từ đường link này", { kind: ERROR_KIND.UNAVAILABLE });
    }
    if (!rsp.ok) {
        return Response.error("Không thể giải mã liên kết SoundCloud (HTTP " + rsp.status + ")", { kind: ERROR_KIND.NETWORK });
    }

    var json = safeJsonParse(rsp.text());
    if (!json) {
        return Response.error("Phản hồi giải mã link SoundCloud không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var item = null;
    if (json.kind === "track") {
        item = parseTrackCard(json);
    } else if (json.kind === "playlist") {
        item = parsePlaylistCard(json);
    } else if (json.kind === "user") {
        item = parseUserCard(json);
    }

    if (!item) {
        return Response.error("Loại liên kết SoundCloud không được hỗ trợ (" + json.kind + ")", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    return Response.success(item);
}
