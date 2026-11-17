load("common.js");

function execute(input) {
    input = input || {};
    var rawId = (typeof input === "string") ? input : (input.id || "");
    var parsed = extractJamendoId(rawId);
    var artistId = parsed.id || rawId;

    if (!artistId) {
        return Response.error("Thiếu thông tin nghệ sĩ Jamendo", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "artist:" + artistId;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var items = [];
    var artistName = "Nghệ sĩ Jamendo";
    var artworkUrl = "";

    if (/^\d+$/.test(artistId)) {
        var fetchWrap = jamendoGet("artists/tracks/", {
            id: artistId,
            limit: 30,
            order: "popularity_total",
            audioformat: getAudioQuality()
        });
        if (fetchWrap.failure) return fetchWrap.failure;

        var list = (fetchWrap.json && Array.isArray(fetchWrap.json.results)) ? fetchWrap.json.results : [];
        if (list.length > 0) {
            var artData = list[0];
            artistName = decodeHtml(artData.name || "Nghệ sĩ Jamendo");
            artworkUrl = artData.image || "";
            var rawTracks = Array.isArray(artData.tracks) ? artData.tracks : [];
            for (var i = 0; i < rawTracks.length; i++) {
                var tr = rawTracks[i];
                tr.artist_name = tr.artist_name || artistName;
                var card = parseJamendoTrack(tr);
                if (card) items.push(card);
            }
        }
    } else {
        // Fallback by name search
        artistName = artistId;
        var fetchByName = jamendoGet("tracks/", {
            artist_name: artistId,
            limit: 25,
            order: "popularity_total",
            audioformat: getAudioQuality()
        });
        if (!fetchByName.failure) {
            var nameList = (fetchByName.json && Array.isArray(fetchByName.json.results)) ? fetchByName.json.results : [];
            for (var j = 0; j < nameList.length; j++) {
                var c = parseJamendoTrack(nameList[j]);
                if (c) {
                    if (!artworkUrl && c.artworkUrl) artworkUrl = c.artworkUrl;
                    items.push(c);
                }
            }
        }
    }

    var result = {
        kind: "artist",
        id: artistId,
        title: artistName,
        artworkUrl: artworkUrl,
        items: items
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
