load("common.js");

function execute(input) {
    input = input || {};
    var url = trimText((typeof input === "string") ? input : (input.url || input.id || ""));

    var parsed = extractArchiveId(url);
    if (!parsed.identifier) {
        return Response.error("Đường dẫn Internet Archive không hợp lệ", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "res:" + parsed.identifier + ":" + (parsed.filename || "");
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
        return Response.error("Phản hồi metadata không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var meta = (json && json.metadata) ? json.metadata : {};
    var title = decodeHtml(meta.title || parsed.identifier);
    var artist = decodeHtml(meta.creator || "Internet Archive");
    var artworkUrl = "https://archive.org/services/img/" + encodeURIComponent(parsed.identifier);
    var files = (json && Array.isArray(json.files)) ? json.files : [];

    // If specific filename was targeted
    if (parsed.filename) {
        var foundFile = null;
        for (var i = 0; i < files.length; i++) {
            if (files[i].name === parsed.filename) {
                foundFile = files[i];
                break;
            }
        }
        var trackTitle = foundFile ? decodeHtml(foundFile.title || foundFile.name) : (parsed.filename || title);
        var durSec = foundFile ? (parseFloat(foundFile.length || "0") || 0) : 0;

        var trackItem = {
            kind: "track",
            id: parsed.identifier + ":" + parsed.filename,
            title: trackTitle,
            subtitle: artist,
            artist: artist,
            artists: [{ id: "", title: artist }],
            durationMs: Math.round(durSec * 1000),
            artworkUrl: artworkUrl,
            webUrl: "https://archive.org/details/" + encodeURIComponent(parsed.identifier)
        };
        cacheSet(cacheKey, trackItem, 300000);
        return Response.success(trackItem);
    }

    // Check count of audio files
    var audioFiles = [];
    for (var j = 0; j < files.length; j++) {
        if (isAudioFile(files[j])) {
            audioFiles.push(files[j]);
        }
    }

    var resolvedItem;
    if (audioFiles.length > 1) {
        resolvedItem = {
            kind: "album",
            id: parsed.identifier,
            title: title,
            subtitle: artist + " (" + audioFiles.length + " tracks)",
            artist: artist,
            artists: [{ id: "", title: artist }],
            artworkUrl: artworkUrl,
            webUrl: "https://archive.org/details/" + encodeURIComponent(parsed.identifier)
        };
    } else {
        var firstAudio = audioFiles[0];
        var singleDur = firstAudio ? (parseFloat(firstAudio.length || "0") || 0) : 0;
        resolvedItem = {
            kind: "track",
            id: parsed.identifier + (firstAudio ? (":" + firstAudio.name) : ""),
            title: title,
            subtitle: artist,
            artist: artist,
            artists: [{ id: "", title: artist }],
            durationMs: Math.round(singleDur * 1000),
            artworkUrl: artworkUrl,
            webUrl: "https://archive.org/details/" + encodeURIComponent(parsed.identifier)
        };
    }

    cacheSet(cacheKey, resolvedItem, 300000);
    return Response.success(resolvedItem);
}
