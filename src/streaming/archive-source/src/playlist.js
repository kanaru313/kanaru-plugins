load("common.js");

function execute(input) {
    input = input || {};
    var rawId = (typeof input === "string") ? input : (input.id || "");
    var parsed = extractArchiveId(rawId);

    if (!parsed.identifier) {
        return Response.error("Thiếu mã danh sách phát Internet Archive", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "pl:" + parsed.identifier;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var metaUrl = "https://archive.org/metadata/" + encodeURIComponent(parsed.identifier);
    var resWrap = archiveGet(metaUrl);
    if (resWrap.failure) return resWrap.failure;

    var json = null;
    try {
        json = resWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi danh sách phát Internet Archive không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var meta = (json && json.metadata) ? json.metadata : {};
    var title = decodeHtml(meta.title || parsed.identifier);
    var artist = decodeHtml(meta.creator || "Internet Archive");
    var artworkUrl = "https://archive.org/services/img/" + encodeURIComponent(parsed.identifier);
    var files = (json && Array.isArray(json.files)) ? json.files : [];
    var items = [];

    for (var i = 0; i < files.length; i++) {
        var f = files[i];
        if (!isAudioFile(f)) continue;

        var fName = f.name;
        var trackTitle = decodeHtml(f.title || fName.replace(/\.[a-zA-Z0-9]+$/, ""));
        var trackArtist = decodeHtml(f.creator || artist);
        var durSec = parseFloat(f.length || "0") || 0;

        items.push({
            kind: "track",
            id: parsed.identifier + ":" + fName,
            title: trackTitle,
            subtitle: trackArtist,
            artist: trackArtist,
            artists: [{ id: "", title: trackArtist }],
            durationMs: Math.round(durSec * 1000),
            artworkUrl: artworkUrl,
            webUrl: "https://archive.org/details/" + encodeURIComponent(parsed.identifier)
        });
    }

    var result = {
        kind: "playlist",
        id: parsed.identifier,
        title: title,
        artist: artist,
        artworkUrl: artworkUrl,
        items: items
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
