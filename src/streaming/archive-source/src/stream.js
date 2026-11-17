load("common.js");

function execute(input) {
    input = input || {};
    var rawId = (typeof input === "string") ? input : (input.id || "");
    var parsed = extractArchiveId(rawId);

    if (!parsed.identifier) {
        return Response.error("Thiếu mã định danh Internet Archive", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var preferredFormat = null;
    if (typeof localConfig !== "undefined" && localConfig) {
        preferredFormat = localConfig.getItem("audioFormat");
    }

    // Direct filename already provided in ID
    if (parsed.filename) {
        var directUrl = buildStreamUrl(parsed.identifier, parsed.filename);
        var mime = "audio/mpeg";
        var lower = parsed.filename.toLowerCase();
        if (lower.endsWith(".flac")) mime = "audio/flac";
        else if (lower.endsWith(".ogg")) mime = "audio/ogg";
        else if (lower.endsWith(".m4a")) mime = "audio/mp4";

        return Response.success({
            url: directUrl,
            headers: { "User-Agent": USER_AGENT },
            mimeType: mime,
            bitrate: lower.endsWith(".flac") ? 1411000 : 192000,
            expiresAtMs: null
        });
    }

    // Check cache
    var cacheKey = "stream:" + parsed.identifier + ":" + (preferredFormat || "def");
    if (!input.fresh) {
        var cached = cacheGet(cacheKey);
        if (cached) {
            return Response.success(cached);
        }
    }

    // Fetch metadata
    var metaUrl = "https://archive.org/metadata/" + encodeURIComponent(parsed.identifier) + "/files";
    var resWrap = archiveGet(metaUrl);
    if (resWrap.failure) return resWrap.failure;

    var json = null;
    try {
        json = resWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi metadata Internet Archive không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var files = (json && Array.isArray(json.result)) ? json.result : ((json && Array.isArray(json.files)) ? json.files : []);
    var bestFile = findBestAudioFile(files, preferredFormat);

    if (!bestFile || !bestFile.name) {
        return Response.error("Không tìm thấy tệp âm thanh hợp lệ trong bản ghi này", { kind: ERROR_KIND.UNSUPPORTED });
    }

    var streamUrl = buildStreamUrl(parsed.identifier, bestFile.name);
    var mimeType = "audio/mpeg";
    var fileNameLower = bestFile.name.toLowerCase();
    var bitrate = 192000;

    if (fileNameLower.endsWith(".flac") || String(bestFile.format || "").toUpperCase().indexOf("FLAC") !== -1) {
        mimeType = "audio/flac";
        bitrate = 1411000;
    } else if (fileNameLower.endsWith(".ogg")) {
        mimeType = "audio/ogg";
        bitrate = 192000;
    } else if (fileNameLower.endsWith(".m4a")) {
        mimeType = "audio/mp4";
        bitrate = 256000;
    }

    if (bestFile.bitrate) {
        var parsedBr = parseInt(bestFile.bitrate, 10);
        if (parsedBr > 0) {
            bitrate = parsedBr > 1000 ? parsedBr : parsedBr * 1000;
        }
    }

    var result = {
        url: streamUrl,
        headers: { "User-Agent": USER_AGENT },
        mimeType: mimeType,
        bitrate: bitrate,
        expiresAtMs: null
    };

    cacheSet(cacheKey, result, 600000);
    return Response.success(result);
}
