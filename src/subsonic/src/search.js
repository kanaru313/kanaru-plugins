load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    var next = input.next ? trimText(input.next) : null;
    var filter = input.filter ? trimText(input.filter) : "all";

    if (!query && !next) {
        return Response.success({ filters: [], sections: [], items: [], next: null });
    }

    var cacheKey = "s:" + filter + ":" + (next ? ("n:" + next) : ("q:" + query));
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Direct ID resolve if pasted
    var directId = extractSongId(query);
    if (directId && !next && !query.includes(" ")) {
        var songRes = subsonicGet("getSong.view", { id: directId });
        if (songRes.data && songRes.data.song) {
            var card = parseTrackCard(songRes.data.song, songRes.baseUrl, songRes.auth);
            if (card) {
                var directResult = {
                    filters: [],
                    sections: [{ title: "Kết quả", layout: "list", items: [card] }],
                    items: [card],
                    next: null
                };
                cacheSet(cacheKey, directResult, 120000);
                return Response.success(directResult);
            }
        }
    }

    var offset = next ? (parseInt(next, 10) || 0) : 0;
    var count = 20;

    var params = { query: query };
    if (filter === "song") {
        params.songCount = count;
        params.songOffset = offset;
        params.albumCount = 0;
        params.artistCount = 0;
    } else if (filter === "album") {
        params.songCount = 0;
        params.albumCount = count;
        params.albumOffset = offset;
        params.artistCount = 0;
    } else if (filter === "artist") {
        params.songCount = 0;
        params.albumCount = 0;
        params.artistCount = count;
        params.artistOffset = offset;
    } else {
        params.songCount = count;
        params.songOffset = offset;
        params.albumCount = 10;
        params.artistCount = 10;
    }

    var searchRes = subsonicGet("search3.view", params);
    if (searchRes.failure) {
        return searchRes.failure;
    }

    var res3 = (searchRes.data && searchRes.data.searchResult3) || {};
    var rawSongs = Array.isArray(res3.song) ? res3.song : [];
    var rawAlbums = Array.isArray(res3.album) ? res3.album : [];
    var rawArtists = Array.isArray(res3.artist) ? res3.artist : [];

    var songItems = [];
    var albumItems = [];
    var artistItems = [];

    for (var i = 0; i < rawSongs.length; i++) {
        var s = parseTrackCard(rawSongs[i], searchRes.baseUrl, searchRes.auth);
        if (s) songItems.push(s);
    }
    for (var j = 0; j < rawAlbums.length; j++) {
        var al = parseAlbumCard(rawAlbums[j], searchRes.baseUrl, searchRes.auth);
        if (al) albumItems.push(al);
    }
    for (var k = 0; k < rawArtists.length; k++) {
        var ar = parseArtistCard(rawArtists[k], searchRes.baseUrl, searchRes.auth);
        if (ar) artistItems.push(ar);
    }

    var filters = [
        { title: "Tất cả", input: { query: query, filter: "all" } },
        { title: "Bài hát", input: { query: query, filter: "song" } },
        { title: "Album", input: { query: query, filter: "album" } },
        { title: "Nghệ sĩ", input: { query: query, filter: "artist" } }
    ];

    var sections = [];
    var allItems = [];

    if (filter === "song") {
        if (songItems.length > 0) {
            sections.push({ title: "Bài hát", layout: "list", items: songItems });
            allItems = songItems;
        }
    } else if (filter === "album") {
        if (albumItems.length > 0) {
            sections.push({ title: "Album", layout: "grid", items: albumItems });
            allItems = albumItems;
        }
    } else if (filter === "artist") {
        if (artistItems.length > 0) {
            sections.push({ title: "Nghệ sĩ", layout: "grid", items: artistItems });
            allItems = artistItems;
        }
    } else {
        if (artistItems.length > 0) {
            sections.push({ title: "Nghệ sĩ", layout: "shelf", items: artistItems });
        }
        if (albumItems.length > 0) {
            sections.push({ title: "Album", layout: "shelf", items: albumItems });
        }
        if (songItems.length > 0) {
            sections.push({ title: "Bài hát", layout: "list", items: songItems });
        }
        allItems = songItems.concat(albumItems).concat(artistItems);
    }

    var hasMore = false;
    if (filter === "song" && rawSongs.length >= count) hasMore = true;
    if (filter === "album" && rawAlbums.length >= count) hasMore = true;
    if (filter === "artist" && rawArtists.length >= count) hasMore = true;
    if (filter === "all" && rawSongs.length >= count) hasMore = true;

    var nextToken = hasMore ? String(offset + count) : null;
    var result = {
        filters: filters,
        sections: sections,
        items: songItems.length > 0 ? songItems : allItems,
        next: nextToken
    };

    cacheSet(cacheKey, result, 60000);
    return Response.success(result);
}
