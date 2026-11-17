load("common.js");

function execute(input) {
    input = input || {};
    var rawId = (typeof input === "string") ? input : (input.id || "");
    if (!rawId) {
        return Response.error("Thiếu thông tin bài hát Bandcamp", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var parts = rawId.split("#");
    var pageUrl = normalizeBandcampUrl(parts[0]);
    var targetTrackId = parts[1] || "";

    if (!pageUrl.startsWith("http")) {
        return Response.error("Đường dẫn Bandcamp không hợp lệ", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "stream:" + pageUrl + ":" + targetTrackId;
    if (!input.fresh) {
        var cached = cacheGet(cacheKey);
        if (cached) {
            return Response.success(cached);
        }
    }

    var fetchWrap = bandcampGet(pageUrl);
    if (fetchWrap.failure) return fetchWrap.failure;

    var html = "";
    try {
        html = fetchWrap.res.text();
    } catch (e) {
        return Response.error("Không thể đọc phản hồi HTML từ Bandcamp", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var tralbum = extractTralbumFromHtml(html);
    if (!tralbum) {
        return Response.error("Không tìm thấy dữ liệu phát nhạc (data-tralbum) trên trang Bandcamp này", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var trackList = Array.isArray(tralbum.trackinfo) ? tralbum.trackinfo : [];
    if (trackList.length === 0) {
        return Response.error("Trang Bandcamp không chứa bài hát nào", { kind: ERROR_KIND.UNSUPPORTED });
    }

    var selectedTrack = null;
    if (targetTrackId) {
        for (var i = 0; i < trackList.length; i++) {
            if (String(trackList[i].id) === String(targetTrackId)) {
                selectedTrack = trackList[i];
                break;
            }
        }
    }

    if (!selectedTrack) {
        for (var j = 0; j < trackList.length; j++) {
            if (trackList[j].file && trackList[j].file["mp3-128"]) {
                selectedTrack = trackList[j];
                break;
            }
        }
    }

    if (!selectedTrack || !selectedTrack.file || !selectedTrack.file["mp3-128"]) {
        return Response.error("Bài hát này chưa hỗ trợ phát trực tuyến miễn phí trên Bandcamp (Yêu cầu mua album)", { kind: ERROR_KIND.UNSUPPORTED });
    }

    var streamUrl = selectedTrack.file["mp3-128"];
    var expiresAtMs = null;
    var tsMatch = streamUrl.match(/[?&]ts=(\d+)/) || streamUrl.match(/[?&]token=(\d+)_/);
    if (tsMatch) {
        var sec = parseInt(tsMatch[1], 10);
        if (sec > 0) {
            expiresAtMs = sec * 1000;
        }
    }

    var result = {
        url: streamUrl,
        headers: {
            "User-Agent": USER_AGENT,
            "Referer": pageUrl
        },
        mimeType: "audio/mpeg",
        bitrate: 128000,
        expiresAtMs: expiresAtMs
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
