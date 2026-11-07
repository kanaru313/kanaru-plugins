load("common.js");

function execute(input) {
    input = input || {};
    var selectedGenre = trimText(input.genre || input.title || input.name || "");
    var next = input.next ? trimText(input.next) : null;
    var offset = next ? (parseInt(next, 10) || 0) : 0;
    var count = 24;

    var cacheKey = "g:" + (selectedGenre ? (selectedGenre + ":" + offset) : "list");
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    if (!selectedGenre) {
        // List all genres
        var genreRes = subsonicGet("getGenres.view");
        if (genreRes.failure) {
            return genreRes.failure;
        }

        var rawGenres = [];
        if (genreRes.data && genreRes.data.genres && Array.isArray(genreRes.data.genres.genre)) {
            rawGenres = genreRes.data.genres.genre;
        }

        var genreItems = [];
        for (var i = 0; i < rawGenres.length; i++) {
            var g = rawGenres[i];
            var gName = trimText(g.value || g.name || "");
            if (gName) {
                var countStr = [];
                if (g.albumCount) countStr.push(g.albumCount + " album");
                if (g.songCount) countStr.push(g.songCount + " bài hát");
                genreItems.push({
                    kind: "genre",
                    id: gName,
                    title: gName,
                    subtitle: countStr.join(" · ") || "Thể loại",
                    genre: gName
                });
            }
        }

        var listResult = {
            genres: genreItems,
            sections: [
                {
                    title: "Thể loại nhạc",
                    layout: "grid",
                    items: genreItems
                }
            ],
            next: null
        };
        cacheSet(cacheKey, listResult, 300000);
        return Response.success(listResult);
    }

    // Detail of a genre: fetch albums by genre
    var albumRes = subsonicGet("getAlbumList2.view", {
        type: "byGenre",
        genre: selectedGenre,
        size: count,
        offset: offset
    });

    if (albumRes.failure) {
        return albumRes.failure;
    }

    var albums = [];
    if (albumRes.data && albumRes.data.albumList2 && Array.isArray(albumRes.data.albumList2.album)) {
        albums = albumRes.data.albumList2.album;
    }

    var items = [];
    for (var j = 0; j < albums.length; j++) {
        var card = parseAlbumCard(albums[j], albumRes.baseUrl, albumRes.auth);
        if (card) items.push(card);
    }

    var nextToken = (albums.length >= count) ? String(offset + count) : null;
    var detailResult = {
        title: selectedGenre,
        sections: [
            {
                title: "Album thể loại: " + selectedGenre,
                layout: "grid",
                items: items
            }
        ],
        items: items,
        next: nextToken
    };

    cacheSet(cacheKey, detailResult, 120000);
    return Response.success(detailResult);
}
