(function () {
  "use strict";
  var UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  var CFG = {
    MANIFEST_TIMEOUT_MS: 15000,
    CATALOG_TIMEOUT_MS: 15000,
    META_TIMEOUT_MS: 20000,
    STREAM_TIMEOUT_MS: 12000,
    SUB_TIMEOUT_MS: 8000,
    SEARCH_TIMEOUT_MS: 10000,
    HARD_CEILING_MS: 60000,
    GUARD_BUDGET_MS: 75000,
    STREAM_CACHE_TTL: 600000,
    MANIFEST_CACHE_TTL: 1800000,
    CATALOG_CACHE_TTL: 180000,
    SUB_CACHE_TTL: 600000,
    MAX_STREAMS: 180,
    MAX_SEARCH: 60,
    MAX_CATALOGS_PER_ADDON: 30,
    MAX_ITEMS_PER_CATALOG: 40,
    MAX_SUBS: 12,
    CACHE_MAX_ENTRIES: 400,
    CLIENT_FILTER_LIMIT: 40,
    POOL_MANIFESTS: 16,
    POOL_CATALOGS: 24,
    POOL_SEARCH: 24,
    POOL_META: 12,
    MAX_HOME_JOBS: 140,
    MAX_SEARCH_TASKS: 150,
    MANIFEST_PHASE_MS: 8000,
    HOME_PHASE_MS: 12000,
    NEG_TTL_MS: 30000,
    RETRY_BACKOFF_MS: 250,
  };
  var JSON_HEADERS = {
    "User-Agent": UA,
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.5",
  };
  var FALLBACK_TRACKERS = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.moeking.me:6969/announce",
    "http://tracker.openbittorrent.com:80/announce",
  ];
  function safeStr(s) {
    return s == null ? "" : String(s);
  }
  function safeInt(v, d) {
    var n = parseInt(v, 10);
    return isNaN(n) ? d || 0 : n;
  }
  function safeFloat(v) {
    var n = parseFloat(v);
    return isNaN(n) ? undefined : n;
  }
  function safeJson(t, f) {
    try {
      return JSON.parse(safeStr(t));
    } catch (e) {
      return f !== undefined ? f : null;
    }
  }
  function isHttpStr(s) {
    s = safeStr(s);
    return s.indexOf("http://") === 0 || s.indexOf("https://") === 0;
  }
  function stripHtml(s) {
    return safeStr(s)
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function clean(o) {
    var r = {};
    for (var k in o)
      if (Object.prototype.hasOwnProperty.call(o, k)) {
        var v = o[k];
        if (v !== null && v !== undefined) r[k] = v;
      }
    return r;
  }
  function settle(p) {
    return Promise.all(
      p.map(function (x) {
        return Promise.resolve(x).then(
          function (v) {
            return { ok: true, value: v };
          },
          function () {
            return { ok: false, value: null };
          },
        );
      }),
    );
  }
  function delay(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }
  function pool(items, concurrency, fn) {
    var list = Array.isArray(items) ? items : [];
    var n = Math.max(1, concurrency | 0);
    var out = new Array(list.length);
    if (!list.length) return Promise.resolve(out);
    var idx = 0;
    function worker() {
      return (async function () {
        while (true) {
          var i = idx;
          if (i >= list.length) return;
          idx = i + 1;
          var v = null,
            ok = true;
          try {
            v = await fn(list[i], i);
          } catch (e) {
            ok = false;
          }
          out[i] = { ok: ok, value: ok ? v : null };
        }
      })();
    }
    var ws = [];
    for (var w = 0; w < Math.min(n, list.length); w++) ws.push(worker());
    return Promise.all(ws).then(function () {
      return out;
    });
  }
  function roundRobin(tasks, keyFn) {
    var byKey = {};
    var keys = [];
    tasks.forEach(function (t) {
      var k = keyFn(t);
      if (!byKey[k]) {
        byKey[k] = [];
        keys.push(k);
      }
      byKey[k].push(t);
    });
    var out = [];
    var maxLen = 0;
    keys.forEach(function (k) {
      if (byKey[k].length > maxLen) maxLen = byKey[k].length;
    });
    for (var i = 0; i < maxLen; i++)
      for (var ki = 0; ki < keys.length; ki++) {
        var arr = byKey[keys[ki]];
        if (arr[i]) out.push(arr[i]);
      }
    return out;
  }
  function withDeadline(p, ms, fb) {
    var t;
    var d = new Promise(function (r) {
      t = setTimeout(function () {
        r(fb());
      }, ms);
    });
    return Promise.race([
      Promise.resolve(p).then(
        function (v) {
          clearTimeout(t);
          return v;
        },
        function () {
          clearTimeout(t);
          return fb();
        },
      ),
      d,
    ]);
  }
  var _cache = new Map();
  function cacheGet(k) {
    var e = _cache.get(k);
    if (!e) return null;
    if (Date.now() > e.expires) {
      _cache.delete(k);
      return null;
    }
    return e.data;
  }
  function cacheSet(k, d, t) {
    if (_cache.size >= CFG.CACHE_MAX_ENTRIES) {
      var o = _cache.keys().next().value;
      if (o !== undefined) _cache.delete(o);
    }
    _cache.set(k, { data: d, expires: Date.now() + t });
  }
  function readPrefRaw(k) {
    if (typeof _dartAsyncCall === "function") {
      try {
        return _dartAsyncCall("get_preference", {
          packageName: manifest.packageName,
          key: k,
        });
      } catch (e) {}
    }
    if (typeof getPreference === "function") {
      try {
        return Promise.resolve(getPreference(k));
      } catch (e) {}
    }
    return Promise.resolve(null);
  }
  async function getSettingsData() {
    var keys = [
      "fire_window",
      "external_subs",
      "english_subs",
      "force_exoplayer",
    ];
    var vals = await settle(keys.map(readPrefRaw));
    function val(k, d) {
      var i = keys.indexOf(k);
      var v = i >= 0 && vals[i] && vals[i].ok ? vals[i].value : null;
      return v === null || v === undefined || v === "" ? d : safeStr(v);
    }
    var fw = val("fire_window", "0");
    var fireWindowMs = fw === "0" ? 0 : safeInt(fw, 45000);
    if (fireWindowMs !== 0) {
      if (fireWindowMs < 5000) fireWindowMs = 5000;
      if (fireWindowMs > 60000) fireWindowMs = 60000;
    }
    var extRaw = val("external_subs", "");
    if (extRaw === "") extRaw = val("english_subs", "true");
    var data = {
      fireWindowMs: fireWindowMs,
      englishSubs: safeStr(extRaw).toLowerCase() !== "false",
      forceExo:
        safeStr(val("force_exoplayer", "false")).toLowerCase() === "true",
    };
    return data;
  }
  function getSettings() {
    try {
      if (
        typeof manifest !== "undefined" &&
        manifest &&
        Array.isArray(manifest.settings) &&
        manifest.settings.length
      )
        return manifest.settings;
    } catch (e) {}
    return [
      {
        key: "fire_window",
        title: "Fire Window",
        description: "Off = instant, 30s/45s/60s = fire exactly at that time",
        type: "select",
        defaultValue: "45000",
        reloadOnChange: true,
        options: [
          { label: "Off (instant)", value: "0" },
          { label: "30 seconds", value: "30000" },
          { label: "45 seconds", value: "45000" },
          { label: "60 seconds", value: "60000" },
        ],
      },
      {
        key: "external_subs",
        title: "Enable External Subs",
        description: "Fetch all external subtitles (all languages)",
        type: "toggle",
        defaultValue: "true",
        reloadOnChange: true,
      },
      {
        key: "force_exoplayer",
        title: "Only Use ExoPlayer",
        description:
          "Force ExoPlayer for playback (marks content as live). Fixes mpv crashes and dropped links on TV.",
        type: "toggle",
        defaultValue: "false",
        reloadOnChange: true,
      },
    ];
  }
  var _inflight = new Map();
  function httpJson(url, timeoutMs) {
    var key = safeStr(url);
    var ex = _inflight.get(key);
    if (ex) return ex;
    var p = _httpJsonOnce(url, timeoutMs);
    _inflight.set(key, p);
    var fin = function () {
      setTimeout(function () {
        if (_inflight.get(key) === p) _inflight.delete(key);
      }, 0);
    };
    p.then(fin, fin);
    return p;
  }
  async function _httpJsonOnce(url, timeoutMs) {
    var done = false;
    var resp = await new Promise(function (resolve) {
      var t = setTimeout(function () {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, timeoutMs);
      http_get(url, JSON_HEADERS).then(
        function (r) {
          if (!done) {
            done = true;
            clearTimeout(t);
            resolve(r);
          }
        },
        function () {
          if (!done) {
            done = true;
            clearTimeout(t);
            resolve(null);
          }
        },
      );
    });
    if (!resp || !resp.body) return null;
    var s = safeInt(resp.status || resp.statusCode || resp.code, 0);
    if (s !== 200 && s !== 206 && s !== 304) return null;
    var b = typeof resp.body === "string" ? resp.body.trim() : "";
    if (!b || b.charAt(0) === "<") return null;
    return safeJson(b, null);
  }
  function fetchJson(url, timeoutMs, retries, fullWindow) {
    return (async function () {
      var hasRetry = (retries || 0) > 0;
      var t =
        hasRetry && !fullWindow
          ? Math.max(2000, Math.round(timeoutMs * 0.6))
          : timeoutMs;
      var d = await httpJson(url, t);
      if (d) return d;
      if (hasRetry) {
        await delay(CFG.RETRY_BACKOFF_MS + Math.floor(Math.random() * 150));
        d = await httpJson(url, t);
        if (d) return d;
      }
      return null;
    })();
  }
  function collectAddonUrls() {
    var out = [],
      seen = {};
    function add(u) {
      u = safeStr(u).trim();
      if (u && isHttpStr(u) && !seen[u]) {
        seen[u] = 1;
        out.push(u);
      }
    }
    var m = typeof manifest !== "undefined" ? manifest || {} : {};
    if (Array.isArray(m.addons)) m.addons.forEach(add);
    [
      "catalogueAddons",
      "streamingAddons",
      "subtitleAddons",
      "liveAddons",
      "metaAddons",
    ].forEach(function (k) {
      if (Array.isArray(m[k])) m[k].forEach(add);
      else if (typeof m[k] === "string" && m[k]) add(m[k]);
    });
    return out;
  }
  function collectMetadataUrls() {
    var out = [],
      seen = {};
    function add(u) {
      u = safeStr(u).trim();
      if (u && isHttpStr(u) && !seen[u]) {
        seen[u] = 1;
        out.push(u);
      }
    }
    var m = typeof manifest !== "undefined" ? manifest || {} : {};
    if (Array.isArray(m.metadataAddons)) m.metadataAddons.forEach(add);
    if (!out.length) out.push("https://v3-cinemeta.strem.io/manifest.json");
    return out;
  }
  function baseOf(u) {
    return safeStr(u)
      .replace(/\?.*$/, "")
      .replace(/\/manifest\.json.*$/, "")
      .replace(/\/$/, "");
  }
  function queryFromManifest(u) {
    var i = u.indexOf("?");
    return i !== -1 ? u.substring(i) : "";
  }
  function appendQuery(url, q) {
    if (!q) return url;
    var c = q.replace(/^\?/, "");
    return url.indexOf("?") !== -1 ? url + "&" + c : url + "?" + c;
  }
  function hasResource(mf, n) {
    var rs = mf.resources;
    if (!Array.isArray(rs)) return false;
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      if (typeof r === "string") {
        if (r === n) return true;
      } else if (r && typeof r === "object") {
        var x = safeStr(r.name || r.id);
        if (x === n) return true;
        if (n === "subtitles" && (x === "subtitle" || x === "subs"))
          return true;
      }
    }
    return false;
  }
  function resourceObj(mf, n) {
    var rs = mf.resources;
    if (!Array.isArray(rs)) return null;
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      if (r && typeof r === "object" && safeStr(r.name || r.id) === n) return r;
    }
    return null;
  }
  function hostName(url) {
    try {
      var h = safeStr(url)
        .replace(/^https?:\/\//, "")
        .split("/")[0]
        .replace(/^www\./, "");
      var p = h.split(".");
      var n = p[0] || "";
      if (/^[a-f0-9]{8,}$/i.test(n) && p.length >= 2) n = p[p.length - 2];
      n = n
        .replace(/^[a-f0-9]{6,}-/i, "")
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, function (c) {
          return c.toUpperCase();
        });
      return n.trim() || "Addon";
    } catch (e) {
      return "Addon";
    }
  }
  function normalizeAddon(url, mf) {
    if (!mf || typeof mf !== "object") return null;
    var base = baseOf(url);
    var catalogs = (Array.isArray(mf.catalogs) ? mf.catalogs : [])
      .filter(function (c) {
        return c && c.id && c.type;
      })
      .slice(0, CFG.MAX_CATALOGS_PER_ADDON);
    var sr = resourceObj(mf, "stream");
    var idPrefixes = Array.isArray(sr && sr.idPrefixes)
      ? sr.idPrefixes.map(safeStr)
      : Array.isArray(mf.idPrefixes)
        ? mf.idPrefixes.map(safeStr)
        : [];
    var types = (Array.isArray(mf.types) ? mf.types : []).map(function (t) {
      return safeStr(t).toLowerCase();
    });
    var liveTypes = { tv: 1, channel: 1, livestream: 1, live: 1, iptv: 1 };
    var isLive =
      types.some(function (t) {
        return !!liveTypes[t];
      }) ||
      catalogs.some(function (c) {
        return !!liveTypes[safeStr(c.type).toLowerCase()];
      });
    return {
      url: url,
      base: base,
      queryStr: queryFromManifest(url),
      name: safeStr(mf.name).trim() || hostName(url),
      id: safeStr(mf.id),
      types: types,
      idPrefixes: idPrefixes,
      catalogs: catalogs,
      hasCatalog: hasResource(mf, "catalog") || catalogs.length > 0,
      hasStream: hasResource(mf, "stream"),
      hasMeta: hasResource(mf, "meta"),
      hasSubs: hasResource(mf, "subtitles"),
      isLive: isLive,
    };
  }
  function getAddons() {
    return (async function () {
      var urls = collectAddonUrls();
      function build() {
        var addons = [];
        urls.forEach(function (u) {
          var mf = cacheGet("mf:" + u);
          if (!mf) return;
          var a = normalizeAddon(u, mf);
          if (a) addons.push(a);
        });
        return addons;
      }
      var need = urls.filter(function (u) {
        return !cacheGet("mf:" + u) && !cacheGet("mfneg:" + u);
      });
      // Phase-bounded: hanging hosts can't stall the UI; their pool keeps
      // running in the background and fills the cache for the next screen.
      await withDeadline(
        pool(need, CFG.POOL_MANIFESTS, function (u) {
          return fetchJson(u, CFG.MANIFEST_TIMEOUT_MS, 1).then(function (mf) {
            if (mf) cacheSet("mf:" + u, mf, CFG.MANIFEST_CACHE_TTL);
            else cacheSet("mfneg:" + u, 1, CFG.NEG_TTL_MS);
          });
        }),
        CFG.MANIFEST_PHASE_MS,
        function () {
          return null;
        },
      );
      var addons = build();
      if (!addons.length && urls.length) {
        await delay(500);
        var retry = urls.filter(function (u) {
          return !cacheGet("mf:" + u);
        });
        await withDeadline(
          pool(retry, CFG.POOL_MANIFESTS, function (u) {
            return fetchJson(u, CFG.MANIFEST_TIMEOUT_MS, 1).then(function (mf) {
              if (mf) cacheSet("mf:" + u, mf, CFG.MANIFEST_CACHE_TTL);
            });
          }),
          CFG.MANIFEST_PHASE_MS,
          function () {
            return null;
          },
        );
        addons = build();
      }
      return addons;
    })();
  }
  var REF_TAG = "sx1";
  var EXO_MARKER = "/live/";
  function makeRef(base, type, id, engine) {
    var b = safeStr(base).split("|").join("%7C");
    var r = REF_TAG + "|" + b + "|" + safeStr(type) + "|" + safeStr(id);
    if (engine === "exoplayer") r += EXO_MARKER;
    return r;
  }
  function parseRef(url) {
    var raw = safeStr(url).trim();
    var exo = false;
    if (raw.lastIndexOf(EXO_MARKER) === raw.length - EXO_MARKER.length) {
      exo = true;
      raw = raw.substring(0, raw.length - EXO_MARKER.length);
    }
    var p = raw.split("|");
    if (p.length < 4 || p[0] !== REF_TAG) return null;
    return {
      base: p[1].split("%7C").join("|"),
      type: p[2],
      id: p.slice(3).join("|"),
      exo: exo,
    };
  }
  var LIVE_TYPES = { tv: 1, channel: 1, livestream: 1, live: 1, iptv: 1 };
  function skyType(t, v) {
    t = safeStr(t).toLowerCase();
    if (LIVE_TYPES[t]) return "livestream";
    if (t.indexOf("movie") !== -1 || t === "short") return "movie";
    if (t.indexOf("anime") !== -1) return "anime";
    if (t === "series" || t === "tvseries" || t === "tvshow") return "series";
    return v ? "series" : "movie";
  }
  function fixPoster(p) {
    p = safeStr(p);
    if (!p) return "";
    if (p.indexOf("//") === 0) return "https:" + p;
    if (p.charAt(0) === "/" && p.indexOf("//") !== 0)
      return "https://image.tmdb.org/t/p/w500" + p;
    if (isHttpStr(p)) return p;
    if (p.indexOf("images.justwatch") !== -1 || p.indexOf("mydramalist") !== -1)
      return p.indexOf("http") === 0 ? p : "https:" + p;
    return isHttpStr(p) ? p : "";
  }
  function metaYear(m) {
    var y = safeInt(m.year, 0);
    if (!y && m.releaseInfo)
      y = safeInt(safeStr(m.releaseInfo).split("-")[0], 0);
    return y > 1900 && y < 2100 ? y : undefined;
  }
  function metaScore(m) {
    var r = safeFloat(m.imdbRating);
    if (r === undefined && m.rating != null) r = safeFloat(m.rating);
    if (r === undefined && m.popularity != null) r = safeFloat(m.popularity);
    return r !== undefined && r >= 0 && r <= 10 ? r : undefined;
  }
  function metaGenres(m) {
    var g = m.genres || m.genre || m.tags;
    if (!Array.isArray(g) || !g.length) return undefined;
    return g.map(function (x) {
      return typeof x === "object" && x ? safeStr(x.name) : safeStr(x);
    });
  }
  function toItem(meta, addon, catType, engine) {
    try {
      if (!meta || !meta.id) return null;
      var type = skyType(
        meta.type || catType,
        Array.isArray(meta.videos) && meta.videos.length > 0,
      );
      if (addon.isLive || engine === "exoplayer") type = "livestream";
      var poster = fixPoster(
        meta.poster || meta.posterUrl || meta.poster_path || meta.thumbnail,
      );
      return clean({
        title: safeStr(
          meta.name || meta.title || meta.originalName || "Unknown",
        ),
        url: makeRef(
          addon.base + addon.queryStr,
          type,
          safeStr(meta.id),
          engine,
        ),
        posterUrl: poster,
        bannerUrl: fixPoster(meta.background || meta.backdrop || meta.banner),
        logoUrl: fixPoster(meta.logo),
        type: type,
        description: stripHtml(
          meta.description || meta.overview || "",
        ).substring(0, 500),
        year: metaYear(meta),
        score: metaScore(meta),
        tags: metaGenres(meta),
        isAdult: meta.isAdult === true ? true : undefined,
      });
    } catch (e) {
      return null;
    }
  }
  function extractCast(meta) {
    var list =
      Array.isArray(meta.cast) && meta.cast.length
        ? meta.cast
        : meta.credits_cast;
    if (!Array.isArray(list)) return undefined;
    var out = [];
    for (var i = 0; i < Math.min(list.length, 20); i++) {
      var c = list[i];
      if (!c) continue;
      var nm = safeStr(c.name || c.actor);
      if (!nm) continue;
      out.push({ name: nm, role: safeStr(c.role || c.character) || undefined });
    }
    return out.length ? out : undefined;
  }
  function extractTrailers(meta) {
    if (!Array.isArray(meta.trailers) || !meta.trailers.length)
      return undefined;
    var out = [];
    for (var i = 0; i < meta.trailers.length; i++) {
      var tr = meta.trailers[i];
      var s = safeStr(tr && (tr.source || tr.url));
      if (!s) continue;
      out.push({
        url:
          s.indexOf("http") === 0 ? s : "https://www.youtube.com/watch?v=" + s,
      });
    }
    return out.length ? out : undefined;
  }
  function buildEpisodes(meta, addon, type, engine) {
    var episodes = [];
    var isSeries = type === "series" || type === "anime";
    if (isSeries && Array.isArray(meta.videos)) {
      episodes = meta.videos
        .map(function (v) {
          if (!v) return null;
          var s = v.season === 0 ? 0 : safeInt(v.season, 1) || 1;
          if (!s && v.number) s = safeInt(v.number, 1) || 1;
          var e = safeInt(v.episode, 1) || 1;
          if (!e && v.number && !v.season) e = safeInt(v.number, 1) || 1;
          var vid = safeStr(v.id) || safeStr(meta.id) + ":" + s + ":" + e;
          var epDesc = stripHtml(
            v.overview || v.description || v.synopsis || "",
          );
          var epPoster = fixPoster(
            v.thumbnail || v.poster || v.still_path || v.image,
          );
          if (!epPoster)
            epPoster = fixPoster(meta.poster || meta.posterUrl || "");
          return clean({
            name: safeStr(v.name || v.title) || "Episode " + e,
            url: makeRef(addon.base + addon.queryStr, type, vid, engine),
            season: s,
            episode: e,
            description: epDesc ? epDesc.substring(0, 800) : undefined,
            rating: safeFloat(v.rating || v.vote_average),
            runtime: safeInt(v.runtime, 0) || undefined,
            airDate:
              safeStr(v.released || v.firstAired || v.airDate || v.air_date) ||
              undefined,
            posterUrl: epPoster || undefined,
          });
        })
        .filter(Boolean);
    }
    if (!episodes.length)
      episodes.push(
        clean({
          name: isSeries
            ? "Watch"
            : type === "livestream"
              ? "Live"
              : "Full Movie",
          url: makeRef(
            addon.base + addon.queryStr,
            type,
            safeStr(meta.id || ""),
            engine,
          ),
          season: 1,
          episode: 1,
        }),
      );
    return episodes;
  }
  function fallbackDetail(rawUrl, title, engineIn) {
    var ref = parseRef(rawUrl);
    var engine = engineIn || (ref && ref.exo ? "exoplayer" : undefined);
    var type = ref ? skyType(ref.type, false) : "movie";
    if (engine === "exoplayer") type = "livestream";
    var prettyId = ref
      ? safeStr(ref.id)
          .replace(/^(dsf|dramayo|tmdb|kitsu)[:_]/i, "")
          .replace(/[:_\-]+/g, " ")
          .trim()
      : safeStr(rawUrl);
    return {
      success: true,
      data: clean({
        title: title || prettyId || "Unknown",
        url: ref
          ? makeRef(ref.base, ref.type, ref.id, engine)
          : safeStr(rawUrl),
        posterUrl: "",
        type: type,
        episodes: [
          clean({
            name:
              type === "livestream"
                ? "Live"
                : type === "movie"
                  ? "Full Movie"
                  : "Watch",
            url: ref
              ? makeRef(ref.base, ref.type, ref.id, engine)
              : safeStr(rawUrl),
            season: 1,
            episode: 1,
          }),
        ],
      }),
    };
  }
  function detectResolution(l) {
    if (/\b(2160p?|4k|uhd)\b/.test(l)) return { res: "4K", key: 5 };
    if (/\b1440p?\b/.test(l)) return { res: "1440p", key: 4 };
    if (/\b1080[p|i]\b/.test(l)) return { res: "1080p", key: 3 };
    if (/\b720p?\b/.test(l)) return { res: "720p", key: 2 };
    if (/\b480p?\b|\bdvdrip\b/.test(l)) return { res: "480p", key: 1 };
    if (/\b360p?\b/.test(l)) return { res: "360p", key: 1 };
    if (/\b(cam|ts|tc|scr)\b/.test(l)) return { res: "CAM", key: 0 };
    if (/\bauto\b/.test(l)) return { res: "AUTO", key: 2 };
    return { res: "", key: 2 };
  }
  function detectCodec(l) {
    if (/\b(av1|av01)\b/.test(l)) return "AV1";
    if (/\b(x265|h.?265|hevc)\b/.test(l)) return "HEVC";
    if (/\b(x264|h.?264|avc)\b/.test(l)) return "H.264";
    if (/\bvp9\b/.test(l)) return "VP9";
    return null;
  }
  function detectAudio(l) {
    if (/\batmos\b|\btruehd\b/.test(l)) return "Atmos";
    if (/\bdts[-\s]?hd\b/.test(l)) return "DTS-HD";
    if (/\bdts\b/.test(l)) return "DTS";
    if (/\bflac\b/.test(l)) return "FLAC";
    if (/\baac\b|\beac3\b/.test(l)) return "AAC";
    if (/\bac3\b/.test(l)) return "AC3";
    if (/\bopus\b/.test(l)) return "Opus";
    return null;
  }
  function detectLang(l) {
    var m = [
      [/\bmulti\b/, "Multi"],
      [/📝|\bsub(s|bed)?\b/i, "SUB"],
      [/🔊|\bdub(bed)?\b/i, "DUB"],
      [/\bdual[\s._-]?audio\b|\bdual\b/, "Dual"],
      [/\bhindi\b/, "Hin"],
      [/\btamil\b/, "Tam"],
      [/\btelugu\b/, "Tel"],
      [/\bmalayalam\b/, "Mal"],
      [/\bkannada\b/, "Kan"],
      [/\bbengali\b/, "Ben"],
      [/\bjapanese?\b/, "Jpn"],
      [/\bkorean?\b/, "Kor"],
      [/\bchinese?\b/, "Chi"],
      [/\bspanish?\b/, "Spa"],
      [/\bfrench?\b/, "Fre"],
      [/\bgerman?\b/, "Ger"],
      [/\brussian?\b/, "Rus"],
      [/\benglish\b/, "Eng"],
    ];
    var f = [];
    for (var i = 0; i < m.length; i++) if (m[i][0].test(l)) f.push(m[i][1]);
    return f.length ? f.join("+") : null;
  }
  function detectSize(s, t) {
    if (s.behaviorHints && s.behaviorHints.videoSize) {
      var b = Number(s.behaviorHints.videoSize);
      if (b > 0)
        return (b / 1073741824).toFixed(2).replace(/\.?0+$/, "") + "GB";
    }
    var m = t.match(/(\d+(?:\.\d+)?)\s*(GB|GiB|MB|MiB|gb|mb)/);
    if (m) {
      var n = parseFloat(m[1]);
      var isGb = m[2].toLowerCase().charAt(0) === "g";
      if (isGb) return n + "GB";
      return n >= 1024
        ? (n / 1024).toFixed(2).replace(/\.?0+$/, "") + "GB"
        : n + "MB";
    }
    return null;
  }
  function extractCount(t, s, f) {
    var d = s[f];
    if (d != null && Number(d) > 0) return Number(d);
    var m = t.match(new RegExp("[👥🌱👤]\\s*(\\d+)"));
    if (m) return parseInt(m[1], 10);
    m = t.match(/(?:^|\s)(\d{2,})\s*(?:seeders?|peers?)\b/i);
    return m ? parseInt(m[1], 10) : 0;
  }
  function buildMagnet(h, n, src) {
    var hash = safeStr(h)
      .replace(/[^a-fA-F0-9]/g, "")
      .toLowerCase();
    if (hash.length !== 40) return "";
    var m = "magnet:?xt=urn:btih:" + hash;
    if (n) m += "&dn=" + encodeURIComponent(n.trim().substring(0, 120));
    var tr = FALLBACK_TRACKERS.slice();
    if (Array.isArray(src))
      src.forEach(function (s) {
        var t = safeStr(s);
        if (t.indexOf("tracker:") === 0) tr.push(t.substring(8));
      });
    for (var i = 0; i < tr.length; i++) m += "&tr=" + encodeURIComponent(tr[i]);
    return m;
  }
  function formatStream(s, addon) {
    try {
      if (!s || typeof s !== "object") return null;
      var url = null,
        infoHash = null;
      var lt = (
        safeStr(s.name) +
        " " +
        safeStr(s.title) +
        " " +
        safeStr(s.description)
      ).toLowerCase();
      if (isHttpStr(s.url)) {
        if (
          /\/(login|logout|signin|signup)([._?#]|$)/i.test(
            safeStr(s.url).replace(/^https?:\/\/[^/]+/, ""),
          )
        )
          return null;
        url = s.url.trim();
      } else if (safeStr(s.url).indexOf("magnet:") === 0) {
        url = s.url.trim();
        var mh = safeStr(s.url).match(/urn:btih:([a-fA-F0-9]{40})/);
        if (mh) infoHash = mh[1].toLowerCase();
      } else if (s.infoHash) infoHash = safeStr(s.infoHash);
      else return null;
      if (!url && infoHash) {
        url = buildMagnet(
          infoHash,
          (s.behaviorHints && s.behaviorHints.filename) || s.title || s.name,
          s.sources,
        );
        if (!url) return null;
      }
      var headers = {};
      var ph = s.behaviorHints && s.behaviorHints.proxyHeaders;
      if (ph && ph.request)
        for (var hk in ph.request)
          if (Object.prototype.hasOwnProperty.call(ph.request, hk))
            headers[hk] = safeStr(ph.request[hk]);
      if (!headers["User-Agent"] && !headers["user-agent"])
        headers["User-Agent"] = UA;
      if (
        s.behaviorHints &&
        s.behaviorHints.notWebReady === true &&
        /^https?:/i.test(url)
      )
        url = "MAGIC_PROXY_v1" + btoa(url);
      var res = detectResolution(lt),
        size = detectSize(s, lt),
        seeders = extractCount(lt, s, "seeders"),
        codec = detectCodec(lt),
        audio = detectAudio(lt),
        lang = detectLang(lt);
      var parts = [];
      if (res.res) parts.push(res.res);
      if (size) parts.push("💾" + size);
      if (seeders > 0) parts.push("🌱" + seeders);
      if (codec) parts.push(codec);
      if (audio) parts.push("🔊" + audio);
      if (lang) parts.push(lang);
      var label = parts.join("|");
      var source = (label ? label : "") + "[" + addon.name + "]";
      var inlineSubs = [];
      if (Array.isArray(s.subtitles))
        s.subtitles.forEach(function (x) {
          if (x && isHttpStr(x.url))
            inlineSubs.push({
              url: x.url,
              label: safeStr(x.lang || x.label || "Subtitle"),
              lang: safeStr(x.lang || "en"),
            });
        });
      return clean({
        url: url,
        source: source,
        quality: res.res || undefined,
        headers: Object.keys(headers).length ? headers : undefined,
        subtitles: inlineSubs.length ? inlineSubs : undefined,
        _sortKey: res.key,
        _seeders: seeders,
        _addonOrder: addon._order || 0,
      });
    } catch (e) {
      return null;
    }
  }
  function dedupeAndSort(streams) {
    var seen = {},
      out = [];
    for (var i = 0; i < streams.length; i++) {
      var s = streams[i];
      if (!s || !s.url) continue;
      var k;
      var mh = safeStr(s.url).match(/urn:btih:([a-fA-F0-9]{40})/i);
      if (mh) k = mh[1].toLowerCase();
      else
        k = safeStr(s.url)
          .replace(/^https?:\/\//, "")
          .replace(/\/+$/, "")
          .split("#")[0]
          .toLowerCase();
      if (!k || seen[k]) continue;
      seen[k] = 1;
      out.push(s);
    }
    out.sort(function (a, b) {
      var d = (b._sortKey || 0) - (a._sortKey || 0);
      if (d !== 0) return d;
      d = (b._seeders || 0) - (a._seeders || 0);
      if (d !== 0) return d;
      return (a._addonOrder || 0) - (b._addonOrder || 0);
    });
    return out.slice(0, CFG.MAX_STREAMS).map(function (s) {
      delete s._sortKey;
      delete s._seeders;
      delete s._addonOrder;
      return s;
    });
  }
  function isEnglishSub(s) {
    var l = safeStr(s.lang).toLowerCase(),
      lb = safeStr(s.label).toLowerCase();
    return (
      l === "en" ||
      l.indexOf("en-") === 0 ||
      l.indexOf("eng") === 0 ||
      lb.indexOf("english") !== -1
    );
  }
  async function fetchSubs(addons, ref) {
    var targets = addons.filter(function (a) {
      return a.hasSubs;
    });
    if (!targets.length) return [];
    var key = "subs:" + ref.type + ":" + ref.id;
    var cached = cacheGet(key);
    if (cached) return cached;
    var vid = ref.id;
    var results = await settle(
      targets.map(function (a) {
        var u =
          a.base +
          "/subtitles/" +
          ref.type +
          "/" +
          encodeURIComponent(vid) +
          ".json?videoID=" +
          encodeURIComponent(vid);
        return httpJson(u, CFG.SUB_TIMEOUT_MS);
      }),
    );
    var seen = {},
      subs = [];
    for (var i = 0; i < results.length; i++) {
      if (!results[i].ok || !results[i].value) continue;
      var list = results[i].value.subtitles;
      if (!Array.isArray(list)) continue;
      for (var j = 0; j < list.length; j++) {
        var sub = list[j];
        if (!sub || !isHttpStr(sub.url)) continue;
        var k = sub.url.split("#")[0];
        if (seen[k]) continue;
        seen[k] = 1;
        var lbl = safeStr(sub.lang || sub.label || "Subtitle");
        subs.push({
          url: sub.url,
          label: lbl,
          lang: safeStr(sub.lang || "en"),
        });
        if (subs.length >= CFG.MAX_SUBS) break;
      }
      if (subs.length >= CFG.MAX_SUBS) break;
    }
    cacheSet(key, subs, CFG.SUB_CACHE_TTL);
    return subs;
  }
  function attachSubs(streams, subs) {
    if (!subs || !subs.length) return;
    streams.forEach(function (s) {
      var ex = Array.isArray(s.subtitles) ? s.subtitles : [];
      var merged = ex.concat(subs);
      var seen = {},
        fresh = [];
      for (var i = 0; i < merged.length; i++) {
        var k = safeStr(merged[i].url).split("#")[0];
        if (seen[k]) continue;
        seen[k] = 1;
        fresh.push({
          url: merged[i].url,
          label: safeStr(merged[i].label) || "English",
          lang: safeStr(merged[i].lang) || "en",
        });
      }
      s.subtitles = fresh;
    });
  }
  function metaMatches(meta, q) {
    var title = (
      safeStr(meta.name || meta.title) +
      " " +
      safeStr(meta.englishName || "")
    ).toLowerCase();
    var desc = stripHtml(meta.description || "").toLowerCase();
    var tags = meta.genres || meta.tags || [];
    var tokens = q.split(/\s+/).filter(Boolean);
    var matched = 0;
    for (var ti = 0; ti < tokens.length; ti++) {
      var tok = tokens[ti];
      if (!tok) continue;
      if (title.indexOf(tok) !== -1) {
        matched++;
        continue;
      }
      if (desc.indexOf(tok) !== -1) {
        matched++;
        continue;
      }
      var foundTag = false;
      if (Array.isArray(tags))
        for (var gi = 0; gi < tags.length; gi++)
          if (String(tags[gi]).toLowerCase().indexOf(tok) !== -1) {
            foundTag = true;
            break;
          }
      if (foundTag) {
        matched++;
        continue;
      }
      var cast = meta.cast || [];
      if (Array.isArray(cast))
        for (var ci = 0; ci < cast.length; ci++)
          if (
            cast[ci] &&
            cast[ci].name &&
            cast[ci].name.toLowerCase().indexOf(tok) !== -1
          ) {
            matched++;
            break;
          }
    }
    if (matched >= tokens.length) return true;
    var nt = normalizeTitle(title),
      nq = normalizeTitle(q);
    if (nt && nq && nt.indexOf(nq) !== -1) return true;
    return false;
  }
  function normalizeTitle(t) {
    return safeStr(t)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .trim();
  }
  async function getHome(cb, page) {
    var _s0 = await getSettingsData();
    var _eng0 = _s0.forceExo ? "exoplayer" : undefined;
    var pn = Math.max(1, safeInt(page, 1));
    var cfg = collectAddonUrls().length;
    var addons = await getAddons();
    if (!cfg)
      return {
        success: false,
        errorCode: "NO_ADDONS",
        message: "No addons listed",
      };
    if (!addons.length)
      return {
        success: false,
        errorCode: "NO_DATA",
        message: "Could not reach any addon",
      };
    var ck = "home:p" + pn;
    var cached = cacheGet(ck);
    if (cached) return { success: true, data: cached };
    var descs = [];
    addons.forEach(function (a) {
      if (!a.hasCatalog) return;
      a.catalogs.forEach(function (c) {
        var ex = Array.isArray(c.extra) ? c.extra : [];
        if (
          ex.some(function (x) {
            return x && x.name === "search" && x.isRequired === true;
          })
        )
          return;
        var u = a.base + "/catalog/" + c.type + "/" + c.id + ".json";
        if (pn > 1)
          u =
            a.base +
            "/catalog/" +
            c.type +
            "/" +
            c.id +
            "/skip=" +
            (pn - 1) * 100 +
            ".json";
        u = appendQuery(u, a.queryStr);
        descs.push({
          addon: a,
          cat: c,
          start: function () {
            return fetchJson(u, CFG.CATALOG_TIMEOUT_MS, 1);
          },
        });
      });
    });
    var orderedDescs = roundRobin(descs, function (d) {
      return d.addon.url;
    }).slice(0, CFG.MAX_HOME_JOBS);
    // Phase-bounded: sections from finished catalogs render even if a few
    // addon hosts hang; unfinished slots are skipped gracefully.
    var res =
      (await withDeadline(
        pool(orderedDescs, CFG.POOL_CATALOGS, function (d) {
          return d.start();
        }),
        CFG.HOME_PHASE_MS,
        function () {
          return null;
        },
      )) || [];
    var home = {},
      order = [];
    for (var i = 0; i < res.length; i++) {
      var r = res[i];
      if (!r || !r.ok || !r.value) continue;
      var ms = r.value.metas;
      if (!Array.isArray(ms) || !ms.length) continue;
      var m = orderedDescs[i];
      var sec = safeStr(m.cat.name || m.cat.id);
      if (order.indexOf(sec) !== -1) {
        var tp = sec + " (" + safeStr(m.cat.type) + ")";
        if (order.indexOf(tp) === -1) sec = tp;
        else {
          var nd = sec + " (" + m.addon.name + ")";
          sec = order.indexOf(nd) === -1 ? nd : nd + " •";
          while (order.indexOf(sec) !== -1) sec += " •";
        }
      }
      var items = [];
      for (
        var j = 0;
        j < ms.length && items.length < CFG.MAX_ITEMS_PER_CATALOG;
        j++
      ) {
        var it = toItem(ms[j], m.addon, m.cat.type, _eng0);
        if (it) items.push(it);
      }
      if (!items.length) continue;
      home[sec] = items;
      order.push(sec);
    }
    if (!order.length) return { success: true, data: {} };
    var ordered = {};
    order.forEach(function (k) {
      ordered[k] = home[k];
    });
    cacheSet(ck, ordered, CFG.CATALOG_CACHE_TTL);
    return { success: true, data: ordered };
  }
  async function search(q, cb) {
    var _ss = await getSettingsData();
    var _engS = _ss.forceExo ? "exoplayer" : undefined;
    var query = safeStr(q).trim();
    if (!query) return { success: true, data: [] };
    var addons = await getAddons();
    if (!addons.length) return { success: true, data: [] };
    var qLower = query.toLowerCase();
    function mkTask(a, cat, u) {
      return {
        addon: a,
        cat: cat,
        start: function () {
          return fetchJson(u, CFG.SEARCH_TIMEOUT_MS, 1);
        },
      };
    }
    var nativeTasks = [];
    var filterTasks = [];
    addons.forEach(function (a) {
      var filterCount = 0;
      a.catalogs.forEach(function (cat) {
        var ex = Array.isArray(cat.extra) ? cat.extra : [];
        var hasSearch = ex.some(function (x) {
          return x && (x.name === "search" || x.name === "Search");
        });
        if (hasSearch) {
          nativeTasks.push(
            mkTask(
              a,
              cat,
              appendQuery(
                a.base +
                  "/catalog/" +
                  cat.type +
                  "/" +
                  cat.id +
                  "/search=" +
                  encodeURIComponent(query) +
                  ".json",
                a.queryStr,
              ),
            ),
          );
          return;
        }
        if (filterCount >= 6) return;
        filterCount++;
        filterTasks.push(
          mkTask(
            a,
            cat,
            appendQuery(
              a.base +
                "/catalog/" +
                cat.type +
                "/" +
                cat.id +
                ".json?limit=" +
                CFG.CLIENT_FILTER_LIMIT,
              a.queryStr,
            ),
          ),
        );
      });
    });
    var nativeRR = roundRobin(nativeTasks, function (t) {
      return t.addon.url;
    }).slice(0, CFG.MAX_SEARCH_TASKS);
    var nativeResults = await pool(nativeRR, CFG.POOL_SEARCH, function (t) {
      return t.start();
    });
    var all = [];
    for (var i = 0; i < nativeResults.length; i++) {
      var r = nativeResults[i];
      if (!r || !r.ok || !r.value || !Array.isArray(r.value.metas)) continue;
      var tk = nativeRR[i];
      for (var mi = 0; mi < r.value.metas.length; mi++) {
        var it = toItem(r.value.metas[mi], tk.addon, tk.cat.type, _engS);
        if (it) all.push(it);
      }
    }
    if (all.length >= 20) {
      if (all.length > CFG.MAX_SEARCH) all = all.slice(0, CFG.MAX_SEARCH);
      return { success: true, data: all };
    }
    var filterRR = roundRobin(filterTasks, function (t) {
      return t.addon.url;
    }).slice(0, Math.max(0, CFG.MAX_SEARCH_TASKS - nativeRR.length));
    var filterResults = await pool(filterRR, CFG.POOL_SEARCH, function (t) {
      return t.start();
    });
    for (var fi = 0; fi < filterResults.length; fi++) {
      var fr = filterResults[fi];
      if (!fr || !fr.ok || !fr.value || !Array.isArray(fr.value.metas))
        continue;
      var fk = filterRR[fi];
      for (var mi2 = 0; mi2 < fr.value.metas.length; mi2++) {
        var mm = fr.value.metas[mi2];
        if (metaMatches(mm, qLower)) {
          var it2 = toItem(mm, fk.addon, fk.cat.type, _engS);
          if (it2) all.push(it2);
        }
      }
    }
    if (all.length > CFG.MAX_SEARCH) all = all.slice(0, CFG.MAX_SEARCH);
    return { success: true, data: all };
  }
  async function load(url, cb) {
    var _sL = await getSettingsData();
    var _engL = _sL.forceExo ? "exoplayer" : undefined;
    var ref = parseRef(url);
    if (!ref) return fallbackDetail(url, "", _engL);
    var addons = await getAddons();
    var addon = null;
    for (var i = 0; i < addons.length; i++)
      if (addons[i].base === ref.base) {
        addon = addons[i];
        break;
      }
    var meta = null;
    if (ref.id) meta = cacheGet("meta:" + ref.type + ":" + ref.id);
    if (ref.id && !meta) {
      var mu = appendQuery(
        ref.base +
          "/meta/" +
          ref.type +
          "/" +
          encodeURIComponent(ref.id) +
          ".json",
        addon ? addon.queryStr : "",
      );
      function extract(p) {
        if (!p) return null;
        return p.meta || (Array.isArray(p.metas) ? p.metas[0] : null);
      }
      // Stage 1: own addon + cinemeta raced in parallel. Primary gets a short
      // grace window; if it hasn't answered, pre-warmed cinemeta results are
      // used immediately instead of waiting out the primary timeout.
      // fullWindow: slow hosts (cold TMDB lookups ~10-15s) need whole-window
      // attempts; split windows would miss both shots.
      var primaryP = fetchJson(mu, CFG.META_TIMEOUT_MS, 1, true);
      var cmPs = [];
      if (/^tt\d+/.test(ref.id)) {
        var cmTypes =
          ref.type === "movie"
            ? ["movie"]
            : ref.type === "series" || ref.type === "anime"
              ? ["series"]
              : ["series", "movie"];
        var bases = collectMetadataUrls().map(baseOf);
        if (!bases.length) bases = ["https://v3-cinemeta.strem.io"];
        bases.forEach(function (b) {
          cmTypes.forEach(function (ct) {
            cmPs.push(
              fetchJson(
                b + "/meta/" + ct + "/" + ref.id + ".json",
                CFG.META_TIMEOUT_MS,
                0,
              ),
            );
          });
        });
      }
      var graceMs = Math.min(3000, Math.round(CFG.META_TIMEOUT_MS * 0.35));
      function primaryMeta() {
        return primaryP.then(function (p) {
          var m = extract(p);
          return m && m.name ? m : null;
        });
      }
      function graceTick() {
        return delay(graceMs).then(function () {
          return null;
        });
      }
      meta = await Promise.race([primaryMeta(), graceTick()]);
      if (!meta || !meta.name) {
        var crs = await settle(cmPs);
        for (var ci = 0; ci < crs.length && !meta; ci++) {
          var cm = crs[ci] && crs[ci].ok ? crs[ci].value : null;
          if (cm && cm.meta && cm.meta.name) meta = cm.meta;
        }
      }
      if (!meta || !meta.name) {
        meta = await Promise.race([primaryMeta(), graceTick()]);
      }
      // Stage 2: sibling meta addons fetched in parallel, own-id match first.
      if (!meta || !meta.name) {
        var sibs = addons.filter(function (x) {
          return x.hasMeta && x.base !== ref.base;
        });
        var srs = await pool(sibs, CFG.POOL_META, function (s) {
          return fetchJson(
            appendQuery(
              s.base +
                "/meta/" +
                ref.type +
                "/" +
                encodeURIComponent(ref.id) +
                ".json",
              s.queryStr,
            ),
            CFG.META_TIMEOUT_MS,
            0,
          );
        });
        for (var si = 0; si < srs.length && !meta; si++) {
          var sm = srs[si] && srs[si].ok ? srs[si].value : null;
          if (sm && sm.meta && sm.meta.name) {
            if (safeStr(sm.meta.id) === safeStr(ref.id)) meta = sm.meta;
            else if (!sm.meta.id) meta = sm.meta;
          }
        }
      }
      // Last resort: every alternative failed — wait out the primary's own
      // budget instead of rendering fallback while it is still in flight.
      if (!meta || !meta.name) {
        var pm = extract(await primaryP);
        if (pm && pm.name) meta = pm;
      }
    }
    if (ref.id && meta && meta.name)
      cacheSet("meta:" + ref.type + ":" + ref.id, meta, CFG.CATALOG_CACHE_TTL);
    if (!meta) return fallbackDetail(url, "", _engL);
    var type = skyType(
      meta.type || ref.type,
      Array.isArray(meta.videos) && meta.videos.length > 0,
    );
    if ((addon && addon.isLive) || _engL === "exoplayer") type = "livestream";
    var imdbId = /^tt\d+/.test(safeStr(meta.id)) ? safeStr(meta.id) : undefined;
    var data = clean({
      title: safeStr(meta.name || meta.title || "Unknown"),
      url: makeRef(ref.base, type, safeStr(meta.id), _engL),
      posterUrl: fixPoster(meta.poster || meta.posterUrl || meta.poster_path),
      bannerUrl: fixPoster(meta.background || meta.backdrop || meta.banner),
      logoUrl: fixPoster(meta.logo),
      type: type,
      description: stripHtml(meta.description || meta.overview || "").substring(
        0,
        1000,
      ),
      year: metaYear(meta),
      score: metaScore(meta),
      tags: metaGenres(meta),
      cast: extractCast(meta),
      trailers: extractTrailers(meta),
      imdbId: imdbId,
      syncData: imdbId ? { imdb: imdbId } : undefined,
      status: /ended|canceled/i.test(safeStr(meta.status))
        ? "completed"
        : /returning|continuing|ongoing/i.test(safeStr(meta.status))
          ? "ongoing"
          : undefined,
      episodes: buildEpisodes(
        meta,
        addon || { base: ref.base, isLive: false },
        type,
        _engL,
      ),
    });
    return { success: true, data: data };
  }
  async function loadStreams(url, cb) {
    var started = Date.now();
    var ref = parseRef(url);
    if (!ref) return { success: true, data: [] };
    var settings = await getSettingsData();
    var ck = "streams:" + ref.type + ":" + ref.id;
    var cached = cacheGet(ck);
    if (cached) return { success: true, data: cached };
    var addons = await getAddons();
    var targets = addons.filter(function (a) {
      if (!a.hasStream) return false;
      if (!a.idPrefixes.length) return true;
      return a.idPrefixes.some(function (p) {
        return p && ref.id.indexOf(p) === 0;
      });
    });
    function typesFor(a) {
      var t = ref.type;
      if (t === "movie") return ["movie"];
      if (t === "series" || t === "anime") return ["series"];
      if (LIVE_TYPES[t]) return [t];
      var out = [t, "movie", "series"],
        uniq = [];
      out.forEach(function (x) {
        if (uniq.indexOf(x) === -1) uniq.push(x);
      });
      return uniq;
    }
    var jobBudget =
      settings.fireWindowMs === 0
        ? CFG.STREAM_TIMEOUT_MS
        : Math.min(settings.fireWindowMs, CFG.HARD_CEILING_MS);
    var orderCounter = 0;
    var jobs = targets.map(function (a) {
      a._order = orderCounter++;
      var types = typesFor(a);
      var fetches = types.map(function (t) {
        var reqUrl = appendQuery(
          a.base + "/stream/" + t + "/" + encodeURIComponent(ref.id) + ".json",
          a.queryStr,
        );
        return fetchJson(reqUrl, CFG.STREAM_TIMEOUT_MS, 0).then(
          function (data) {
            var list = data && Array.isArray(data.streams) ? data.streams : [];
            var out = [];
            list.forEach(function (s) {
              var f = formatStream(s, a);
              if (f) out.push(f);
            });
            return out;
          },
        );
      });
      return withDeadline(
        settle(fetches).then(function (rs) {
          var acc = [];
          rs.forEach(function (r) {
            if (r.ok && Array.isArray(r.value)) acc = acc.concat(r.value);
          });
          return acc;
        }),
        jobBudget,
        function () {
          return [];
        },
      );
    });
    var subJob = settings.englishSubs
      ? withDeadline(
          fetchSubs(addons, ref),
          CFG.SUB_TIMEOUT_MS + 2000,
          function () {
            return [];
          },
        )
      : Promise.resolve([]);
    var results = await settle(jobs);
    var streams = [];
    results.forEach(function (r) {
      if (r.ok && Array.isArray(r.value)) streams = streams.concat(r.value);
    });
    var subRes = await settle([subJob]);
    var subs =
      subRes[0] && subRes[0].ok && Array.isArray(subRes[0].value)
        ? subRes[0].value
        : [];
    var finalStreams = dedupeAndSort(streams);
    if (settings.englishSubs && subs.length) attachSubs(finalStreams, subs);
    if (settings.fireWindowMs !== 0) {
      var remain = settings.fireWindowMs - (Date.now() - started);
      if (remain > 0 && remain < CFG.GUARD_BUDGET_MS) await delay(remain);
    }
    console.log(
      "[StremioHub] " +
        ref.id +
        ": " +
        finalStreams.length +
        " streams from " +
        targets.length +
        " addons in " +
        (Date.now() - started) +
        "ms",
    );
    cacheSet(ck, finalStreams, CFG.STREAM_CACHE_TTL);
    return { success: true, data: finalStreams };
  }
  function guarded(fn, fb) {
    return async function () {
      var args = Array.prototype.slice.call(arguments);
      var cb =
        args.length && typeof args[args.length - 1] === "function"
          ? args[args.length - 1]
          : null;
      var delivered = false;
      function deliver(r) {
        if (delivered) return r;
        delivered = true;
        if (cb)
          try {
            cb(r);
          } catch (e) {}
        return r;
      }
      return withDeadline(
        Promise.resolve()
          .then(function () {
            return fn.apply(null, args);
          })
          .then(deliver)
          .catch(function (e) {
            return deliver(fb.apply(null, args));
          }),
        CFG.GUARD_BUDGET_MS,
        function () {
          return deliver(fb.apply(null, args));
        },
      );
    };
  }
  var g = typeof globalThis !== "undefined" ? globalThis : this;
  g.getHome = guarded(getHome, function () {
    return {
      success: false,
      errorCode: "TIMEOUT",
      message: "Home took too long",
    };
  });
  g.search = guarded(search, function () {
    return { success: true, data: [] };
  });
  g.load = guarded(load, function (u) {
    return fallbackDetail(u, "");
  });
  g.loadStreams = guarded(loadStreams, function () {
    return { success: true, data: [] };
  });
  g.getSettings = getSettings;
})();
