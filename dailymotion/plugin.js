(function () {
  "use strict";
  var g = typeof globalThis !== "undefined" ? globalThis : this;
  var UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  var API = "https://api.dailymotion.com";
  var META = "https://www.dailymotion.com/player/metadata/video/";
  var EMBEDDER = encodeURIComponent("https://www.dailymotion.com/us");
  var CFG = {
    TIMEOUT_MS: 12000,
    RETRIES: 2,
    GUARD_BUDGET_MS: 75000,
    BATCH_DEADLINE_MS: 22000,
    LIST_LIMIT: 30,
    SEARCH_PAGES: 3,
    MAX_SEARCH: 90,
    MAX_UPNEXT: 30,
    MAX_SUBS: 20,
  };
  var FIELDS =
    "id,title,duration,thumbnail_480_url,thumbnail_360_url,views_total,created_time,owner.screenname,owner.id";
  var API_HEADERS = { "User-Agent": UA, Accept: "application/json" };
  var PAGE_HEADERS = {
    "User-Agent": UA,
    Accept: "application/json,text/plain,*/*",
    Referer: "https://www.dailymotion.com/",
  };
  var STREAM_HEADERS = {
    "User-Agent": UA,
    Referer: "https://www.dailymotion.com/",
    Origin: "https://www.dailymotion.com",
    Accept: "*/*",
  };
  var HOME_ROWS = [
    { name: "Trending", kind: "videos", qs: "sort=trending" },
    { name: "New Releases", kind: "videos", qs: "sort=recent" },
    {
      name: "Movies",
      kind: "videos",
      qs: "search=full movie&sort=trending",
    },
    {
      name: "Bollywood Movies",
      kind: "videos",
      qs: "search=hindi full movie&sort=trending",
    },
    {
      name: "Hollywood Movies",
      kind: "videos",
      qs: "search=english full movie hd&sort=trending",
    },
    { name: "TV Series", kind: "videos", qs: "channel=tv&sort=trending" },
    { name: "K-Drama Hindi Dubbed", kind: "user", id: "x2mvsoe" },
    { name: "Drama Series", kind: "user", id: "x1tk6u3" },
    { name: "Pakistani Dramas", kind: "user", id: "x2w7377" },
    { name: "Turkish Series", kind: "user", id: "x2fxr8x" },
    {
      name: "Short Drama",
      kind: "videos",
      qs: "search=short drama full episode&sort=trending",
    },
    {
      name: "Anime",
      kind: "videos",
      qs: "search=anime episode english dub&sort=trending",
    },
    { name: "Music", kind: "videos", qs: "channel=music&sort=trending" },
    {
      name: "Trailers",
      kind: "videos",
      qs: "search=official trailer 2026&sort=trending",
    },
    { name: "Comedy", kind: "videos", qs: "channel=fun&sort=trending" },
    { name: "Kids", kind: "videos", qs: "channel=kids&sort=trending" },
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
  function hasBridge(name) {
    try {
      return typeof g[name] === "function";
    } catch (e) {
      return false;
    }
  }
  function rawGet(url, headers, timeoutMs) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, timeoutMs);
      Promise.resolve()
        .then(function () {
          return http_get(url, headers || {});
        })
        .then(
          function (r) {
            if (!done) {
              done = true;
              clearTimeout(t);
              resolve(r || null);
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
  }
  function pickBody(resp) {
    if (!resp) return null;
    var s = safeInt(resp.status || resp.statusCode || resp.code, 0);
    if (s !== 200 && s !== 206 && s !== 304) return null;
    var b = typeof resp.body === "string" ? resp.body.trim() : "";
    if (!b) return null;
    return b;
  }
  function httpJson(url, timeoutMs) {
    var hdrs =
      url.indexOf("api.dailymotion.com") !== -1 ? API_HEADERS : PAGE_HEADERS;
    return rawGet(url, hdrs, timeoutMs).then(function (resp) {
      var b = pickBody(resp);
      if (!b || b.charAt(0) === "<") return null;
      return safeJson(b, null);
    });
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
  async function parallelJson(jobs, deadlineMs) {
    if (!jobs.length) return [];
    var reqs = jobs.map(function (j) {
      return { url: j.url, headers: j.headers || API_HEADERS };
    });
    var results = null;
    if (hasBridge("http_parallel")) {
      try {
        results = await withDeadline(
          Promise.resolve(http_parallel(reqs)),
          deadlineMs,
          function () {
            return null;
          },
        );
      } catch (e) {
        results = null;
      }
    }
    if (!Array.isArray(results)) {
      var settled = await settle(
        reqs.map(function (r) {
          return rawGet(r.url, r.headers, deadlineMs);
        }),
      );
      return settled.map(function (s) {
        var b = s.ok ? pickBody(s.value) : null;
        if (!b || b.charAt(0) === "<") return null;
        return safeJson(b, null);
      });
    }
    return jobs.map(function (j, i) {
      var b = pickBody(results[i]);
      if (!b || b.charAt(0) === "<") return null;
      return safeJson(b, null);
    });
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
    if (raw.lastIndexOf("dm|", 0) === 0) {
      var ref = raw.substring(3);
      return ref ? { id: ref } : null;
    }
    return null;
  }
  function extractVideoId(input) {
    var raw = safeStr(input).trim();
    if (!raw) return null;
    var patterns = [
      /dailymotion\.com\/(?:video|embed\/video)\/([A-Za-z0-9]+)/i,
      /dai\.ly\/([A-Za-z0-9]+)/i,
      /dailymotion\.com\/video\/([A-Za-z0-9]+)_/i,
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = raw.match(patterns[i]);
      if (m && m[1]) return m[1];
    }
    if (/^x[A-Za-z0-9]{4,}$/.test(raw)) return raw;
    return null;
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
        duration: Math.max(1, Math.round(safeInt(v.duration, 0) / 60)),
        description: descParts.join(" • "),
        year: v.created_time
          ? new Date(safeInt(v.created_time, 0) * 1000).getFullYear()
          : undefined,
      });
    } catch (e) {
      return null;
    }
  }
  function apiUrl(path, qs) {
    var query = qs ? qs.replace(/^&+/, "") : "";
    return (
      API +
      path +
      "?" +
      (query ? query + "&" : "") +
      "limit=" +
      CFG.LIST_LIMIT +
      "&fields=" +
      encodeURIComponent(FIELDS)
    );
  }
  async function listVideos(qs) {
    var d = await fetchJson(apiUrl("/videos", qs), CFG.TIMEOUT_MS, CFG.RETRIES);
    return d && Array.isArray(d.list) ? d.list : [];
  }
  function metaUrl(id) {
    return META + encodeURIComponent(id) + "?embedder=" + EMBEDDER;
  }
  function attrValue(line, name) {
    var m = line.match(new RegExp(name + '="([^"]*)"', "i"));
    return m ? m[1] : "";
  }
  function absoluteUrl(uri, base) {
    var u = safeStr(uri).split("#")[0].trim();
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    if (u.charAt(0) === "/") {
      var root = safeStr(base).match(/^(https?:\/\/[^\/]+)/i);
      return root ? root[1] + u : "";
    }
    return safeStr(base).replace(/[^\/]*$/, "") + u;
  }
  function parseVariants(m3u8Text, baseUrl) {
    var lines = safeStr(m3u8Text).split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      if (!/^#EXT-X-STREAM-INF/i.test(lines[i])) continue;
      var info = lines[i];
      var uri = "";
      for (var j = i + 1; j < lines.length; j++) {
        var nx = lines[j].trim();
        if (!nx || nx.charAt(0) === "#") continue;
        uri = nx;
        i = j;
        break;
      }
      if (!uri) continue;
      var name = attrValue(info, "NAME");
      var res = attrValue(info, "RESOLUTION");
      var bw = safeInt(attrValue(info, "BANDWIDTH"), 0);
      var height = res ? safeInt(res.split("x")[1], 0) : 0;
      if (!height && /^\d+$/.test(name)) height = safeInt(name, 0);
      var label = height
        ? height + "p"
        : bw
          ? Math.round(bw / 1000) + "kbps"
          : name
            ? name
            : "stream";
      var abs = absoluteUrl(uri.split("#")[0], baseUrl);
      if (!abs) continue;
      out.push({ label: label, height: height, bandwidth: bw, url: abs });
    }
    out.sort(function (a, b) {
      return b.height - a.height || b.bandwidth - a.bandwidth;
    });
    return out;
  }
  function collectSubtitles(meta) {
    var subs = [];
    var st = meta && meta.subtitles;
    if (!st) return subs;
    var data = st.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (var key in data) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
        var e = data[key];
        if (!e) continue;
        var url =
          (Array.isArray(e.urls) && e.urls[0]) ||
          safeStr(e.url) ||
          safeStr(e.srt) ||
          safeStr(e.vtt);
        if (!isHttpStr(url)) continue;
        var lang = safeStr(e.language) || safeStr(key).split("-")[0] || "en";
        subs.push({
          url: url,
          label: safeStr(e.label) || lang.toUpperCase(),
          lang: lang,
        });
      }
    } else if (Array.isArray(data)) {
      for (var i = 0; i < data.length; i++) {
        var s = data[i];
        if (!s) continue;
        var u =
          (Array.isArray(s.urls) && s.urls[0]) ||
          safeStr(s.url) ||
          safeStr(s.srt) ||
          safeStr(s.vtt);
        if (!isHttpStr(u)) continue;
        var lg = safeStr(s.language) || "en";
        subs.push({
          url: u,
          label: safeStr(s.label) || lg.toUpperCase(),
          lang: lg,
        });
      }
    }
    return subs.slice(0, CFG.MAX_SUBS);
  }
  function isHttpStr(s) {
    s = safeStr(s);
    return s.indexOf("http://") === 0 || s.indexOf("https://") === 0;
  }
  function explicitQualities(meta, seenHeights) {
    var q = meta && meta.qualities;
    var out = [];
    if (!q || typeof q !== "object") return out;
    var keys = Object.keys(q)
      .filter(function (k) {
        return k !== "auto" && /^\d{3,4}$/.test(k);
      })
      .sort(function (a, b) {
        return safeInt(b, 0) - safeInt(a, 0);
      });
    for (var i = 0; i < keys.length; i++) {
      var h = safeInt(keys[i], 0);
      if (seenHeights[h]) continue;
      var arr = q[keys[i]];
      if (!Array.isArray(arr)) continue;
      var mp4 = null;
      var hls = null;
      for (var j = 0; j < arr.length; j++) {
        var e = arr[j];
        if (!e || !isHttpStr(e.url)) continue;
        if (/mp4/i.test(safeStr(e.type)) && !mp4) mp4 = e.url;
        if (/mpegURL/i.test(safeStr(e.type)) && !hls) hls = e.url;
      }
      var u = mp4 || hls;
      if (u) out.push({ label: h + "p", height: h, url: u });
    }
    return out;
  }
  function firstMasterUrl(meta) {
    var q = meta && meta.qualities;
    if (!q || typeof q !== "object") return null;
    var preferred = ["auto"];
    var keys = Object.keys(q);
    for (var p = 0; p < preferred.length; p++) {
      var arr = q[preferred[p]];
      if (Array.isArray(arr)) {
        for (var i = 0; i < arr.length; i++) {
          if (
            arr[i] &&
            isHttpStr(arr[i].url) &&
            /mpegURL/i.test(safeStr(arr[i].type))
          )
            return arr[i].url;
        }
      }
    }
    for (var k = 0; k < keys.length; k++) {
      var list = q[keys[k]];
      if (!Array.isArray(list)) continue;
      for (var n = 0; n < list.length; n++) {
        if (list[n] && isHttpStr(list[n].url)) return safeStr(list[n].url);
      }
    }
    return null;
  }
  async function getHome(cb, page) {
    var pn = Math.max(1, safeInt(page, 1));
    var pageSuffix = pn > 1 ? "&page=" + pn : "";
    var jobs = HOME_ROWS.map(function (row) {
      if (row.kind === "user")
        return {
          key: row.name,
          url: apiUrl(
            "/user/" + row.id + "/videos",
            "sort=recent" + pageSuffix,
          ),
        };
      return { key: row.name, url: apiUrl("/videos", row.qs + pageSuffix) };
    });
    var responses = await parallelJson(jobs, CFG.BATCH_DEADLINE_MS);
    var home = {};
    var order = [];
    for (var i = 0; i < jobs.length; i++) {
      var d = responses[i];
      if (!d || !Array.isArray(d.list)) continue;
      var items = [];
      for (var j = 0; j < d.list.length; j++) {
        var it = toItem(d.list[j]);
        if (it) items.push(it);
      }
      if (!items.length) continue;
      home[jobs[i].key] = items;
      order.push(jobs[i].key);
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
    console.log(
      "[Dailymotion] home: " +
        order.length +
        "/" +
        jobs.length +
        " rows" +
        (pn > 1 ? " page " + pn : ""),
    );
    return { success: true, data: ordered };
  }
  async function exactVideoSearch(id) {
    var v = await fetchJson(
      API +
        "/video/" +
        encodeURIComponent(id) +
        "?fields=" +
        encodeURIComponent(FIELDS),
      CFG.TIMEOUT_MS,
      CFG.RETRIES,
    );
    if (!v || !v.id) return null;
    var items = [];
    var main = toItem(v);
    if (main) {
      main.title = "▶ " + main.title;
      items.push(main);
    }
    if (v.owner && v.owner.id) {
      var own = await fetchJson(
        apiUrl(
          "/user/" + encodeURIComponent(v.owner.id) + "/videos",
          "sort=recent",
        ),
        CFG.TIMEOUT_MS,
        1,
      );
      var list = own && Array.isArray(own.list) ? own.list : [];
      for (var i = 0; i < list.length && items.length < 25; i++) {
        var it = toItem(list[i]);
        if (it && safeStr(it.url) !== makeRef(id)) items.push(it);
      }
    }
    return items;
  }
  async function search(q, cb) {
    var query = safeStr(q).trim();
    if (!query) return { success: true, data: [] };
    var vid = extractVideoId(query);
    if (vid) {
      var exact = await exactVideoSearch(vid);
      if (exact && exact.length) return { success: true, data: exact };
      console.log("[Dailymotion] exact lookup failed for " + vid);
    }
    var pages = [];
    for (var p = 1; p <= CFG.SEARCH_PAGES; p++)
      pages.push({
        key: "p" + p,
        url: apiUrl(
          "/videos",
          "search=" +
            encodeURIComponent(query) +
            "&sort=relevance" +
            (p > 1 ? "&page=" + p : ""),
        ),
      });
    var responses = await parallelJson(pages, CFG.BATCH_DEADLINE_MS);
    var items = [];
    for (var i = 0; i < responses.length; i++) {
      var d = responses[i];
      if (!d || !Array.isArray(d.list)) continue;
      for (var j = 0; j < d.list.length && items.length < CFG.MAX_SEARCH; j++) {
        var it = toItem(d.list[j]);
        if (it) items.push(it);
      }
    }
    console.log(
      "[Dailymotion] search '" +
        query +
        "': " +
        items.length +
        " results (no dedupe)",
    );
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
      CFG.RETRIES,
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
    var jobs = [
      {
        key: "related",
        url: apiUrl("/video/" + encodeURIComponent(v.id) + "/related", ""),
      },
    ];
    if (v.owner && v.owner.id)
      jobs.push({
        key: "owner",
        url: apiUrl(
          "/user/" + encodeURIComponent(v.owner.id) + "/videos",
          "sort=recent",
        ),
      });
    var responses = await parallelJson(jobs, CFG.BATCH_DEADLINE_MS);
    var relList = [];
    responses.forEach(function (d) {
      if (d && Array.isArray(d.list))
        d.list.forEach(function (x) {
          relList.push(x);
        });
    });
    var seen = {};
    seen[safeStr(v.id)] = 1;
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
        duration: Math.max(1, Math.round(safeInt(v.duration, 0) / 60)),
        year: v.created_time
          ? new Date(safeInt(v.created_time, 0) * 1000).getFullYear()
          : undefined,
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
  function cookieFrom(resp) {
    if (!resp || !resp.headers) return "";
    var h = resp.headers;
    var raw = h["set-cookie"] || h["Set-Cookie"] || "";
    var arr = Array.isArray(raw) ? raw : [safeStr(raw)];
    var pairs = [];
    arr.forEach(function (c) {
      var pair = safeStr(c).split(";")[0].trim();
      if (pair.indexOf("=") > 0 && !pairs.some((p) => p === pair))
        pairs.push(pair);
    });
    return pairs.join("; ");
  }
  async function loadStreams(url, cb) {
    var ref = parseId(url);
    if (!ref) return { success: true, data: [] };
    var metaResp = await rawGet(metaUrl(ref.id), PAGE_HEADERS, CFG.TIMEOUT_MS);
    var meta = safeJson(pickBody(metaResp), null);
    if (!meta && metaResp) {
      await delay(400);
      metaResp = await rawGet(metaUrl(ref.id), PAGE_HEADERS, CFG.TIMEOUT_MS);
      meta = safeJson(pickBody(metaResp), null);
    }
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
    var subs = collectSubtitles(meta);
    var owner =
      meta.owner && meta.owner.screenname
        ? meta.owner.screenname
        : "Dailymotion";
    var dur = fmtDur(meta.duration);
    var masterUrl = firstMasterUrl(meta);
    var cookie = cookieFrom(metaResp);
    var variants = [];
    if (masterUrl) {
      var hdrs = cookie
        ? Object.assign({}, STREAM_HEADERS, { Cookie: cookie })
        : STREAM_HEADERS;
      var resp = await rawGet(masterUrl, hdrs, CFG.TIMEOUT_MS);
      var text = resp ? pickBody(resp) : null;
      if ((!text || !/#EXT-X-STREAM-INF/i.test(text)) && cookie) {
        resp = await rawGet(masterUrl, STREAM_HEADERS, CFG.TIMEOUT_MS);
        text = resp ? pickBody(resp) : null;
      }
      if (text && /#EXT-X-STREAM-INF/i.test(text))
        variants = parseVariants(text, masterUrl);
    }
    var seenHeights = {};
    variants.forEach(function (v) {
      seenHeights[v.height] = true;
    });
    var explicit = explicitQualities(meta, seenHeights);
    var streamHdrs = cookie
      ? Object.assign({}, STREAM_HEADERS, { Cookie: cookie })
      : STREAM_HEADERS;
    var streams = [];
    var autoUrl = masterUrl || (explicit[0] && explicit[0].url) || "";
    if (autoUrl) {
      streams.push(
        clean({
          url: autoUrl,
          source:
            "Dailymotion • Auto" + (dur ? " • " + dur : "") + " • " + owner,
          quality: "Auto",
          headers: streamHdrs,
          subtitles: subs.length ? subs.slice() : undefined,
        }),
      );
      if (typeof g.MAGIC_PROXY_v1 !== "undefined" && isHttpStr(autoUrl)) {
        try {
          streams.push(
            clean({
              url: g.MAGIC_PROXY_v1 + btoa(autoUrl),
              source: "Dailymotion • Auto • Proxy • " + owner,
              quality: "Auto",
              headers: streamHdrs,
              subtitles: subs.length ? subs.slice() : undefined,
            }),
          );
        } catch (e) {}
      }
    }
    var qualityStreams = variants.length ? variants : explicit;
    if (
      !qualityStreams.length &&
      masterUrl &&
      meta.stream_formats &&
      typeof meta.stream_formats === "object"
    ) {
      var fmtKeys = Object.keys(meta.stream_formats);
      fmtKeys.sort(function (a, b) {
        return safeInt(b, 0) - safeInt(a, 0);
      });
      for (var fk = 0; fk < fmtKeys.length; fk++) {
        var k = fmtKeys[fk];
        if (!/^\d{3,4}$/.test(k)) continue;
        var h = safeInt(k, 0);
        if (seenHeights[h]) continue;
        qualityStreams.push({ label: h + "p", height: h, url: masterUrl });
      }
    }
    for (var i = 0; i < qualityStreams.length; i++) {
      var qs = qualityStreams[i];
      if (!qs || !isHttpStr(qs.url)) continue;
      streams.push(
        clean({
          url: qs.url,
          source: "Dailymotion • " + qs.label + " • " + owner,
          quality: qs.label,
          headers: streamHdrs,
          subtitles: subs.length ? subs.slice() : undefined,
        }),
      );
    }
    console.log(
      "[Dailymotion] " +
        ref.id +
        ": " +
        streams.length +
        " streams (" +
        qualityStreams
          .map(function (s) {
            return s.label;
          })
          .join(",") +
        ")" +
        (subs.length ? ", " + subs.length + " subs" : ""),
    );
    return {
      success: true,
      data: streams.filter(function (s) {
        return !!s.url;
      }),
    };
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
