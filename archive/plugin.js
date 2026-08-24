/*
 * Internet Archive — SkyStream plugin.
 * Catalogs: anime / animation / feature films / comedy / classic TV / children's TV.
 * Streams: direct archive.org MP4/MKV derivatives + originals, subtitles when present.
 * Sources: advancedsearch.php (catalog/search), /metadata/{id} (files), /services/img (posters).
 */
(function () {
  "use strict";

  var CFG = {
    SEARCH_TIMEOUT_MS: 15000,
    METADATA_TIMEOUT_MS: 15000,
    HOME_TIMEOUT_MS: 30000,
    GUARD_BUDGET_MS: 80000,
    METADATA_CACHE_TTL: 600000,
    HOME_CACHE_TTL: 600000,
    MAX_STREAMS: 20,
    MAX_SEARCH: 60,
    MAX_ITEMS_PER_CATALOG: 60,
    CACHE_MAX_ENTRIES: 300,
  };

  var JSON_HEADERS = {
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.5",
  };

  var COLLECTIONS = [
    { id: "anime", name: "Anime", sort: "-downloads" },
    { id: "animepacks", name: "Anime Packs (Full Series)", sort: "-downloads" },
    {
      id: "anime_miscellaneous",
      name: "Anime Miscellaneous",
      sort: "-downloads",
    },
    { id: "more_animation", name: "More Animation", sort: "-downloads" },
    {
      id: "animationandcartoons",
      name: "Cartoons & Animation",
      sort: "-downloads",
    },
    { id: "SciFi_Horror", name: "Sci-Fi & Horror", sort: "-downloads" },
    { id: "silent_films", name: "Silent Films", sort: "-downloads" },
    {
      id: "animation_unsorted",
      name: "Animation Unsorted",
      sort: "-downloads",
    },
    { id: "feature_films_unsorted", name: "Feature Films", sort: "-downloads" },
    { id: "Comedy_Films", name: "Comedy Films", sort: "-downloads" },
    { id: "classic_tv", name: "Classic TV", sort: "-downloads" },
    { id: "childrenstelevision", name: "Children's TV", sort: "-downloads" },
    { id: "prelinger", name: "Documentaries & Ephemeral", sort: "-downloads" },
  ];

  var PLAYABLE_EXT = [
    ".ia.mp4",
    ".mp4",
    ".m4v",
    ".mkv",
    ".avi",
    ".mpg",
    ".mpeg",
    ".webm",
    ".ogv",
  ];
  var SUB_EXT = [".srt", ".vtt", ".ass", ".ssa"];

  // ── utils ──────────────────────────────────────────────────────
  function safeStr(s) {
    return s == null ? "" : String(s);
  }
  function safeInt(v, d) {
    var n = parseInt(v, 10);
    return isNaN(n) ? d || 0 : n;
  }
  function safeJson(t, f) {
    try {
      return JSON.parse(safeStr(t));
    } catch (e) {
      return f !== undefined ? f : null;
    }
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
  function pLimit(concurrency) {
    var queue = [];
    var activeCount = 0;
    var next = function () {
      if (queue.length === 0 || activeCount >= concurrency) return;
      activeCount++;
      var fn = queue.shift();
      fn().then(function () {
        activeCount--;
        next();
      });
    };
    return function (fn) {
      return new Promise(function (resolve, reject) {
        queue.push(function () {
          return Promise.resolve().then(fn).then(resolve, reject);
        });
        next();
      });
    };
  }
  var iaLimit = pLimit(2);
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

  // ── settings ───────────────────────────────────────────────────
  var _settingsCache = { ts: 0, data: null };
  function readPrefRaw(key) {
    if (typeof _dartAsyncCall === "function") {
      try {
        return _dartAsyncCall("get_preference", {
          packageName: manifest.packageName,
          key: key,
        });
      } catch (e) {}
    }
    if (typeof getPreference === "function") {
      try {
        return Promise.resolve(getPreference(key));
      } catch (e) {}
    }
    return Promise.resolve(null);
  }
  async function getSettingsData() {
    if (_settingsCache.data && Date.now() - _settingsCache.ts < 2000)
      return _settingsCache.data;
    var keys = ["fire_window", "external_subs", "force_exoplayer"];
    var vals = await settle(keys.map(readPrefRaw));
    function val(k, dflt) {
      var i = keys.indexOf(k);
      var v = i >= 0 && vals[i] && vals[i].ok ? vals[i].value : null;
      return v === null || v === undefined || v === "" ? dflt : safeStr(v);
    }
    var fw = val("fire_window", "0");
    var fireWindowMs = fw === "0" ? 0 : safeInt(fw, 0);
    var data = {
      fireWindowMs: fireWindowMs,
      externalSubs: val("external_subs", "true").toLowerCase() !== "false",
      forceExo: val("force_exoplayer", "false").toLowerCase() === "true",
    };
    _settingsCache.ts = Date.now();
    _settingsCache.data = data;
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
        description:
          "Off = instant (recommended for Archive). Timed values hold the batch.",
        type: "select",
        defaultValue: "0",
        reloadOnChange: true,
        options: [
          { label: "Off (instant)", value: "0" },
          { label: "15 seconds", value: "15000" },
          { label: "30 seconds", value: "30000" },
        ],
      },
      {
        key: "external_subs",
        title: "Enable External Subs",
        description: "Attach subtitle files found inside archive items.",
        type: "toggle",
        defaultValue: "true",
        reloadOnChange: true,
      },
      {
        key: "force_exoplayer",
        title: "Only Use ExoPlayer",
        description: "Force ExoPlayer for playback (marks content as live).",
        type: "toggle",
        defaultValue: "false",
        reloadOnChange: true,
      },
    ];
  }

  // ── http ───────────────────────────────────────────────────────
  async function httpJson(url, timeoutMs) {
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
    var status = safeInt(resp.status || resp.statusCode || resp.code, 0);
    if (status !== 200 && status !== 206 && status !== 304) return null;
    var body =
      typeof resp.body === "string"
        ? resp.body.replace(/^\uFEFF/, "").trim()
        : "";
    if (!body || body.charAt(0) === "<") return null;
    return safeJson(body, null);
  }
  async function fetchJson(url, timeoutMs, retries) {
    var d = await httpJson(url, timeoutMs);
    if (d) return d;
    if ((retries || 0) > 0) {
      await delay(500);
      return httpJson(url, timeoutMs);
    }
    return null;
  }

  // ── refs ───────────────────────────────────────────────────────
  var REF_TAG = "ia";
  var EXO_MARKER = "/live/";
  function makeRef(id, fileStem, engine) {
    var r =
      REF_TAG +
      "|" +
      safeStr(id).split("|").join("%7C") +
      "|" +
      safeStr(fileStem).split("|").join("%7C");
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
    if (p.length < 2 || p[0] !== REF_TAG) return null;
    return {
      id: p[1].split("%7C").join("|"),
      stem: p.length > 2 ? p.slice(2).join("|").split("%7C").join("|") : "",
      exo: exo,
    };
  }

  // ── IA helpers ─────────────────────────────────────────────────
  function escLucene(s) {
    return safeStr(s)
      .replace(/[+\-&|!(){}\[\]^"~*?:\\\/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function searchUrl(query, rows, sort) {
    var q = "(" + query + ") AND mediatype:(movies)";
    return (
      "https://archive.org/advancedsearch.php?q=" +
      encodeURIComponent(q) +
      "&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=date&rows=" +
      rows +
      "&sort%5B%5D=" +
      encodeURIComponent(sort || "-downloads") +
      "&output=json"
    );
  }
  function collectionUrl(colId, rows, sort) {
    return searchUrl("collection:(" + colId + ")", rows, sort);
  }
  function posterUrl(id) {
    return "https://archive.org/services/img/" + encodeURIComponent(id);
  }
  function fileUrl(id, name) {
    return (
      "https://archive.org/download/" +
      encodeURIComponent(id).replace(/%2F/g, "/") +
      "/" +
      name.split("/").map(encodeURIComponent).join("/")
    );
  }
  function metaYear(m) {
    var y = safeInt(m.year, 0);
    if (!y && m.date) y = safeInt(safeStr(m.date).split("-")[0], 0);
    return y > 1800 && y < 2100 ? y : undefined;
  }
  function metaScore(m) {
    var r = parseFloat(m.avg_rating);
    return !isNaN(r) && r > 0 && r <= 5 ? Math.round(r * 20) / 20 : undefined;
  }
  function guessType(title) {
    var t = safeStr(title).toLowerCase();
    if (
      /\b(complete|full)\s+(series|season)\b/.test(t) ||
      /\b\d{1,3}\s*(-|–|to)\s*\d{1,3}\b/.test(t) ||
      /\bepisodes?\b/.test(t) ||
      /\bS\d{1,2}\b/i.test(t)
    )
      return "series";
    return "movie";
  }
  function toItem(doc, engine) {
    try {
      if (!doc || !doc.identifier) return null;
      var type = guessType(doc.title);
      return clean({
        title: safeStr(doc.title || doc.identifier),
        url: makeRef(doc.identifier, "", engine),
        posterUrl: posterUrl(doc.identifier),
        bannerUrl: posterUrl(doc.identifier),
        type: type,
        description: stripHtml(doc.description || "").substring(0, 400),
        year: metaYear(doc),
        score: metaScore(doc),
        tags: Array.isArray(doc.subject)
          ? doc.subject.slice(0, 4).map(safeStr)
          : undefined,
      });
    } catch (e) {
      return null;
    }
  }

  function extOf(name) {
    var n = safeStr(name).toLowerCase();
    for (var i = 0; i < PLAYABLE_EXT.length; i++)
      if (n.lastIndexOf(PLAYABLE_EXT[i]) === n.length - PLAYABLE_EXT[i].length)
        return PLAYABLE_EXT[i];
    return "";
  }
  function subExtOf(name) {
    var n = safeStr(name).toLowerCase();
    for (var i = 0; i < SUB_EXT.length; i++)
      if (n.lastIndexOf(SUB_EXT[i]) === n.length - SUB_EXT[i].length)
        return SUB_EXT[i];
    return "";
  }
  function stemOf(name) {
    var n = safeStr(name);
    var lo = n.toLowerCase();
    if (lo.lastIndexOf(".ia.mp4") === lo.length - 7)
      return n.substring(0, n.length - 7);
    var dot = n.lastIndexOf(".");
    return dot > 0 ? n.substring(0, dot) : n;
  }
  function normStem(s) {
    return safeStr(s).toLowerCase();
  }
  function parseEp(name) {
    var stem = stemOf(name);
    var m = stem.match(/\bS(\d{1,2})\s?E(\d{1,3})\b/i);
    if (m) return { s: safeInt(m[1], 1), e: safeInt(m[2], 1) };
    m = stem.match(
      /(?:^|[^\da-z])(?:e|ep|episode|episodio|cap)[\s._\-]*(\d{1,3})(?!\d)/i,
    );
    if (m) return { s: 1, e: safeInt(m[1], 1) };
    m = stem.match(/(?:^|[\s._\-\[])(\d{1,3})(?=[\s._\-\]]|$)/);
    if (m) return { s: 1, e: safeInt(m[1], 1) };
    return null;
  }
  function qualityFromHeight(h) {
    var n = safeInt(h, 0);
    if (!n) return "";
    if (n >= 2000) return "4K";
    if (n >= 1400) return "1440p";
    if (n >= 1000) return "1080p";
    if (n >= 700) return "720p";
    if (n >= 550) return "576p";
    if (n >= 450) return "480p";
    if (n >= 350) return "360p";
    return n + "p";
  }
  function fmtSize(bytes) {
    var b = safeInt(bytes, 0);
    if (!b) return "";
    if (b >= 1073741824)
      return (b / 1073741824).toFixed(1).replace(/\.0$/, "") + "GB";
    return Math.round(b / 1048576) + "MB";
  }
  function variantRank(f) {
    var n = safeStr(f.name).toLowerCase();
    var fmt = safeStr(f.format).toLowerCase();
    if (n.indexOf(".ia.mp4") !== -1) return 0;
    if (fmt.indexOf("h.264") !== -1) return 1;
    if (n.indexOf(".mp4") !== -1 && fmt.indexOf("512kb") === -1) return 2;
    if (fmt.indexOf("512kb") !== -1) return 3;
    if (fmt.indexOf("matroska") !== -1 || n.indexOf(".mkv") !== -1) return 4;
    return 5;
  }
  function subLangFromName(name) {
    var n = safeStr(name).toLowerCase();
    if (/\.eng\.|\.en\.|english/.test(n)) return "en";
    if (/\.jpn\.|\.jp\.|japanese/.test(n)) return "ja";
    return "en";
  }

  async function fetchMeta(id) {
    var ck = "iam:" + id;
    var c = cacheGet(ck);
    if (c) return c;
    var u =
      "https://archive.org/metadata/" +
      encodeURIComponent(id).replace(/%2F/g, "%252F");
    var d = await fetchJson(u, CFG.METADATA_TIMEOUT_MS, 2);
    if (!d) {
      await delay(1000);
      d = await fetchJson(u, CFG.METADATA_TIMEOUT_MS, 1);
    }
    if (d && d.metadata) cacheSet(ck, d, CFG.METADATA_CACHE_TTL);
    return d;
  }

  // ── core ───────────────────────────────────────────────────────
  async function getHome(cb, page) {
    var started = Date.now();
    var pageNum = Math.max(1, safeInt(page, 1));
    var settings = await getSettingsData();
    var engine = settings.forceExo || undefined;
    var ck = "home:p" + pageNum;
    var cached = cacheGet(ck);
    if (cached) return { success: true, data: cached };

    var weight = {
      anime: 2,
      anime_miscellaneous: 2,
      animepacks: 1,
      animationandcartoons: 1,
    };
    var orderedCols = COLLECTIONS.slice().sort(function (a, b) {
      return (weight[a.id] || 0) - (weight[b.id] || 0);
    });
    var jobs = orderedCols.map(function (c) {
      return iaLimit(function () {
        return fetchJson(
          collectionUrl(c.id, CFG.MAX_ITEMS_PER_CATALOG, c.sort),
          CFG.HOME_TIMEOUT_MS,
          1,
        ).then(function (d) {
          return { col: c, d: d };
        });
      });
    });
    var results = await settle(jobs);

    // Second chance for collections that got throttled on the first pass.
    var retryJobs = [];
    results.forEach(function (r, idx) {
      if (!r.ok || !r.value || !r.value.d)
        retryJobs.push({ col: orderedCols[idx], idx: idx });
    });
    if (retryJobs.length && Date.now() - started < 45000) {
      await delay(1200);
      var retryResults = await settle(
        retryJobs.map(function (j) {
          return iaLimit(function () {
            return fetchJson(
              collectionUrl(j.col.id, CFG.MAX_ITEMS_PER_CATALOG, j.col.sort),
              CFG.HOME_TIMEOUT_MS,
              1,
            ).then(function (d) {
              return { col: j.col, d: d };
            });
          });
        }),
      );
      retryResults.forEach(function (r, k) {
        results[retryJobs[k].idx] = r;
      });
    }

    var home = {};
    var order = [];
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r.ok || !r.value || !r.value.d) continue;
      var docs = r.value.d.response && r.value.d.response.docs;
      if (!Array.isArray(docs) || !docs.length) continue;
      var items = [];
      for (
        var j = 0;
        j < docs.length && items.length < CFG.MAX_ITEMS_PER_CATALOG;
        j++
      ) {
        var it = toItem(docs[j], engine);
        if (it) items.push(it);
      }
      if (!items.length) continue;
      var sec = r.value.col.name;
      while (order.indexOf(sec) !== -1) sec += " •";
      home[sec] = items;
      order.push(sec);
    }
    if (!order.length)
      return {
        success: false,
        errorCode: "NO_DATA",
        message: "Could not reach archive.org",
      };
    var canonical = COLLECTIONS.map(function (c) {
      return c.name;
    });
    var sortedOrder = [];
    canonical.forEach(function (name) {
      if (order.indexOf(name) !== -1) sortedOrder.push(name);
    });
    order.forEach(function (k) {
      if (sortedOrder.indexOf(k) === -1) sortedOrder.push(k);
    });
    var ordered = {};
    sortedOrder.forEach(function (k) {
      ordered[k] = home[k];
    });
    cacheSet(ck, ordered, CFG.HOME_CACHE_TTL);
    return { success: true, data: ordered };
  }

  async function search(q, cb) {
    var settings = await getSettingsData();
    var engine = settings.forceExo || undefined;
    var query = escLucene(q);
    if (!query) return { success: true, data: [] };

    var all = [];
    var seen = {};

    function pushDocs(d) {
      var docs = d && d.response && d.response.docs;
      if (!Array.isArray(docs)) return;
      for (var i = 0; i < docs.length && all.length < CFG.MAX_SEARCH; i++) {
        var it = toItem(docs[i], engine);
        if (!it) continue;
        var k = safeStr(docs[i].identifier);
        if (seen[k]) continue;
        seen[k] = 1;
        all.push(it);
      }
    }

    var phrase = await fetchJson(
      searchUrl('title:("' + query + '")', CFG.MAX_SEARCH, "-downloads"),
      CFG.SEARCH_TIMEOUT_MS,
      1,
    );
    pushDocs(phrase);

    if (all.length < 20) {
      var loose = await fetchJson(
        searchUrl(query.split(" ").join(" AND "), CFG.MAX_SEARCH, "-downloads"),
        CFG.SEARCH_TIMEOUT_MS,
        1,
      );
      pushDocs(loose);
    }
    if (all.length > CFG.MAX_SEARCH) all = all.slice(0, CFG.MAX_SEARCH);
    return { success: true, data: all };
  }

  function buildDetail(id, meta, engine) {
    var m = meta.metadata || {};
    var files = Array.isArray(meta.files) ? meta.files : [];
    var videos = files.filter(function (f) {
      return extOf(f.name) !== "";
    });

    var groups = {};
    var orderKeys = [];
    videos.forEach(function (f) {
      var st = normStem(stemOf(f.name));
      if (!groups[st]) {
        groups[st] = [];
        orderKeys.push(st);
      }
      groups[st].push(f);
    });

    var episodes = [];
    orderKeys.forEach(function (st) {
      var g = groups[st].slice().sort(function (a, b) {
        return variantRank(a) - variantRank(b);
      });
      var best = g[0];
      var ep = parseEp(best.name);
      episodes.push({
        stem: st,
        best: best,
        variants: g,
        s: ep ? ep.s : 1,
        e: ep ? ep.e : episodes.length + 1,
      });
    });
    episodes.sort(function (a, b) {
      return a.s - b.s || a.e - b.e;
    });
    var realCount = 0;
    episodes.forEach(function (ep, idx) {
      if (parseEp(ep.best.name)) {
        ep.hasReal = true;
        realCount++;
      } else {
        ep.e = idx + 1;
      }
    });

    // Numbered episodes => series. Multiple encodes of one film => movie
    // whose single entry streams every variant (qualities merge at stream level).
    var isSeries =
      realCount >= 2 ||
      (episodes.length > 3 && guessType(m.title) === "series");
    var type = isSeries ? "series" : "movie";

    var epList = isSeries
      ? episodes.map(function (ep) {
          return clean({
            name: "Episode " + ep.e,
            url: makeRef(id, ep.stem, engine),
            season: ep.s,
            episode: ep.e,
            description:
              ep.variants.length > 1
                ? ep.variants.length + " quality versions"
                : undefined,
          });
        })
      : [
          clean({
            name: type === "livestream" ? "Live" : "Full Movie",
            url: makeRef(id, "", engine),
            season: 1,
            episode: 1,
          }),
        ];
    if (!epList.length)
      epList.push(
        clean({
          name: "Play",
          url: makeRef(id, "", engine),
          season: 1,
          episode: 1,
        }),
      );

    return clean({
      title: safeStr(m.title || id),
      url: makeRef(id, "", engine),
      posterUrl: posterUrl(id),
      bannerUrl: posterUrl(id),
      type: type,
      description: stripHtml(m.description || "").substring(0, 800),
      year: metaYear(m),
      creator: safeStr(m.creator) || undefined,
      episodes: epList,
    });
  }

  async function load(url, cb) {
    var settings = await getSettingsData();
    var engine = settings.forceExo || undefined;
    var ref = parseRef(url);
    if (!ref)
      return {
        success: true,
        data: clean({
          title: "Unknown",
          url: safeStr(url),
          type: "movie",
          episodes: [],
        }),
      };
    var meta = await fetchMeta(ref.id);
    var dark = !!(
      meta &&
      meta.metadata &&
      (meta.metadata.is_dark === true || meta.metadata.is_dark === "true")
    );
    if (!meta || !meta.metadata || dark)
      return {
        success: true,
        data: clean({
          title:
            safeStr(meta && meta.metadata ? meta.metadata.title : "") || ref.id,
          url: makeRef(ref.id, "", engine),
          posterUrl: posterUrl(ref.id),
          type: "movie",
          description: dark
            ? "This item is currently unavailable on archive.org."
            : "Could not reach archive.org — try again.",
          episodes: [
            clean({
              name: dark ? "Unavailable" : "Play",
              url: makeRef(ref.id, "", engine),
              season: 1,
              episode: 1,
            }),
          ],
        }),
      };
    return { success: true, data: buildDetail(ref.id, meta, engine) };
  }

  async function loadStreams(url, cb) {
    var started = Date.now();
    var settings = await getSettingsData();
    var ref = parseRef(url);
    if (!ref || !ref.id) return { success: true, data: [] };

    var ck = "streams:" + ref.id + ":" + normStem(ref.stem);
    var cached = cacheGet(ck);
    if (cached) return { success: true, data: cached };

    var meta = await fetchMeta(ref.id);
    if (
      !meta ||
      !meta.metadata ||
      meta.metadata.is_dark === true ||
      meta.metadata.is_dark === "true"
    )
      return { success: true, data: [] };

    var files = Array.isArray(meta.files) ? meta.files : [];
    var id = ref.id;

    var targetStem = normStem(ref.stem);
    var groups = {};
    var groupOrder = [];
    files.forEach(function (f) {
      if (extOf(f.name) === "") return;
      var st = normStem(stemOf(f.name));
      if (targetStem && st !== targetStem) return;
      if (!groups[st]) {
        groups[st] = [];
        groupOrder.push(st);
      }
      groups[st].push(f);
    });

    var streams = [];
    var seenQualities = targetStem ? null : {};
    groupOrder.slice(0, 6).forEach(function (st) {
      var g = groups[st].slice().sort(function (a, b) {
        return variantRank(a) - variantRank(b);
      });
      var addedHeights = seenQualities || {};
      var count = 0;
      for (var vi = 0; vi < g.length && count < 3; vi++) {
        var f = g[vi];
        var q =
          qualityFromHeight(f.height) ||
          safeStr(f.format).split(/[,(]/)[0].trim();
        if (q && addedHeights[q]) continue;
        addedHeights[q] = 1;
        count++;
        var parts = [];
        if (q) parts.push(q);
        var sz = fmtSize(f.size);
        if (sz) parts.push("💾" + sz);
        var fmt = safeStr(f.format).split(/[,(]/)[0].trim();
        if (fmt && fmt.toLowerCase() !== "mpeg4") parts.push(fmt);
        var st2 = streams.push(
          clean({
            _fname: f.name,
            url: fileUrl(id, f.name),
            source:
              (parts.length ? parts.join("|") + "|" : "") +
              (count > 1 ? "Alt" : "") +
              "[Internet Archive]",
            quality: q || undefined,
            headers: { "User-Agent": "Mozilla/5.0 (SkyStream)" },
          }),
        );
        streams[st2 - 1]._h = safeInt(f.height, 0);
      }
    });

    if (settings.externalSubs && streams.length) {
      var subFiles = files.filter(function (f) {
        return subExtOf(f.name) !== "";
      });
      var label = function (name) {
        var base = safeStr(name)
          .replace(/\.(srt|vtt|ass|ssa)$/i, "")
          .replace(/\.(autogenerated|asr|disc\d?)$/i, "")
          .trim();
        return /(^|[^a-z])(en|eng|english)([^a-z]|$)/i.test(base)
          ? "English"
          : base.length > 26
            ? base.substring(0, 24) + "…"
            : base || "Subtitle";
      };
      streams.forEach(function (st) {
        var vStem = normStem(stemOf(st._fname || ""));
        var matched = [];
        var others = [];
        subFiles.forEach(function (f) {
          var entry = {
            url: fileUrl(id, f.name),
            label: label(f.name),
            lang: subLangFromName(f.name),
          };
          var sStem = normStem(
            safeStr(f.name)
              .replace(/\.(srt|vtt|ass|ssa)$/i, "")
              .replace(/\.(autogenerated|asr|disc\d?)$/i, ""),
          );
          if (vStem && (sStem === vStem || sStem.indexOf(vStem) === 0))
            matched.push(entry);
          else others.push(entry);
        });
        var picked = matched.length ? matched : others.slice(0, 6);
        picked = picked.slice(0, CFG.MAX_SUBS);
        if (picked.length)
          st.subtitles = picked.map(function (x) {
            return clean(x);
          });
      });
    }

    streams.sort(function (a, b) {
      return (b._h || 0) - (a._h || 0);
    });
    streams.forEach(function (x) {
      delete x._h;
      delete x._fname;
    });
    if (streams.length > CFG.MAX_STREAMS)
      streams = streams.slice(0, CFG.MAX_STREAMS);
    console.log(
      "[Archive] " +
        id +
        ": " +
        streams.length +
        " streams in " +
        (Date.now() - started) +
        "ms",
    );
    if (streams.length) cacheSet(ck, streams, 600000);
    return { success: true, data: streams };
  }

  // ── guard + exports ────────────────────────────────────────────
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
            console.warn(
              "[Archive] " + (fn.name || "fn") + " failed: " + (e && e.message),
            );
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
    var ref = parseRef(u);
    return {
      success: true,
      data: clean({
        title: ref ? ref.id : "Unknown",
        url: safeStr(u),
        type: "movie",
        episodes: [
          clean({ name: "Play", url: safeStr(u), season: 1, episode: 1 }),
        ],
      }),
    };
  });
  g.loadStreams = guarded(loadStreams, function () {
    return { success: true, data: [] };
  });
  g.getSettings = getSettings;
})();
