(function () {
  "use strict";

  var TAG = "nuvio";

  var SOURCES = null;
  try {
    SOURCES = require("./index");
  } catch (e) {
    try {
      console.warn(
        "[" + TAG + "] require('./index') failed: " + (e && e.message),
      );
    } catch (_) {}
    SOURCES = {
      aggregateAll: function () {
        return Promise.resolve({
          success: false,
          sources: [],
          totalStreams: 0,
        });
      },
    };
  }

  var TMDB_KEYS = [
    "1865f43a0549ca50d341dd9ab8b29f49",
    "68e094699525b18a70bab2f86b1fa706",
    "af3a53eb387d57fc935e9128468b1899",
  ];
  var TMDB_BASE = "https://api.themoviedb.org/3";
  var IMG = "https://image.tmdb.org/t/p/w92";
  var IMG_BG = "https://image.tmdb.org/t/p/w300";
  var IMG_STILL = "https://image.tmdb.org/t/p/w92";

  var UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  var HEADERS = { "User-Agent": UA, Accept: "application/json" };

  var HOME_TIMEOUT = 15000;
  var LOAD_TIMEOUT = 15000;

  function parseJSON(res) {
    try {
      return JSON.parse(typeof res === "string" ? res : res.body || "");
    } catch (_) {
      try {
        console.warn("[" + TAG + "] JSON parse failed");
      } catch (__) {}
      return null;
    }
  }

  function img(path, base) {
    return path ? (path[0] === "/" ? (base || IMG) + path : path) : "";
  }
  function imgBg(path) {
    return img(path, IMG_BG);
  }
  function imgStill(path) {
    return img(path, IMG_STILL);
  }

  function tmdbFetch(path) {
    function attempt(i) {
      if (i >= TMDB_KEYS.length) return Promise.resolve(null);
      var sep = path.indexOf("?") >= 0 ? "&" : "?";
      var url = TMDB_BASE + path + sep + "api_key=" + TMDB_KEYS[i];
      return http_get(url, HEADERS)
        .then(function (res) {
          if (!res || !res.body || res.body.indexOf("status_code") !== -1)
            return attempt(i + 1);
          return res;
        })
        .catch(function () {
          return attempt(i + 1);
        });
    }
    return attempt(0);
  }

  async function getHome(cb) {
    var d = new Date();
    d.setDate(d.getDate() - 30);
    var since = d.toISOString().split("T")[0];
    var cats = [
      { n: "Trending Now", p: "/trending/all/week" },
      { n: "Trending Movies", p: "/trending/movie/week" },
      { n: "Trending Series", p: "/trending/tv/week" },
      { n: "Top Rated Movies", p: "/movie/top_rated" },
      { n: "Top Rated Series", p: "/tv/top_rated" },
      { n: "Popular Movies", p: "/movie/popular" },
      { n: "Popular TV", p: "/tv/popular" },
      {
        n: "Indian OTT",
        p: "/discover/movie?watch_region=IN&with_watch_monetization_types=flatrate&with_watch_providers=8%7C119%7C2336%7C232%7C237&sort_by=popularity.desc",
      },
      {
        n: "Latest on Indian OTT",
        p:
          "/discover/movie?watch_region=IN&with_watch_monetization_types=flatrate&with_watch_providers=8%7C119%7C2336%7C232%7C237&sort_by=primary_release_date.desc&primary_release_date.gte=" +
          since,
      },
      {
        n: "Indian TV Originals",
        p: "/discover/tv?watch_region=IN&with_watch_monetization_types=flatrate&with_watch_providers=8%7C119%7C2336%7C232%7C237&sort_by=popularity.desc",
      },
      {
        n: "Cartoon Movies",
        p: "/discover/movie?with_genres=16&sort_by=popularity.desc",
      },
      {
        n: "Cartoons",
        p: "/discover/tv?with_genres=16&sort_by=popularity.desc",
      },
      {
        n: "Anime",
        p: "/discover/tv?with_genres=16&with_original_language=ja&sort_by=popularity.desc",
      },
      { n: "Trending", p: "/trending/all/day" },
      { n: "Airing Today", p: "/tv/airing_today?region=US" },
      { n: "Netflix", p: "/discover/tv?with_networks=213" },
      { n: "Amazon", p: "/discover/tv?with_networks=1024" },
      { n: "Disney+", p: "/discover/tv?with_networks=2739" },
      { n: "Hulu", p: "/discover/tv?with_networks=453" },
      { n: "Apple TV+", p: "/discover/tv?with_networks=2552" },
      { n: "HBO", p: "/discover/tv?with_networks=49" },
      { n: "Korean Shows", p: "/discover/tv?with_original_language=ko" },
    ];
    var settled = false;
    var timer = setTimeout(function () {
      if (!settled) {
        settled = true;
        cb({ success: true, data: result, page: 1 });
      }
    }, HOME_TIMEOUT);
    var result = {};
    try {
      for (var i = 0; i < cats.length; i++) {
        try {
          var json = parseJSON(await tmdbFetch(cats[i].p));
          if (!json || !json.results) continue;
          result[cats[i].n] = json.results.slice(0, 20).map(function (m) {
            return new MultimediaItem({
              title: (m.title || m.name || "").trim(),
              url:
                "tmdb:" +
                (m.media_type || (m.title ? "movie" : "tv")) +
                ":" +
                m.id,
              posterUrl: img(m.poster_path),
              type: m.media_type === "movie" ? "movie" : "series",
            });
          });
        } catch (_) {}
      }
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cb({ success: true, data: result, page: 1 });
      }
    } catch (e) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cb({ success: false, error: String(e) });
      }
    }
  }

  async function search(query, cb) {
    try {
      var json = parseJSON(
        await tmdbFetch("/search/multi?query=" + encodeURIComponent(query)),
      );
      var items = ((json && json.results) || [])
        .filter(function (m) {
          return m.media_type === "movie" || m.media_type === "tv";
        })
        .map(function (m) {
          return new MultimediaItem({
            title: (m.title || m.name || "").trim(),
            url: "tmdb:" + m.media_type + ":" + m.id,
            posterUrl: img(m.poster_path),
            type: m.media_type === "movie" ? "movie" : "series",
          });
        });
      cb({ success: true, data: items });
    } catch (e) {
      cb({ success: false, error: String(e) });
    }
  }

  async function load(url, cb) {
    var settled = false;
    var timer = setTimeout(function () {
      if (!settled) {
        settled = true;
        cb({ success: false, error: "Load timeout" });
      }
    }, LOAD_TIMEOUT);

    try {
      var parts = url.split(":");
      var type = parts[1];
      var id = parts[2];
      if (!id) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          cb({ success: false, error: "Invalid URL" });
        }
        return;
      }

      var isSeries = type === "tv";
      var res = parseJSON(
        await tmdbFetch(
          "/" +
            type +
            "/" +
            id +
            "?append_to_response=credits,external_ids,videos,recommendations",
        ),
      );
      if (!res) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          cb({ success: false, error: "No data" });
        }
        return;
      }

      var title = res.title || res.name || "Unknown";
      var poster = img(res.poster_path);
      var banner = imgBg(res.backdrop_path);
      var desc = res.overview || "";
      var score = res.vote_average || undefined;
      var year =
        parseInt(
          (res.release_date || res.first_air_date || "").split("-")[0],
        ) || undefined;
      var genres = (res.genres || []).map(function (g) {
        return g.name;
      });
      var status = (function (s) {
        if (s === "Returning Series") return "ongoing";
        if (s === "In Production" || s === "Planned") return "upcoming";
        if (s === "Ended" || s === "Canceled") return "completed";
        return "completed";
      })(res.status || "");

      var cast = [];
      if (res.credits && res.credits.cast) {
        cast = res.credits.cast.slice(0, 20).map(function (c) {
          return new Actor({
            name: c.name || "Unknown",
            role: c.character || "",
            image: img(c.profile_path),
          });
        });
      }

      var recommendations = [];
      if (res.recommendations && res.recommendations.results) {
        recommendations = res.recommendations.results
          .slice(0, 10)
          .map(function (m) {
            return new MultimediaItem({
              title: (m.title || m.name || "").trim(),
              url: "tmdb:" + (m.title ? "movie" : "tv") + ":" + m.id,
              posterUrl: img(m.poster_path),
              type: m.title ? "movie" : "series",
            });
          });
      }

      if (isSeries) {
        var episodes = [];
        var seasons = res.seasons || [];
        for (var si = 0; si < seasons.length; si++) {
          var s = seasons[si];
          if (!s.season_number || s.season_number === 0) continue;
          try {
            var seasonRes = parseJSON(
              await tmdbFetch("/tv/" + id + "/season/" + s.season_number),
            );
            if (!seasonRes || !seasonRes.episodes) continue;
            seasonRes.episodes.forEach(function (ep) {
              episodes.push(
                new Episode({
                  name: ep.name || "Episode " + ep.episode_number,
                  url: JSON.stringify({
                    tmdbId: id,
                    type: "tv",
                    season: ep.season_number,
                    episode: ep.episode_number,
                  }),
                  season: ep.season_number,
                  episode: ep.episode_number,
                  posterUrl: imgStill(ep.still_path) || poster,
                  description: ep.overview || "",
                  airDate: ep.air_date || "",
                }),
              );
            });
          } catch (_) {}
        }
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          cb({
            success: true,
            data: new MultimediaItem({
              title: title,
              url: url,
              posterUrl: poster,
              bannerUrl: banner,
              type: "series",
              description: desc,
              score: score,
              year: year,
              genres: genres,
              status: status,
              cast: cast,
              recommendations: recommendations,
              episodes: episodes,
            }),
          });
        }
      } else {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          cb({
            success: true,
            data: new MultimediaItem({
              title: title,
              url: url,
              posterUrl: poster,
              bannerUrl: banner,
              type: "movie",
              description: desc,
              score: score,
              year: year,
              genres: genres,
              status: status,
              cast: cast,
              recommendations: recommendations,
              episodes: [
                new Episode({
                  name: title,
                  url: JSON.stringify({ tmdbId: id, type: "movie" }),
                  season: 1,
                  episode: 1,
                  posterUrl: poster,
                }),
              ],
            }),
          });
        }
      }
    } catch (e) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cb({ success: false, error: String(e) });
      }
    }
  }

  function parseStreamUrl(url) {
    var result = { tmdbId: "", type: "movie", season: 0, episode: 0 };
    if (!url) return result;
    try {
      var parsed = JSON.parse(url);
      result.tmdbId = parsed.tmdbId || "";
      result.type = parsed.type || "movie";
      result.season = parseInt(parsed.season) || 0;
      result.episode = parseInt(parsed.episode) || 0;
      return result;
    } catch (_) {}
    var parts = url.split(":");
    if (parts.length >= 3 && parts[0] === "tmdb") {
      result.tmdbId = parts[2] || "";
      result.type = parts[1] || "movie";
    }
    return result;
  }

  function formatName(stream, srcName) {
    if (stream.name && stream.name !== stream.url) return stream.name;
    return srcName || "Stream";
  }

  async function loadStreams(url, cb) {
    try {
      var info = parseStreamUrl(url);
      if (!info.tmdbId) {
        return cb({ success: false, error: "Invalid media identifier" });
      }

      var aggResult = await SOURCES.aggregateAll(
        info.tmdbId,
        info.type,
        info.season,
        info.episode,
      );

      if (
        !aggResult ||
        !aggResult.success ||
        !aggResult.sources ||
        !aggResult.sources.length
      ) {
        return cb({ success: false, error: "No streams found" });
      }

      var allStreams = [];
      for (var si = 0; si < aggResult.sources.length; si++) {
        var src = aggResult.sources[si];
        if (src.status !== "working" || !src.streams || !src.streams.length)
          continue;
        for (var si2 = 0; si2 < src.streams.length; si2++) {
          var s = src.streams[si2];
          var displayName = formatName(s, src.source);
          var sr = new StreamResult({
            url: s.url,
            source: displayName,
            quality: s.quality || "HD",
            headers: s.headers || {},
            subtitles: s.subtitles || undefined,
          });
          sr.name = displayName;
          allStreams.push(sr);
        }
      }

      if (!allStreams.length) {
        return cb({ success: false, error: "No streams found" });
      }

      cb({ success: true, data: allStreams });
    } catch (e) {
      cb({ success: false, error: String(e) });
    }
  }

  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();
