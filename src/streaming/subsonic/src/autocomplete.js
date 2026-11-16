load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    if (!query) {
        return Response.success([]);
    }

    var cacheKey = "ac:" + query;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var res = subsonicGet("search3.view", {
        query: query,
        songCount: 5,
        albumCount: 5,
        artistCount: 5
    });

    if (res.failure) {
        return Response.success([]);
    }

    var suggestions = [];
    var seen = {};

    function addSug(text) {
        var t = trimText(text);
        if (t && !seen[t.toLowerCase()]) {
            seen[t.toLowerCase()] = true;
            suggestions.push(t);
        }
    }

    var res3 = (res.data && res.data.searchResult3) || {};
    var songs = Array.isArray(res3.song) ? res3.song : [];
    var albums = Array.isArray(res3.album) ? res3.album : [];
    var artists = Array.isArray(res3.artist) ? res3.artist : [];

    for (var i = 0; i < songs.length; i++) {
        if (songs[i].title) addSug(songs[i].title);
    }
    for (var j = 0; j < artists.length; j++) {
        if (artists[j].name) addSug(artists[j].name);
    }
    for (var k = 0; k < albums.length; k++) {
        if (albums[k].name || albums[k].title) addSug(albums[k].name || albums[k].title);
    }

    cacheSet(cacheKey, suggestions, 60000);
    return Response.success(suggestions);
}
