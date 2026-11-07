load("common.js");

function getProgressiveCandidates(transcodings) {
    if (!transcodings || !transcodings.length) return [];

    var list = [];
    for (var i = 0; i < transcodings.length; i++) {
        var t = transcodings[i];
        if (!t || !t.url) continue;
        if (t.snipped) continue; // Bỏ qua bản nghe thử 30s của SoundCloud Go+

        var protocol = String((t.format && t.format.protocol) || "").toLowerCase();
        // Bỏ qua mọi luồng HLS vì app stream proxy chỉ hỗ trợ luồng phát liên tục theo Range (MP3 / Progressive)
        if (protocol === "hls" || protocol.indexOf("hls") !== -1) {
            continue;
        }

        if (protocol === "progressive") {
            list.push(t);
        }
    }

    // Sắp xếp ưu tiên: mp3_128k / abr_sq trước, rồi tới các preset khác
    list.sort(function(a, b) {
        var pa = String(a.preset || "").toLowerCase();
        var pb = String(b.preset || "").toLowerCase();
        function score(p) {
            if (p === "mp3_128k" || p === "abr_sq") return 10;
            if (p.indexOf("mp3") !== -1) return 8;
            return 5;
        }
        return score(pb) - score(pa);
    });

    return list;
}

function execute(input) {
    input = input || {};
    var isFresh = false;
    var idParam = "";
    if (typeof input === "string") {
        idParam = input;
    } else {
        idParam = input.id || input.trackId || "";
        isFresh = Boolean(input.fresh);
    }

    var trackId = extractTrackId(idParam);

    // If ID is a soundcloud URL, resolve it to numeric ID
    if (!trackId && isSoundCloudUrl(idParam)) {
        try {
            var resolveRsp = fetchWithAuth(SC_API_BASE + "/resolve?url=" + encodeURIComponent(idParam));
            if (resolveRsp.ok) {
                var resolveJson = safeJsonParse(resolveRsp.text());
                if (resolveJson && resolveJson.id) {
                    trackId = String(resolveJson.id);
                }
            }
        } catch (e) {}
    }

    var cacheKey = trackId ? ("st:" + trackId) : "";

    function fail(message, kind) {
        if (isFresh && cacheKey) {
            cacheRemove(cacheKey);
        }
        return Response.error(message, { kind: kind || ERROR_KIND.INVALID_RESPONSE });
    }

    if (!trackId) {
        return fail("Thiếu ID track SoundCloud hợp lệ", ERROR_KIND.UNAVAILABLE);
    }

    // Cache check (bypassed if fresh: true)
    var nowMs = Date.now();
    if (!isFresh) {
        var cached = cacheGet(cacheKey);
        if (cached && cached.expiresAtMs) {
            if (cached.expiresAtMs - nowMs > 60000) {
                return Response.success(cached);
            }
        }
    }

    // 1. Fetch track metadata
    var trackUrl = SC_API_BASE + "/tracks/" + encodeURIComponent(trackId);
    var trackRsp = fetchWithAuth(trackUrl);

    if (trackRsp.status === 404) {
        return fail("Track SoundCloud không tồn tại hoặc đã bị gỡ bỏ: " + trackId, ERROR_KIND.UNAVAILABLE);
    }
    if (trackRsp.status >= 500) {
        return fail("Máy chủ SoundCloud gặp sự cố tạm thời (HTTP " + trackRsp.status + ")", ERROR_KIND.NETWORK);
    }
    if (!trackRsp.ok) {
        return fail("Không lấy được dữ liệu bài hát từ SoundCloud (HTTP " + trackRsp.status + ")", ERROR_KIND.INVALID_RESPONSE);
    }

    var trackJson = safeJsonParse(trackRsp.text());
    if (!trackJson) {
        return fail("Dữ liệu track SoundCloud không hợp lệ", ERROR_KIND.INVALID_RESPONSE);
    }

    if (trackJson.policy === "BLOCK") {
        return fail("Track bị chặn bản quyền theo vùng hoặc quốc gia", ERROR_KIND.UNAVAILABLE);
    }
    if (trackJson.policy === "SNIP") {
        return fail("Track yêu cầu gói SoundCloud Go+ (chỉ có bản nghe thử 30s)", ERROR_KIND.AUTH);
    }
    if (trackJson.streamable === false) {
        return fail("Track này không cho phép phát trực tuyến", ERROR_KIND.UNSUPPORTED);
    }

    var trackAuth = trackJson.track_authorization || "";
    var transcodings = (trackJson.media && trackJson.media.transcodings) || [];
    if (!transcodings.length) {
        return fail("Không tìm thấy transcoding âm thanh cho track này", ERROR_KIND.UNSUPPORTED);
    }

    var progressiveCandidates = getProgressiveCandidates(transcodings);
    if (!progressiveCandidates.length) {
        // Track chỉ có HLS (nằm ngoài contract của app stream proxy)
        return fail("Bài hát này chỉ có luồng phát HLS (m3u8), ứng dụng hiện chỉ hỗ trợ luồng phát liên tục (MP3 / Progressive)", ERROR_KIND.UNAVAILABLE);
    }

    // 2. Thử lần lượt các progressive transcoding cho đến khi tìm được luồng tải thành công
    var playUrl = "";
    var chosen = null;
    for (var i = 0; i < progressiveCandidates.length; i++) {
        var cand = progressiveCandidates[i];
        var streamRsp = fetchWithAuth(cand.url, {}, trackAuth);
        if (streamRsp && streamRsp.ok) {
            var streamJson = safeJsonParse(streamRsp.text());
            if (streamJson && streamJson.url) {
                playUrl = streamJson.url;
                chosen = cand;
                break;
            }
        }
    }

    if (!playUrl || !chosen) {
        return fail("Không thể lấy luồng âm thanh phát trực tiếp từ SoundCloud", ERROR_KIND.UNAVAILABLE);
    }

    // Parse expiration from URL if present
    var expiresAtMs = nowMs + 2 * 60 * 60 * 1000; // Default: 2 hours
    var expMatch = playUrl.match(/[?&]expires=(\d+)/);
    if (expMatch && expMatch[1]) {
        expiresAtMs = parseInt(expMatch[1], 10) * 1000;
    }

    var mimeType = "audio/mpeg";
    if (chosen.format && chosen.format.mime_type && chosen.format.mime_type.indexOf("mpeg") !== -1) {
        mimeType = chosen.format.mime_type;
    }

    var bitrate = 128000;
    var preset = String(chosen.preset || "").toLowerCase();
    if (preset === "mp3_128k" || preset === "abr_sq") {
        bitrate = 128000;
    } else if (preset === "aac_160k") {
        bitrate = 160000;
    }

    var result = {
        url: playUrl,
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": SC_WEB_BASE + "/"
        },
        mimeType: mimeType,
        bitrate: bitrate,
        expiresAtMs: expiresAtMs
    };

    var ttlMs = Math.min(30 * 60 * 1000, expiresAtMs - nowMs - 60000);
    if (ttlMs > 0) {
        cacheSet(cacheKey, result, ttlMs);
    } else if (isFresh) {
        cacheRemove(cacheKey);
    }

    return Response.success(result);
}
