load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    var next = input.next ? trimText(input.next) : null;

    if (!query && !next) {
        return Response.success({ items: [], next: null });
    }

    var cacheKey = "s:" + (next ? ("n:" + next) : ("q:" + query));
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Case 1: Pasted Subsonic link or direct song ID
    var directId = extractSongId(query);
    if (directId && !next && !query.includes(" ")) {
        var songRes = subsonicGet("getSong.view", { id: directId });
        if (songRes.data && songRes.data.song) {
            var card = parseTrackCard(songRes.data.song, songRes.baseUrl, songRes.auth);
            if (card) {
                var directResult = { items: [card], next: null };
                cacheSet(cacheKey, directResult, 120000);
                return Response.success(directResult);
            }
        }
    }

    // Case 2: Library search with search3
    var offset = next ? (parseInt(next, 10) || 0) : 0;
    var count = 20;

    var searchRes = subsonicGet("search3.view", {
        query: query,
        songCount: count,
        songOffset: offset
    });

    if (searchRes.failure) {
        return searchRes.failure;
    }

    var rawSongs = [];
    if (searchRes.data && searchRes.data.searchResult3 && Array.isArray(searchRes.data.searchResult3.song)) {
        rawSongs = searchRes.data.searchResult3.song;
    }

    var items = [];
    var seen = {};

    for (var i = 0; i < rawSongs.length; i++) {
        var c = parseTrackCard(rawSongs[i], searchRes.baseUrl, searchRes.auth);
        if (c && !seen[c.id]) {
            seen[c.id] = true;
            items.push(c);
        }
    }

    var nextToken = (rawSongs.length >= count) ? String(offset + count) : null;
    var result = {
        items: items,
        next: nextToken
    };

    cacheSet(cacheKey, result, 60000);
    return Response.success(result);
}
