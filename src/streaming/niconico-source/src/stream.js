load("common.js");

function execute(input) {
    input = input || {};
    var rawId = (typeof input === "string") ? input : (input.id || "");
    var videoId = extractNicoId(rawId);

    if (!videoId) {
        return Response.error("Mã video NicoNico không hợp lệ", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var preferredBitrate = "192kbps";
    if (typeof localConfig !== "undefined" && localConfig) {
        var cfg = localConfig.getItem("audioBitrate");
        if (cfg === "64kbps") preferredBitrate = "64kbps";
    }

    var cacheKey = "stream:" + videoId + ":" + preferredBitrate;
    if (!input.fresh) {
        var cached = cacheGet(cacheKey);
        if (cached) {
            return Response.success(cached);
        }
    }

    var nowMs = Date.now();
    var actionTrackId = "AAAAAAAAAA_" + nowMs;
    var watchUrl = "https://www.nicovideo.jp/api/watch/v3_guest/" + encodeURIComponent(videoId) +
        "?actionTrackId=" + encodeURIComponent(actionTrackId);

    var watchResWrap = nicoGet(watchUrl);
    if (watchResWrap.failure) return watchResWrap.failure;

    var watchJson = null;
    try {
        watchJson = watchResWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi dữ liệu NicoNico không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var watchData = (watchJson && watchJson.data) ? watchJson.data : {};
    var domand = (watchData.media && watchData.media.domand) ? watchData.media.domand : null;

    if (!domand || !domand.accessRightKey) {
        return Response.error("Không thể lấy quyền phát trực tuyến từ NicoNico (Video có thể bị khóa vùng hoặc VIP)", { kind: ERROR_KIND.AUTH });
    }

    var videos = Array.isArray(domand.videos) ? domand.videos : [];
    var audios = Array.isArray(domand.audios) ? domand.audios : [];

    if (videos.length === 0 || audios.length === 0) {
        return Response.error("Không tìm thấy luồng âm thanh hợp lệ cho video này", { kind: ERROR_KIND.UNSUPPORTED });
    }

    // Pick audio track
    var selectedAudio = audios[0];
    for (var i = 0; i < audios.length; i++) {
        if (preferredBitrate === "64kbps" && audios[i].id.indexOf("64kbps") !== -1) {
            selectedAudio = audios[i];
            break;
        }
        if (preferredBitrate === "192kbps" && audios[i].id.indexOf("192kbps") !== -1) {
            selectedAudio = audios[i];
            break;
        }
    }

    var selectedVideo = videos[0];
    var trackId = (watchData.client && watchData.client.watchTrackId) ? watchData.client.watchTrackId : actionTrackId;

    var hlsReqUrl = "https://nvapi.nicovideo.jp/v1/watch/" + encodeURIComponent(videoId) +
        "/access-rights/hls?actionTrackId=" + encodeURIComponent(trackId);

    var postPayload = JSON.stringify({
        outputs: [
            [selectedVideo.id, selectedAudio.id]
        ]
    });

    var hlsResp = fetch(hlsReqUrl, {
        method: "POST",
        headers: {
            "User-Agent": USER_AGENT,
            "Accept": "application/json;charset=utf-8",
            "Content-Type": "application/json",
            "X-Access-Right-Key": domand.accessRightKey,
            "X-Request-With": "https://www.nicovideo.jp",
            "X-Frontend-Id": "6",
            "X-Frontend-Version": "0"
        },
        body: postPayload,
        timeout: 15000
    });

    if (!hlsResp.ok) {
        return Response.error("Máy chủ Domand từ chối cấp luồng HLS (HTTP " + hlsResp.status + ")", { kind: ERROR_KIND.NETWORK });
    }

    var hlsJson = null;
    try {
        hlsJson = hlsResp.json();
    } catch (e2) {
        return Response.error("Phản hồi luồng HLS Domand không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var contentUrl = (hlsJson && hlsJson.data && hlsJson.data.contentUrl) ? hlsJson.data.contentUrl : "";
    if (!contentUrl) {
        return Response.error("Không tìm thấy đường link HLS trong phản hồi của NicoNico", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var expiresAtMs = Date.now() + (24 * 3600 * 1000);
    if (hlsJson.data.expireTime) {
        var parsedTime = Date.parse(hlsJson.data.expireTime);
        if (!isNaN(parsedTime)) {
            expiresAtMs = parsedTime;
        }
    }

    var result = {
        url: contentUrl,
        headers: {
            "User-Agent": USER_AGENT,
            "Origin": "https://www.nicovideo.jp",
            "Referer": "https://www.nicovideo.jp/watch/" + videoId
        },
        mimeType: "application/x-mpegURL",
        bitrate: selectedAudio.bitRate || (preferredBitrate === "64kbps" ? 64000 : 192000),
        expiresAtMs: expiresAtMs
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
