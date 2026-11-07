load("common.js");

function execute(input) {
    input = input || {};
    var url = trimText(input.url || input.query || input.id || "");
    if (!url) {
        return Response.error("Thiếu URL hoặc ID cần resolve", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "res:" + url;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Match subsonic:// URI schemes
    var schemeMatch = url.match(/^subsonic:\/\/(song|track|album|artist|playlist)\/([A-Za-z0-9_\-]+)/i);
    var type = schemeMatch ? schemeMatch[1].toLowerCase() : "";
    var id = schemeMatch ? schemeMatch[2] : "";

    if (!id) {
        id = extractSongId(url);
    }

    if (!id) {
        return Response.error("Không thể nhận diện mã Subsonic từ URL: " + url, { kind: ERROR_KIND.UNAVAILABLE });
    }

    if (type === "album") {
        var albRes = subsonicGet("getAlbum.view", { id: id });
        if (albRes.data && albRes.data.album) {
            var albCard = parseAlbumCard(albRes.data.album, albRes.baseUrl, albRes.auth);
            if (albCard) {
                cacheSet(cacheKey, albCard, 300000);
                return Response.success(albCard);
            }
        }
    } else if (type === "artist") {
        var artRes = subsonicGet("getArtist.view", { id: id });
        if (artRes.data && artRes.data.artist) {
            var artCard = parseArtistCard(artRes.data.artist, artRes.baseUrl, artRes.auth);
            if (artCard) {
                cacheSet(cacheKey, artCard, 300000);
                return Response.success(artCard);
            }
        }
    } else if (type === "playlist") {
        var plRes = subsonicGet("getPlaylist.view", { id: id });
        if (plRes.data && plRes.data.playlist) {
            var plCard = parsePlaylistCard(plRes.data.playlist, plRes.baseUrl, plRes.auth);
            if (plCard) {
                cacheSet(cacheKey, plCard, 300000);
                return Response.success(plCard);
            }
        }
    }

    // Default: try getSong.view first
    var songRes = subsonicGet("getSong.view", { id: id });
    if (songRes.data && songRes.data.song) {
        var trackCard = parseTrackCard(songRes.data.song, songRes.baseUrl, songRes.auth);
        if (trackCard) {
            cacheSet(cacheKey, trackCard, 300000);
            return Response.success(trackCard);
        }
    }

    // If not found as song, try album
    var albFallback = subsonicGet("getAlbum.view", { id: id });
    if (albFallback.data && albFallback.data.album) {
        var aCard = parseAlbumCard(albFallback.data.album, albFallback.baseUrl, albFallback.auth);
        if (aCard) {
            cacheSet(cacheKey, aCard, 300000);
            return Response.success(aCard);
        }
    }

    return Response.error("Không tìm thấy đối tượng Subsonic tương ứng", { kind: ERROR_KIND.UNAVAILABLE });
}
