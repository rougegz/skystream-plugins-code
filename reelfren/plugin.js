(function () {
  "use strict";

  // ReelFren plugin: short dramas from multiple providers via the
  // api.dramafren.org API. Each provider entry in plugin.json becomes its
  // own instance; manifest.providerId tells us which one is running.
  var API =
    (typeof manifest !== "undefined" && manifest && manifest.baseUrl) ||
    "https://api.dramafren.org";
  var DEFAULT_PROVIDER = "melolo";

  function providerId() {
    var id = String(
      (typeof manifest !== "undefined" && manifest && manifest.providerId) ||
        "",
    ).toLowerCase();
    return id || DEFAULT_PROVIDER;
  }

  function payload(o) {
    return JSON.stringify(o);
  }

  function parsePayload(url) {
    try {
      return JSON.parse(String(url || ""));
    } catch (e) {
      return { id: String(url || "") };
    }
  }

  // Resolve relative stream URLs (e.g. /api/proxy/happyshort?url=...) against the API base.
  function abs(url) {
    url = String(url || "");
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    return API + (url.charAt(0) === "/" ? "" : "/") + url;
  }

  // Rotate realistic user agents per request to avoid spam detection
  // (the site's own requests come from real browsers).
  var USER_AGENTS = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  ];
  var UA_ROTATE = 0;

  function nextUA() {
    return USER_AGENTS[UA_ROTATE++ % USER_AGENTS.length];
  }

  function sleep(ms) {
    if (typeof setTimeout !== "function") return Promise.resolve();
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  function withTimeout(promise, ms) {
    if (typeof setTimeout !== "function") return promise;
    return Promise.race([
      promise,
      new Promise(function (r) {
        setTimeout(function () {
          r(null);
        }, ms);
      }),
    ]);
  }

  async function apiGet(path) {
    var res = await http_get(API + path, {
      Accept: "application/json",
      "User-Agent": nextUA(),
    });
    var body = String((res && (res.body || res.text)) || "");
    try {
      return JSON.parse(body);
    } catch (e) {
      return null;
    }
  }

  function buildItem(d) {
    return new MultimediaItem({
      title: d.title || "",
      url: payload({
        providerId: d.provider,
        id: String(d.id),
        title: d.title || "",
      }),
      posterUrl: d.cover || "",
      type: "series",
      description: d.intro || "",
      status: "completed",
    });
  }

  // Auto-generated home section names, reused cyclically when the feed is long.
  var SECTION_NAMES = [
    "Hot",
    "New Releases",
    "Popular Now",
    "Must Watch",
    "Fresh Picks",
    "Recently Added",
    "Top Picks",
    "Handpicked",
    "Binge Worthy",
    "Hidden Gems",
    "Fan Favorites",
    "New Arrivals",
    "Most Watched",
    "Rising Stars",
    "Staff Picks",
    "Crowd Pleasers",
    "Weekend Binge",
    "Late Night Picks",
    "All Time Favorites",
    "Editors' Choice",
  ];
  var ROW_SIZE = 24; // posters per home row
  var TRENDING_SIZE = 10; // hero carousel

  function chunk(items, size) {
    var out = [];
    for (var i = 0; i < items.length; i += size)
      out.push(items.slice(i, i + size));
    return out;
  }

  function sectionName(i) {
    var name = SECTION_NAMES[i % SECTION_NAMES.length];
    return i < SECTION_NAMES.length
      ? name
      : name + " " + (Math.floor(i / SECTION_NAMES.length) + 1);
  }

  // Per-provider home tabs, mirroring the site's own tab config:
  //  - the site's client defines two home tabs: bstation->anime and
  //    wetv->10240 (both merged into the site's "Anime" tab);
  //  - the explore-page tabs are server-rendered (Cloudflare-gated), so the
  //    known ones come from the site UI (storyreel, freereels);
  //  - other providers get the universal short-drama tabs.
  // Every tab is verified against the API: a tab that returns an empty feed
  // or the same id-set as another tab (API ignoring the param) is dropped.
  var PROVIDER_TABS = {
    bstation: [{ slug: "anime", name: "Anime" }],
    wetv: [{ slug: "10240", name: "Anime" }],
    storyreel: [
      { slug: "popular", name: "Popular" },
      { slug: "new", name: "New" },
      { slug: "originals", name: "Originals" },
      { slug: "vip", name: "VIP" },
      { slug: "werewolf", name: "Werewolf" },
      { slug: "romance", name: "Romance" },
      { slug: "fantasy", name: "Fantasy" },
    ],
    freereels: [
      { slug: "new", name: "New" },
      { slug: "popular", name: "Popular" },
    ],
  };
  var DEFAULT_TABS = [
    { slug: "popular", name: "Popular" },
    { slug: "new", name: "New" },
  ];
  var MAX_CATEGORIES = 8; // home rows from real categories
  var CATEGORY_PAGES = 2; // extra pages fetched per category row (more cards)

  function parseBody(res) {
    if (!res) return null;
    try {
      return JSON.parse(String(res.body || res.text || ""));
    } catch (e) {
      return null;
    }
  }

  async function httpParallel(urls) {
    var reqs = urls.map(function (u) {
      return {
        method: "GET",
        url: u,
        headers: { Accept: "application/json", "User-Agent": nextUA() },
      };
    });
    if (typeof http_parallel === "function") {
      try {
        var responses = await http_parallel(reqs);
        if (responses && responses.length) return responses;
      } catch (e) {
        /* fall through to sequential */
      }
    }
    return await Promise.all(
      reqs.map(function (r) {
        return http_get(r.url, r.headers).catch(function () {
          return null;
        });
      }),
    );
  }

  // Home feed pagination: offset is a page number (+1 each step). Pages are
  // fetched in parallel batches (the site scrolls sequentially, but a one-shot
  // home needs them all at once), deduped, stopping on empty/duplicate pages.
  var MAX_PAGES = 20;
  var PAGE_BATCH = 4;
  async function paginateFeed(pid) {
    var seen = {};
    var out = [];
    var dupRun = 0;
    for (var start = 0; start < MAX_PAGES; start += PAGE_BATCH) {
      var urls = [];
      for (var pg = start; pg < Math.min(start + PAGE_BATCH, MAX_PAGES); pg++) {
        urls.push(
          API +
            "/api/home?offset=" +
            pg +
            "&provider=" +
            encodeURIComponent(pid),
        );
      }
      var resps = (await withTimeout(httpParallel(urls), 15000)) || [];
      var added = 0;
      resps.forEach(function (resp) {
        var raw = ((resp && parseBody(resp)) || {}).data || [];
        raw.forEach(function (d) {
          if (d && d.id && !seen[d.id]) {
            seen[d.id] = true;
            out.push(d);
            added++;
          }
        });
      });
      if (!added) {
        if (++dupRun >= 2) break; // two empty batches -> end of feed
      } else {
        dupRun = 0;
      }
      await sleep(120);
    }
    return out;
  }

  // 1. getHome: dashboard rows for the selected provider: a Trending hero,
  // the provider's real category rows (paginated so each row is full), then
  // the rest of the full paginated feed split into auto-named rows. Results
  // are cached per provider so repeated opens are instant.
  var HOME_CACHE = {};
  var HOME_CACHE_TTL = 5 * 60 * 1000;

  async function getHome(cb) {
    var pid = providerId();
    var cached = HOME_CACHE[pid];
    if (cached && Date.now() - cached.t < HOME_CACHE_TTL) {
      return cb({ success: true, data: cached.data });
    }
    var tabs = (PROVIDER_TABS[pid] || DEFAULT_TABS).slice(0, MAX_CATEGORIES);
    var catUrls = tabs.map(function (t) {
      return (
        API +
        "/api/home?offset=0&provider=" +
        encodeURIComponent(pid) +
        "&category=" +
        encodeURIComponent(t.slug)
      );
    });
    var task = Promise.all([
      paginateFeed(pid),
      withTimeout(httpParallel(catUrls), 15000),
    ]);
    var allRaw = [];
    var resps = [];
    try {
      var both = await task;
      allRaw = both[0] || [];
      resps = both[1] || [];
    } catch (e) {
      allRaw = [];
      resps = [];
    }
    var seen = {};
    function mark(list) {
      list.forEach(function (d) {
        seen[d.id] = true;
      });
    }
    var data = {};
    if (allRaw.length) {
      data["Trending"] = allRaw.slice(0, TRENDING_SIZE).map(buildItem);
      mark(allRaw.slice(0, TRENDING_SIZE));
    }
    // Verify tabs: drop empty ones and ones sharing an id-set signature
    // (the API ignoring the category param returns the same window).
    var page0 = {}; // slug -> raw items
    var tabGroups = {}; // signature -> { tabs, raw }
    tabs.forEach(function (t, i) {
      var raw = ((resps[i] && parseBody(resps[i])) || {}).data || [];
      if (!raw.length) return;
      page0[t.slug] = raw;
      var sig = raw
        .map(function (d) {
          return d.id;
        })
        .sort()
        .join(",");
      (tabGroups[sig] = tabGroups[sig] || { tabs: [], raw: raw }).tabs.push(t);
    });
    var real = [];
    Object.keys(tabGroups).forEach(function (sig) {
      var g = tabGroups[sig];
      if (g.tabs.length > 1) return;
      real.push(g.tabs[0]);
    });
    // Paginate the real tabs in parallel so each row has more cards.
    var extraUrls = [];
    real.forEach(function (t) {
      for (var pg = 1; pg <= CATEGORY_PAGES; pg++) {
        extraUrls.push(
          API +
            "/api/home?offset=" +
            pg +
            "&provider=" +
            encodeURIComponent(pid) +
            "&category=" +
            encodeURIComponent(t.slug),
        );
      }
    });
    var extraResps = extraUrls.length
      ? (await withTimeout(httpParallel(extraUrls), 15000)) || []
      : [];
    real.forEach(function (t, ri) {
      var row = [];
      var rowSeen = {};
      function pushRaw(raw) {
        raw.forEach(function (d) {
          if (d && d.id && !rowSeen[d.id]) {
            rowSeen[d.id] = true;
            row.push(d);
          }
        });
      }
      pushRaw(page0[t.slug] || []);
      for (var pg = 1; pg <= CATEGORY_PAGES; pg++) {
        var resp = extraResps[ri * CATEGORY_PAGES + (pg - 1)];
        pushRaw(((resp && parseBody(resp)) || {}).data || []);
      }
      if (row.length) {
        data[t.name] = row.slice(0, ROW_SIZE).map(buildItem);
        mark(row.slice(0, ROW_SIZE));
      }
    });
    var rest = allRaw.filter(function (d) {
      return !seen[d.id];
    });
    chunk(rest, ROW_SIZE).forEach(function (row, i) {
      data[sectionName(i)] = row.map(buildItem);
    });
    // Last resort: single plain feed call when pagination failed entirely.
    if (!Object.keys(data).length) {
      var fallback = parseBody(
        await http_get(
          API + "/api/home?offset=0&provider=" + encodeURIComponent(pid),
          { Accept: "application/json", "User-Agent": nextUA() },
        ),
      );
      var items = ((fallback && fallback.data) || []).map(buildItem);
      if (items.length) {
        data["Trending"] = items.slice(0, TRENDING_SIZE);
        chunk(items.slice(TRENDING_SIZE), ROW_SIZE).forEach(function (row, i) {
          data[sectionName(i)] = row;
        });
      }
    }
    HOME_CACHE[pid] = { t: Date.now(), data: data };
    cb({ success: true, data: data });
  }

  // 2. search: query the API, keep only the selected provider's results.
  async function search(query, cb) {
    var pid = providerId();
    var json = await apiGet("/api/search?q=" + encodeURIComponent(query));
    var items = ((json && json.data) || [])
      .filter(function (d) {
        return d.provider === pid;
      })
      .map(buildItem);
    cb({ success: true, data: items });
  }

  // 3. load: drama details + episode list.
  async function load(url, cb) {
    var p = parsePayload(url);
    var json = await apiGet(
      "/api/detail?id=" +
        encodeURIComponent(p.id) +
        "&provider=" +
        encodeURIComponent(p.providerId || providerId()),
    );
    if (!json || !json.id)
      return cb({
        success: false,
        errorCode: "NOT_FOUND",
        message: "Drama not found",
      });
    var item = buildItem(json);
    item.episodes = (json.videos || []).map(function (v) {
      return new Episode({
        name: "Episode " + v.episode,
        url: payload({
          providerId: json.provider,
          id: String(json.id),
          title: json.title,
          episode: v.episode,
          vid: String(v.vid),
        }),
        season: 1,
        episode: v.episode,
        runtime: v.duration || undefined,
      });
    });
    cb({ success: true, data: item });
  }

  // 4. loadStreams: playable links for one episode. The API exposes up to two
  // servers (server=1/2, like the site's watch page) plus per-server quality
  // lists and subtitles — all are passed through, deduped by URL.
  async function loadStreams(url, cb) {
    var p = parsePayload(url);
    var base =
      "/api/video?id=" +
      encodeURIComponent(p.id) +
      "&provider=" +
      encodeURIComponent(p.providerId || providerId()) +
      "&ep=" +
      encodeURIComponent(p.episode || 1);
    var resps =
      (await withTimeout(
        httpParallel([API + base, API + base + "&server=2"]),
        15000,
      )) || [];
    var streams = [];
    var seenUrls = {};
    var anyLocked = false;
    resps.forEach(function (resp, si) {
      var json = resp && parseBody(resp);
      if (!json || !json.videoUrl) return;
      if (json.locked) {
        anyLocked = true;
        return;
      }
      var quals = (json.qualityList || []).filter(function (q) {
        return q && q.url;
      });
      if (!quals.length) quals = [{ label: "Auto", url: json.videoUrl }];
      var subtitles = (json.subtitles || []).map(function (s) {
        return {
          url: abs(s.url),
          label: s.label || "Subtitle",
          lang: s.label || undefined,
        };
      });
      quals.forEach(function (q) {
        var u = abs(q.url);
        if (seenUrls[u]) return; // server 2 often mirrors server 1
        seenUrls[u] = true;
        streams.push(
          new StreamResult({
            url: u,
            source: (si === 1 ? "Server 2 · " : "") + (q.label || "Auto"),
            headers: { Referer: "https://reelfren.dramafren.org/" },
            subtitles: subtitles.length ? subtitles : undefined,
          }),
        );
      });
    });
    if (!streams.length)
      return cb({
        success: false,
        errorCode: anyLocked ? "LOCKED" : "NOT_FOUND",
        message: anyLocked ? "Episode is locked" : "No stream found",
      });
    cb({ success: true, data: streams });
  }

  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();
