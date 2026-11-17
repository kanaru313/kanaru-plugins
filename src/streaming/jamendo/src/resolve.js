load("common.js");

function execute(input) {
    input = input || {};
    var url = trimText((typeof input === "string") ? input : (input.url || input.id || ""));

    var parsed = extractJamendoId(url);
    if (!parsed.id) {
        return Response.error("Đường dẫn Jamendo Music không hợp lệ", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "res:" + parsed.type + ":" + parsed.id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // 1. Track
    if (parsed.type === "track" || !parsed.type) {
        var fetchTrack = jamendoGet("tracks/", { id: parsed.id });
        if (fetchTrack.failure) return fetchTrack.failure;

        var tList = (fetchTrack.json && Array.isArray(fetchTrack.json.results)) ? fetchTrack.json.results : [];
        if (tList.length === 0) {
            return Response.error("Không tìm thấy bài hát Jamendo", { kind: ERROR_KIND.UNAVAILABLE });
        }

        var trackCard = parseJamendoTrack(tList[0]);
        cacheSet(cacheKey, trackCard, 300000);
        return Response.success(trackCard);
    }

    // 2. Album
    if (parsed.type === "album") {
        var fetchAlbum = jamendoGet("albums/", { id: parsed.id });
        if (fetchAlbum.failure) return fetchAlbum.failure;

        var albList = (fetchAlbum.json && Array.isArray(fetchAlbum.json.results)) ? fetchAlbum.json.results : [];
        if (albList.length === 0) {
            return Response.error("Không tìm thấy album Jamendo", { kind: ERROR_KIND.UNAVAILABLE });
        }

        var alb = albList[0];
        var albCard = {
            kind: "album",
            id: String(alb.id),
            title: decodeHtml(alb.name || ""),
            artist: decodeHtml(alb.artist_name || ""),
            artworkUrl: alb.image || "",
            webUrl: alb.shareurl || ("https://www.jamendo.com/album/" + alb.id)
        };
        cacheSet(cacheKey, albCard, 300000);
        return Response.success(albCard);
    }

    // 3. Artist
    if (parsed.type === "artist") {
        var fetchArtist = jamendoGet("artists/", { id: parsed.id });
        if (fetchArtist.failure) return fetchArtist.failure;

        var artList = (fetchArtist.json && Array.isArray(fetchArtist.json.results)) ? fetchArtist.json.results : [];
        if (artList.length === 0) {
            return Response.error("Không tìm thấy nghệ sĩ Jamendo", { kind: ERROR_KIND.UNAVAILABLE });
        }

        var art = artList[0];
        var artCard = {
            kind: "artist",
            id: String(art.id),
            title: decodeHtml(art.name || ""),
            artworkUrl: art.image || "",
            webUrl: art.shareurl || ("https://www.jamendo.com/artist/" + art.id)
        };
        cacheSet(cacheKey, artCard, 300000);
        return Response.success(artCard);
    }

    // 4. Playlist
    if (parsed.type === "playlist") {
        var fetchPl = jamendoGet("playlists/", { id: parsed.id });
        if (fetchPl.failure) return fetchPl.failure;

        var plList = (fetchPl.json && Array.isArray(fetchPl.json.results)) ? fetchPl.json.results : [];
        if (plList.length === 0) {
            return Response.error("Không tìm thấy danh sách phát Jamendo", { kind: ERROR_KIND.UNAVAILABLE });
        }

        var pl = plList[0];
        var plCard = {
            kind: "playlist",
            id: String(pl.id),
            title: decodeHtml(pl.name || ""),
            artist: decodeHtml(pl.user_name || ""),
            artworkUrl: "",
            webUrl: pl.shareurl || ("https://www.jamendo.com/playlist/" + pl.id)
        };
        cacheSet(cacheKey, plCard, 300000);
        return Response.success(plCard);
    }

    return Response.error("Loại tài nguyên Jamendo không được hỗ trợ", { kind: ERROR_KIND.UNSUPPORTED });
}
