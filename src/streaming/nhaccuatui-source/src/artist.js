load("common.js");

function execute(input) {
    input = input || {};
    var id = trimText(input.id || input.artistId || "");
    if (!id) {
        return Response.error("Thiếu mã hoặc tên nghệ sĩ", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "art:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var artistId = id;
    var artistName = id;
    var artworkUrl = "";

    // If ID is numeric, we can query artist song/album endpoints directly
    var isNumeric = /^\d+$/.test(id);
    var songs = [];
    var albums = [];

    if (isNumeric) {
        var songRes = nctGet("/search/artist/song/" + id, { pageindex: 1, pagesize: 20 });
        if (!songRes.failure && Array.isArray(songRes.data)) {
            for (var i = 0; i < songRes.data.length; i++) {
                var sc = parseTrackCard(songRes.data[i]);
                if (sc) songs.push(sc);
            }
        }

        var albRes = nctGet("/search/artist/album/" + id, { pageindex: 1, pagesize: 10 });
        if (!albRes.failure && Array.isArray(albRes.data)) {
            for (var j = 0; j < albRes.data.length; j++) {
                var ac = parsePlaylistCard(albRes.data[j]);
                if (ac) albums.push(ac);
            }
        }

        if (songs.length && songs[0].artist) {
            artistName = songs[0].artist;
            artworkUrl = songs[0].artworkUrl || "";
        }
    } else {
        // Search by keyword/name
        var searchRes = nctGet("/search/all", { keyword: id });
        if (!searchRes.failure && searchRes.data) {
            var rawAr = Array.isArray(searchRes.data.artists) ? searchRes.data.artists : [];
            if (rawAr.length) {
                var first = rawAr[0];
                artistId = String(first.key || id);
                artistName = first.name || id;
                artworkUrl = first.image || first.cover || "";
            }
            var rawS = Array.isArray(searchRes.data.songs) ? searchRes.data.songs : [];
            for (var k = 0; k < rawS.length; k++) {
                var tc = parseTrackCard(rawS[k]);
                if (tc) songs.push(tc);
            }
            var rawPl = Array.isArray(searchRes.data.playlists) ? searchRes.data.playlists : [];
            for (var l = 0; l < rawPl.length; l++) {
                var pc = parsePlaylistCard(rawPl[l]);
                if (pc) albums.push(pc);
            }
        }
    }

    var sections = [];
    if (songs.length > 0) {
        sections.push({
            title: "Bài hát nổi bật",
            layout: "list",
            items: songs
        });
    }
    if (albums.length > 0) {
        sections.push({
            title: "Tuyển tập & Album",
            layout: "shelf",
            items: albums
        });
    }

    var result = {
        info: {
            title: artistName,
            subtitle: "Nghệ sĩ trên NhacCuaTui",
            artworkUrl: artworkUrl,
            description: "",
            webUrl: "https://www.nhaccuatui.com/artist/" + artistId
        },
        sections: sections
    };

    cacheSet(cacheKey, result, 180000);
    return Response.success(result);
}
