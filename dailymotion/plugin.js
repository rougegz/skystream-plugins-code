(function () {
  "use strict";
  var UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  var API = "https://api.dailymotion.com";
  var META = "https://www.dailymotion.com/player/metadata/video/";
  var CFG = {
    TIMEOUT_MS: 12000,
    GUARD_BUDGET_MS: 75000,
    LIST_LIMIT: 40,
    MAX_SEARCH: 60,
    MAX_UPNEXT: 30,
  };
  var FIELDS =
    "id,title,duration,thumbnail_480_url,thumbnail_360_url,views_total,created_time,owner.screenname,owner.id";
  var JSON_HEADERS = {
    "User-Agent": UA,
    Accept: "application/json",
    Referer: "https://www.dailymotion.com/",
  };
  var STREAM_HEADERS = {
    "User-Agent": UA,
    Referer: "https://www.dailymotion.com/",
    xqwvbmklpjhgfdsazxcvbnm: "kjhgfdsaqwertyuiopmnbvcxz",
    poiuytrewqlkjhgfdsamnbvcxz: "mnbvcxzlkjhgfdsapoiuytrewq",
    zxcvbnmasdfghjklqwertyui: "qwertyuiopasdfghjklmnbvcxz",
  };
  var CHANNELS = [
    ["movies", "Movies"],
    ["tv", "TV Shows"],
    ["music", "Music"],
    ["sport", "Sports"],
    ["news", "News"],
    ["gaming", "Gaming"],
    ["entertainment", "Entertainment"],
    ["comedy", "Comedy"],
  ];
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
        if (v !== null && v !== undefined && v !== "") r[k] = v;
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
  async function httpJson(url, timeoutMs) {
    var done = false;
    // api.dailymotion.com resets connections when Referer/Accept-Language are
    // present (TLS+header fingerprinting) — send minimal headers there.
    var hdrs =
      url.indexOf("api.dailymotion.com") !== -1
        ? { "User-Agent": UA, Accept: "application/json" }
        : JSON_HEADERS;
    var resp = await new Promise(function (resolve) {
      var t = setTimeout(function () {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, timeoutMs);
      http_get(url, hdrs).then(
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
  async function fetchJson(url, timeoutMs, retries) {
    var d = await httpJson(url, timeoutMs);
    if (d) return d;
    var left = retries || 0;
    var wait = 500;
    while (left > 0) {
      await delay(wait);
      d = await httpJson(url, timeoutMs);
      if (d) return d;
      left--;
      wait = Math.min(wait * 2, 2000);
    }
    return null;
  }
  function fmtViews(n) {
    n = safeInt(n, 0);
    if (n >= 1000000)
      return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M views";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K views";
    return n > 0 ? n + " views" : "";
  }
  function fmtDur(sec) {
    sec = safeInt(sec, 0);
    var h = Math.floor(sec / 3600),
      m = Math.floor((sec % 3600) / 60),
      s = sec % 60;
    return h > 0
      ? h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0")
      : m + ":" + String(s).padStart(2, "0");
  }
  function makeRef(id) {
    return "dm|" + safeStr(id);
  }
  function parseId(url) {
    var raw = safeStr(url).trim();
    if (raw.lastIndexOf("dm|", 0) !== 0) return null;
    var id = raw.substring(3);
    return id ? { id: id } : null;
  }
  function thumbOf(v) {
    return safeStr(v.thumbnail_480_url) || safeStr(v.thumbnail_360_url) || "";
  }
  function toItem(v) {
    try {
      if (!v || !v.id) return null;
      var descParts = [];
      var dur = fmtDur(v.duration);
      if (dur) descParts.push("Duration: " + dur);
      var views = fmtViews(v.views_total);
      if (views) descParts.push(views);
      var ch = safeStr(v.owner && v.owner.screenname);
      if (ch) descParts.push("Channel: " + ch);
      return clean({
        title: safeStr(v.title) || "Video",
        url: makeRef(v.id),
        posterUrl: thumbOf(v),
        type: "movie",
        description: descParts.join(" • "),
        year: v.created_time
          ? new Date(safeInt(v.created_time, 0) * 1000).getFullYear()
          : undefined,
      });
    } catch (e) {
      return null;
    }
  }
  async function listVideos(qs) {
    var u =
      API +
      "/videos?" +
      qs +
      "&limit=" +
      CFG.LIST_LIMIT +
      "&fields=" +
      encodeURIComponent(FIELDS);
    var d = await fetchJson(u, CFG.TIMEOUT_MS, 2);
    return d && Array.isArray(d.list) ? d.list : [];
  }
  async function getHome(cb, page) {
    var pn = Math.max(1, safeInt(page, 1));
    var jobs = [];
    var names = [];
    function push(name, qs) {
      jobs.push(listVideos(qs + (pn > 1 ? "&page=" + pn : "")));
      names.push(name);
    }
    push("Trending", "sort=trending");
    push("Recent", "sort=recent");
    CHANNELS.forEach(function (c) {
      push(c[1], "channel=" + c[0] + "&sort=trending");
    });
    var res = await settle(jobs);
    var home = {},
      order = [];
    for (var i = 0; i < res.length; i++) {
      var r = res[i];
      if (!r.ok || !Array.isArray(r.value)) continue;
      var items = [];
      for (var j = 0; j < r.value.length; j++) {
        var it = toItem(r.value[j]);
        if (it) items.push(it);
      }
      if (!items.length) continue;
      home[names[i]] = items;
      order.push(names[i]);
    }
    if (!order.length)
      return {
        success: false,
        errorCode: "NO_DATA",
        message: "Dailymotion unreachable",
      };
    var ordered = {};
    order.forEach(function (k) {
      ordered[k] = home[k];
    });
    return { success: true, data: ordered };
  }
  async function search(q, cb) {
    var query = safeStr(q).trim();
    if (!query) return { success: true, data: [] };
    var list = await listVideos(
      "search=" + encodeURIComponent(query) + "&sort=relevance",
    );
    var items = [];
    for (var i = 0; i < list.length && items.length < CFG.MAX_SEARCH; i++) {
      var it = toItem(list[i]);
      if (it) items.push(it);
    }
    return { success: true, data: items };
  }
  async function load(url, cb) {
    var ref = parseId(url);
    if (!ref) return fallbackDetail(url);
    var v = await fetchJson(
      API +
        "/video/" +
        encodeURIComponent(ref.id) +
        "?fields=" +
        encodeURIComponent(FIELDS + ",description,owner.url"),
      CFG.TIMEOUT_MS,
      2,
    );
    if (!v || !v.id)
      v = await fetchJson(
        API +
          "/video/" +
          encodeURIComponent(ref.id) +
          "?fields=id,title,thumbnail_480_url,duration,owner.screenname",
        CFG.TIMEOUT_MS,
        2,
      );
    if (!v || !v.id) return fallbackDetail(url);
    var descParts = [];
    var dur = fmtDur(v.duration);
    if (dur) descParts.push("Duration: " + dur);
    var views = fmtViews(v.views_total);
    if (views) descParts.push(views);
    var ch = safeStr(v.owner && v.owner.screenname);
    if (ch) descParts.push("Channel: " + ch);
    var body = stripHtml(v.description || "");
    var desc =
      descParts.join(" • ") + (body ? "\n\n" + body.substring(0, 900) : "");
    var episodes = [
      clean({
        name: "▶ Play",
        url: makeRef(v.id),
        season: 1,
        episode: 1,
        posterUrl: thumbOf(v),
      }),
    ];
    var seen = {};
    seen[safeStr(v.id)] = 1;
    var rel = await fetchJson(
      API +
        "/video/" +
        encodeURIComponent(v.id) +
        "/related?limit=" +
        CFG.MAX_UPNEXT +
        "&fields=" +
        encodeURIComponent(FIELDS),
      CFG.TIMEOUT_MS,
      1,
    );
    var relList = rel && Array.isArray(rel.list) ? rel.list : [];
    if (relList.length < 10 && v.owner && v.owner.id) {
      var own = await fetchJson(
        API +
          "/user/" +
          encodeURIComponent(v.owner.id) +
          "/videos?limit=" +
          CFG.MAX_UPNEXT +
          "&fields=" +
          encodeURIComponent(FIELDS),
        CFG.TIMEOUT_MS,
        1,
      );
      var ownList = own && Array.isArray(own.list) ? own.list : [];
      ownList.forEach(function (x) {
        relList.push(x);
      });
    }
    for (
      var i = 0;
      i < relList.length && episodes.length < CFG.MAX_UPNEXT;
      i++
    ) {
      var rv = relList[i];
      if (!rv || !rv.id || seen[safeStr(rv.id)]) continue;
      seen[safeStr(rv.id)] = 1;
      var ep = toItem(rv);
      if (ep) {
        ep.name = safeStr(rv.title) || "Up Next";
        ep.season = 1;
        ep.episode = episodes.length + 1;
        ep.description = safeStr(rv.owner && rv.owner.screenname);
        episodes.push(ep);
      }
    }
    return {
      success: true,
      data: clean({
        title: safeStr(v.title) || "Video",
        url: makeRef(v.id),
        posterUrl: thumbOf(v),
        bannerUrl: thumbOf(v),
        type: "movie",
        description: desc,
        episodes: episodes,
      }),
    };
  }
  function fallbackDetail(rawUrl) {
    var ref = parseId(rawUrl);
    return {
      success: true,
      data: clean({
        title: ref ? "Dailymotion • " + ref.id : "Video",
        url: safeStr(rawUrl),
        posterUrl: "",
        type: "movie",
        episodes: [
          clean({
            name: "▶ Play",
            url: safeStr(rawUrl),
            season: 1,
            episode: 1,
          }),
        ],
      }),
    };
  }
  async function loadStreams(url, cb) {
    var ref = parseId(url);
    if (!ref) return { success: true, data: [] };
    var metaUrl =
      META +
      encodeURIComponent(ref.id) +
      "?embedder=" +
      encodeURIComponent("https://www.dailymotion.com/us");
    var meta = await withDeadline(
      fetchJson(metaUrl, CFG.TIMEOUT_MS, 1),
      CFG.TIMEOUT_MS + 2000,
      function () {
        return null;
      },
    );
    if (!meta) return { success: true, data: [] };
    if (meta.error) {
      console.log(
        "[Dailymotion] " +
          ref.id +
          " error: " +
          safeStr(meta.error.code || meta.error.title),
      );
      return { success: true, data: [] };
    }
    var q = meta.qualities || {};
    var m3u8 = null;
    var auto = q.auto || q["1080"] || q["720"] || q["480"] || q["380"];
    if (Array.isArray(auto)) {
      for (var i = 0; i < auto.length; i++) {
        if (auto[i] && /mpegURL/i.test(safeStr(auto[i].type)) && auto[i].url) {
          m3u8 = auto[i].url;
          break;
        }
      }
    }
    if (!m3u8) {
      for (var k in q) {
        if (!Object.prototype.hasOwnProperty.call(q, k)) continue;
        var arr = q[k];
        if (!Array.isArray(arr)) continue;
        for (var j = 0; j < arr.length; j++) {
          if (arr[j] && arr[j].url && /mpegURL/i.test(safeStr(arr[j].type))) {
            m3u8 = arr[j].url;
            break;
          }
        }
        if (m3u8) break;
      }
    }
    if (!m3u8) return { success: true, data: [] };
    var owner =
      meta.owner && meta.owner.screenname
        ? meta.owner.screenname
        : "Dailymotion";
    var dur = fmtDur(meta.duration);
    var src = "Dailymotion" + (dur ? " • " + dur : "") + " • " + owner;
    var subs = [];
    var st = meta.subtitles;
    var stList =
      st && Array.isArray(st.data) ? st.data : Array.isArray(st) ? st : [];
    for (var si = 0; si < stList.length && subs.length < 12; si++) {
      var s = stList[si];
      if (!s || !isHttpStr(s.url)) continue;
      subs.push({
        url: s.url,
        label: safeStr(s.label) || safeStr(s.language) || "Subtitle",
        lang: safeStr(s.language) || "en",
      });
    }
    var out = [
      clean({
        url: m3u8,
        source: src,
        quality: "Auto",
        headers: STREAM_HEADERS,
        subtitles: subs.length ? subs : undefined,
      }),
    ];
    console.log(
      "[Dailymotion] " +
        ref.id +
        ": 1 stream" +
        (subs.length ? ", " + subs.length + " subs" : ""),
    );
    return { success: true, data: out };
  }
  function isHttpStr(s) {
    s = safeStr(s);
    return s.indexOf("http://") === 0 || s.indexOf("https://") === 0;
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
            console.warn(
              "[Dailymotion] failed: " + (e && e.message ? e.message : e),
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
    return fallbackDetail(u);
  });
  g.loadStreams = guarded(loadStreams, function () {
    return { success: true, data: [] };
  });
})();
