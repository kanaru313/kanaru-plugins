load("common.js");

function execute(input) {
    input = input || {};
    var isFresh = false;
    var idParam = "";
    if (typeof input === "string") {
        idParam = input;
    } else {
        idParam = input.id || input.bvid || "";
        isFresh = Boolean(input.fresh);
    }

    var bvid = extractBvid(idParam);
    var cacheKey = bvid ? ("st:" + bvid) : "";

    function fail(message, kind) {
        if (isFresh && cacheKey) {
            cacheRemove(cacheKey);
        }
        return Response.error(message, { kind: kind || ERROR_KIND.INVALID_RESPONSE });
    }

    if (!bvid) {
        return fail("Thiếu mã BV hoặc link video Bilibili hợp lệ", ERROR_KIND.UNAVAILABLE);
    }

    // Cache check
    var nowMs = Date.now();
    if (!isFresh) {
        var cached = cacheGet(cacheKey);
        if (cached && cached.expiresAtMs) {
            if (cached.expiresAtMs - nowMs > 60000) {
                return Response.success(cached);
            }
        }
    }

    // 1. Get video details & cid
    var viewUrl = BILI_API_BASE + "/x/web-interface/view?bvid=" + encodeURIComponent(bvid);
    var viewRsp = fetch(viewUrl, {
        headers: {
            "User-Agent": "Kanaru/1.0 (+https://github.com/hieu313/kanaru)"
        }
    });

    if (viewRsp.status === 404) {
        return fail("Video Bilibili không tồn tại hoặc đã bị xoá: " + bvid, ERROR_KIND.UNAVAILABLE);
    }
    if (!viewRsp.ok) {
        return fail("Không lấy được dữ liệu video Bilibili (HTTP " + viewRsp.status + ")", ERROR_KIND.NETWORK);
    }

    var viewJson = safeJsonParse(viewRsp.text());
    if (!viewJson || viewJson.code !== 0 || !viewJson.data) {
        return fail((viewJson && viewJson.message) || "Video Bilibili không khả dụng", ERROR_KIND.UNAVAILABLE);
    }

    var cid = viewJson.data.cid;
    if (!cid && Array.isArray(viewJson.data.pages) && viewJson.data.pages.length) {
        cid = viewJson.data.pages[0].cid;
    }
    if (!cid) {
        return fail("Không tìm thấy nội dung phát (cid) của video này", ERROR_KIND.UNSUPPORTED);
    }

    // 2. Fetch DASH audio stream via playurl (fnval=16 requests DASH)
    var playUrl = BILI_API_BASE + "/x/player/playurl?bvid=" + encodeURIComponent(bvid)
        + "&cid=" + encodeURIComponent(cid)
        + "&fnval=16";

    var playRsp = fetch(playUrl, {
        headers: {
            "User-Agent": "Kanaru/1.0 (+https://github.com/hieu313/kanaru)",
            "Referer": BILI_WEB_BASE + "/"
        }
    });

    if (!playRsp.ok) {
        return fail("Không lấy được luồng phát từ Bilibili (HTTP " + playRsp.status + ")", ERROR_KIND.NETWORK);
    }

    var playJson = safeJsonParse(playRsp.text());
    if (!playJson || playJson.code !== 0 || !playJson.data) {
        return fail((playJson && playJson.message) || "Lỗi lấy luồng phát video Bilibili", ERROR_KIND.INVALID_RESPONSE);
    }

    var dash = playJson.data.dash;
    var audioStreams = (dash && Array.isArray(dash.audio)) ? dash.audio : [];
    if (!audioStreams.length) {
        return fail("Video này không có luồng audio riêng biệt", ERROR_KIND.UNSUPPORTED);
    }

    // Quality preference
    var qualityPref = "";
    try {
        if (typeof localConfig !== "undefined" && localConfig.getItem) {
            qualityPref = String(localConfig.getItem("quality") || "");
        }
    } catch (e) {}
    var preferLow = /tiết kiệm|low/i.test(qualityPref);

    // Sort by bandwidth descending
    audioStreams.sort(function(a, b) {
        return (b.bandwidth || 0) - (a.bandwidth || 0);
    });

    var chosenAudio = preferLow ? audioStreams[audioStreams.length - 1] : audioStreams[0];
    var streamAudioUrl = chosenAudio.baseUrl || (Array.isArray(chosenAudio.backupUrl) && chosenAudio.backupUrl[0]);

    if (!streamAudioUrl) {
        return fail("Không tìm thấy URL âm thanh khả dụng", ERROR_KIND.UNSUPPORTED);
    }

    var bitrate = chosenAudio.bandwidth || 128000;
    var mimeType = chosenAudio.mimeType || "audio/mp4";
    var expiresAtMs = nowMs + 2 * 60 * 60 * 1000; // 2 hours

    var result = {
        url: streamAudioUrl,
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": BILI_WEB_BASE + "/"
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
