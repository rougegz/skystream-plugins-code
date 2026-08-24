(function () {
  "use strict";

  // Sansekai plugin: short dramas from 9 providers via api.sansekai.my.id
  // (the open-source SekaiDrama gateway). Home sections are DYNAMIC: each
  // provider gets the API's own endpoint set (trending/latest/foryou/
  // theaters/home/...), verified against the live API — empty sections and
  // sections returning the same id-set as another are dropped. The gateway
  // rate-limits (~10 req/min), so getHome requests are paced in batches.
  // Streams pass through every quality, audio track and subtitle the API
  // exposes (languages labelled), so English audio/subtitles can be picked
  // in the player wherever the provider has them.
  var API =
    (typeof manifest !== "undefined" && manifest && manifest.baseUrl) ||
    "https://api.sansekai.my.id/api";
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

  function abs(url) {
    url = String(url || "");
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) {
      // the gateway sometimes returns http:// links for its own proxy
      if (/^http:\/\/api\.sansekai\.my\.id/i.test(url))
        return url.replace(/^http:\/\//i, "https://");
      return url;
    }
    if (url.indexOf("//") === 0) return "https:" + url;
    return API + (url.charAt(0) === "/" ? "" : "/") + url;
  }

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
    var res = await withTimeout(
      http_get(API + path, {
        Accept: "application/json",
        "User-Agent": nextUA(),
      }).catch(function () {
        return null;
      }),
      REQ_TIMEOUT,
    );
    // Retry once on any failure (null, 429, 5xx, even intermittent 403
    // blacklist responses — the flag is per-request and often clears
    // within seconds, so a single retry usually recovers the data).
    if (isErrorResp(res)) {
      await sleep(2000);
      res = await withTimeout(
        http_get(API + path, {
          Accept: "application/json",
          "User-Agent": nextUA(),
        }).catch(function () {
          return null;
        }),
        REQ_TIMEOUT,
      );
    }
    return parseBody(res);
  }

  function parseBody(res) {
    if (!res) return null;
    try {
      return JSON.parse(String(res.body || res.text || ""));
    } catch (e) {
      return null;
    }
  }

  // True when a response is a transient failure worth retrying (missing
  // body, 429 rate limit, 5xx). 403 blacklist responses are NOT transient —
  // the flag needs minutes of quiet to clear, so retrying just extends it.
  function isTransientError(res) {
    if (!res) return true;
    var t = String(res.body || res.text || "");
    if (!t) return true;
    return (
      /"error"\s*:|Too Many|429|"code"\s*:\s*5\d\d/i.test(t) &&
      !/Forbidden|blacklist|403/i.test(t)
    );
  }

  // True when a response is unusable (missing, error JSON, or empty body).
  function isErrorResp(res) {
    if (!res) return true;
    var t = String(res.body || res.text || "");
    return (
      !t ||
      /"error"\s*:|Forbidden|Too Many|blacklist|"code"\s*:\s*(429|403|5\d\d)/i.test(
        t,
      )
    );
  }

  var REQ_TIMEOUT = 12000; // per-request: a hung section must not blank the home
  // The gateway blacklists IPs that fire requests in parallel ("suspicious
  // activity") — it only tolerates one request at a time. Fetch strictly
  // sequentially; a failed request resolves to null so only that section
  // is dropped.
  async function httpSeq(urls) {
    var out = [];
    for (var i = 0; i < urls.length; i++) {
      out[i] = await withTimeout(
        http_get(urls[i], {
          Accept: "application/json",
          "User-Agent": nextUA(),
        }).catch(function () {
          return null;
        }),
        REQ_TIMEOUT,
      );
    }
    return out;
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
  var ROW_SIZE = 24;
  var TRENDING_SIZE = 10;

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

  // ---- per-provider home sections: the gateway's own endpoint set ----
  // page: "page" | "offset" | null — pagination param for a fuller row.
  var PROVIDER_SECTIONS = {
    melolo: [
      { path: "/melolo/trending", name: "Trending" },
      { path: "/melolo/latest", name: "New Releases" },
      { path: "/melolo/foryou", name: "For You", page: "offset" },
    ],
    dramabox: [
      { path: "/dramabox/trending", name: "Trending" },
      { path: "/dramabox/latest", name: "New Releases" },
      { path: "/dramabox/foryou", name: "For You", page: "page" },
      { path: "/dramabox/dubindo", name: "Dub Indonesia" },
    ],
    goodshort: [
      { path: "/goodshort/trending", name: "Trending" },
      { path: "/goodshort/latest", name: "New Releases" },
      { path: "/goodshort/foryou", name: "For You", page: "page" },
    ],
    pinedrama: [
      { path: "/pinedrama/trending", name: "Trending" },
      { path: "/pinedrama/foryou", name: "For You", page: "page" },
    ],
    netshort: [
      { path: "/netshort/theaters", name: "Theaters" },
      { path: "/netshort/foryou", name: "For You", page: "page" },
    ],
    dramanova: [
      { path: "/dramanova/home", name: "Home" },
      { path: "/dramanova/drama18", name: "Drama 18+" },
      { path: "/dramanova/komik", name: "Komik" },
    ],
    reelshort: [
      { path: "/reelshort/homepage", name: "Home" },
      { path: "/reelshort/foryou", name: "For You", page: "page" },
    ],
    shortmax: [
      { path: "/shortmax/latest", name: "Latest" },
      { path: "/shortmax/rekomendasi", name: "Rekomendasi" },
      { path: "/shortmax/foryou", name: "For You", page: "page" },
    ],
    freereels: [{ path: "/freereels/foryou", name: "For You", page: "page" }],
  };

  // The API tells us how to get the next page (next_offset / page_info.next),
  // falling back to a plain page/offset increment.
  function nextPageQuery(sec, json) {
    if (!sec.page || !json) return null;
    var data = (json && (json.data || json)) || {};
    if (data.next_offset !== undefined && data.next_offset !== null)
      return "?offset=" + encodeURIComponent(String(data.next_offset));
    var pi = data.page_info || {};
    if (pi.next) return pi.next.indexOf("?") === 0 ? pi.next : "?" + pi.next;
    if (data.next) return "?page=" + encodeURIComponent(String(data.next));
    return sec.page === "offset" ? "?offset=2" : "?page=2";
  }

  // Normalize any provider's feed JSON to [{id, title, cover, intro}].
  function booksOf(pid, json) {
    if (!json) return [];
    var out = [];
    function push(b) {
      if (b && b.id) out.push(b);
    }
    if (pid === "melolo") {
      var data = json.data || json;
      function meloloPush(b) {
        if (b && b.book_id)
          out.push({
            id: b.book_id,
            title: b.book_name,
            cover: b.thumb_url,
            intro: b.abstract,
            raw: b,
          });
      }
      (data.cells || []).forEach(function (c) {
        (c.cell_data || []).forEach(function (s) {
          (s.books || []).forEach(meloloPush);
        });
      });
      var cell = data.cell;
      if (cell)
        (cell.cell_data || []).forEach(function (s) {
          (s.books || []).forEach(meloloPush);
        });
      (data.search_data || []).forEach(function (sd) {
        (sd.books || []).forEach(meloloPush);
      });
      (data.books || []).forEach(meloloPush);
    } else if (pid === "dramabox") {
      (Array.isArray(json) ? json : []).forEach(function (b) {
        push({
          id: b.bookId,
          title: b.bookName,
          cover: b.coverWap || b.cover,
          intro: b.introduction,
        });
      });
    } else if (pid === "goodshort") {
      ((json.data && json.data.records) || []).forEach(function (r) {
        (r.items || []).forEach(function (b) {
          push({
            id: b.bookId,
            title: b.bookName,
            cover: b.cover,
            intro: b.bookBrief || b.brief || "",
          });
        });
      });
    } else if (pid === "pinedrama") {
      (json.collections || []).forEach(function (b) {
        push({
          id: b.collection_id,
          title: b.title,
          cover: b.cover,
          intro: b.description,
        });
      });
      (json.results || []).forEach(function (b) {
        push({
          id: b.collection_id,
          title: b.title,
          cover: b.cover,
          intro: b.description,
        });
      });
    } else if (pid === "netshort") {
      (Array.isArray(json) ? json : [json]).forEach(function (g) {
        (g.contentInfos || []).forEach(function (b) {
          push({
            id: b.shortPlayId,
            title: b.shortPlayName,
            cover: b.shortPlayCover,
          });
        });
      });
      (json.searchCodeSearchResult || []).forEach(function (b) {
        push({
          id: b.shortPlayId,
          title: b.shortPlayName,
          cover: b.shortPlayCover,
        });
      });
      (json.shadedWordSearchResult || []).forEach(function (b) {
        push({
          id: b.shortPlayId,
          title: b.shortPlayName,
          cover: b.shortPlayCover,
        });
      });
    } else if (pid === "dramanova") {
      (json.rows || []).forEach(function (b) {
        push({
          id: b.dramaId,
          title: b.title,
          cover: b.posterImg || b.posterImgUrl,
          intro: b.synopsis,
        });
      });
    } else if (pid === "reelshort") {
      var rl = (json.data && json.data.lists) || [];
      rl.forEach(function (l) {
        if (Array.isArray(l.books))
          l.books.forEach(function (b) {
            push({ id: b.book_id, title: b.book_title, cover: b.book_pic });
          });
        else if (l.book_id)
          push({ id: l.book_id, title: l.book_title, cover: l.book_pic });
      });
      ((json.data && json.data.results) || []).forEach(function (b) {
        push({ id: b.book_id, title: b.book_title, cover: b.book_pic });
      });
      (json.results || []).forEach(function (b) {
        push({
          id: b.bookId,
          title: b.title,
          cover: b.cover,
          intro: b.description,
        });
      });
    } else if (pid === "shortmax") {
      (json.results || []).forEach(function (b) {
        push({ id: b.shortPlayId, title: b.name, cover: b.cover });
      });
    } else if (pid === "freereels") {
      ((json.data && json.data.items) || []).forEach(function (b) {
        push({ id: b.key, title: b.title, cover: b.cover, intro: b.desc });
      });
    }
    var seen = {};
    return out.filter(function (b) {
      var k = String(b.id);
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  // 1. getHome: dynamic rows from the provider's real endpoint set.
  // The gateway is slow (~5-8s per request), rate-limited (~10/min), and
  // blacklists IPs that burst requests, so we fetch exactly one request at
  // a time, never retry blacklist 403s (retrying while flagged just extends
  // the flag), and bound the whole call so the app never waits forever:
  // partial rows are better than none, and stale cache beats blank.
  // Sections that fail or duplicate another section's id-set are dropped;
  // leftovers spill into extra auto-named rows. Books the API marks as
  // English (melolo language/original_language) get an "English" row.
  var HOME_CACHE = {}; // pid -> {t, data}
  var HOME_CACHE_TTL = 60 * 60 * 1000; // fresh cache
  var STALE_TTL = 24 * 60 * 60 * 1000; // stale fallback when all fetches fail
  var HOME_BUDGET = 35000; // whole fetch phase must fit under the app timeout
  var ENGLISH_MIN = 2; // min books for the "English" row

  async function getHome(cb) {
    var pid = providerId();
    var cached = HOME_CACHE[pid];
    if (cached && Date.now() - cached.t < HOME_CACHE_TTL)
      return cb({ success: true, data: cached.data });
    var sections =
      PROVIDER_SECTIONS[pid] || PROVIDER_SECTIONS[DEFAULT_PROVIDER];
    var data = {};
    // One sequential batch: page 1 of every section, one request at a time
    // (parallel requests get the IP blacklisted by the gateway).
    var pageResps =
      (await withTimeout(
        httpSeq(
          sections.map(function (s) {
            return API + s.path;
          }),
        ),
        HOME_BUDGET,
      )) || [];
    // Retry only transient failures (null body / 429 rate-limit / 5xx).
    // 403 blacklist responses are NOT retried: the flag needs minutes of
    // quiet to clear, and more requests just extend it.
    var retryTasks = [];
    sections.forEach(function (s, i) {
      if (!isTransientError(pageResps[i])) return;
      retryTasks.push({ sec: s, idx: i });
    });
    for (var r = 0; r < retryTasks.length; r++) {
      await sleep(2000);
      var resp = await withTimeout(
        http_get(API + retryTasks[r].sec.path, {
          Accept: "application/json",
          "User-Agent": nextUA(),
        }).catch(function () {
          return null;
        }),
        REQ_TIMEOUT,
      );
      if (parseBody(resp)) pageResps[retryTasks[r].idx] = resp;
    }
    var groups = {}; // id-signature -> [{sec, idx, raw}]
    var hero = [];
    sections.forEach(function (s, i) {
      var books = booksOf(pid, parseBody(pageResps[i]));
      if (!books.length) return;
      if (!hero.length) hero = books;
      var sig = books
        .slice(0, 8)
        .map(function (b) {
          return b.id;
        })
        .sort()
        .join(",");
      (groups[sig] = groups[sig] || []).push({ sec: s, idx: i, raw: books });
    });
    var live = [];
    Object.keys(groups).forEach(function (sig) {
      if (groups[sig].length === 1) live.push(groups[sig][0]);
    });
    var sectionRaw = sections.map(function () {
      return [];
    });
    sections.forEach(function (s, si) {
      booksOf(pid, parseBody(pageResps[si])).forEach(function (d) {
        sectionRaw[si].push(d);
      });
    });
    var seen = {};
    function mark(list) {
      list.forEach(function (d) {
        seen[d.id] = true;
      });
    }
    if (hero.length) {
      var heroItems = hero.slice(0, TRENDING_SIZE);
      data["Trending"] = heroItems.map(buildItem);
      mark(heroItems);
    }
    // Books the API marks as English get their own row (melolo only today).
    var english = [];
    sections.forEach(function (s, si) {
      sectionRaw[si].forEach(function (d) {
        if (
          d.raw &&
          (d.raw.language === "en" || d.raw.original_language === "en")
        )
          english.push(d);
      });
    });
    // dedupe english
    var eSeen = {};
    english = english.filter(function (d) {
      if (eSeen[d.id]) return false;
      eSeen[d.id] = true;
      return true;
    });
    if (english.length >= ENGLISH_MIN) {
      var eRow = english.slice(0, ROW_SIZE);
      data["English"] = eRow.map(buildItem);
      mark(eRow);
    }
    // One row per live section (its name), extras spill into auto rows.
    var spilled = [];
    live.forEach(function (g, gi) {
      var all = sectionRaw[g.idx];
      if (!all.length) return;
      var named = all.slice(0, ROW_SIZE);
      data[g.sec.name] = named.map(buildItem);
      mark(named);
      all.slice(ROW_SIZE).forEach(function (d) {
        if (!seen[d.id]) spilled.push(d);
      });
    });
    // Anything left over from duplicate-sig or unnamed sections.
    sections.forEach(function (s, si) {
      sectionRaw[si].forEach(function (d) {
        if (
          !seen[d.id] &&
          !spilled.some(function (x) {
            return x.id === d.id;
          })
        )
          spilled.push(d);
      });
    });
    chunk(spilled, ROW_SIZE).forEach(function (row, i) {
      data[sectionName(i)] = row.map(buildItem);
    });
    // If every section failed (e.g. IP blacklisted), serve the last known
    // good home instead of blank — stale content beats an empty screen.
    if (
      !Object.keys(data).length &&
      cached &&
      Date.now() - cached.t < STALE_TTL
    )
      return cb({ success: true, data: cached.data });
    HOME_CACHE[pid] = { t: Date.now(), data: data };
    cb({ success: true, data: data });
  }

  // 2. search.
  async function search(query, cb) {
    var pid = providerId();
    var json = await apiGet(
      "/" + pid + "/search?query=" + encodeURIComponent(query),
    );
    cb({ success: true, data: booksOf(pid, json).map(buildItem) });
  }

  function enc(s) {
    return encodeURIComponent(String(s || ""));
  }

  function detailPath(pid, p) {
    switch (pid) {
      case "melolo":
        return "/melolo/detail?book_id=" + enc(p.id);
      case "dramabox":
        return "/dramabox/detail?bookId=" + enc(p.id);
      case "goodshort":
        return "/goodshort/detail?bookId=" + enc(p.id);
      case "pinedrama":
        return "/pinedrama/detail?collection_id=" + enc(p.id);
      case "netshort":
        return "/netshort/allepisode?shortPlayId=" + enc(p.id);
      case "dramanova":
        return "/dramanova/detail?dramaId=" + enc(p.id);
      case "reelshort":
        return "/reelshort/detail?bookId=" + enc(p.id);
      case "shortmax":
        return "/shortmax/detail?shortPlayId=" + enc(p.id);
      case "freereels":
        return "/freereels/detailAndAllEpisode?key=" + enc(p.id);
    }
    return "";
  }

  // 3. load: drama details + episode list.
  async function load(url, cb) {
    var p = parsePayload(url);
    var pid = p.providerId || providerId();
    var json = await apiGet(detailPath(pid, p));
    if (!json)
      return cb({
        success: false,
        errorCode: "NOT_FOUND",
        message: "Drama not found",
      });
    var info = {};
    var episodes = [];
    var i, n, ep;
    switch (pid) {
      case "melolo": {
        var vd = (json.data && json.data.video_data) || {};
        info = {
          title: vd.series_title,
          cover: vd.series_cover,
          intro: vd.series_intro,
        };
        (vd.video_list || []).forEach(function (v) {
          if (v.vid)
            episodes.push({
              name: "Episode " + v.vid_index,
              episode: v.vid_index,
              vid: v.vid,
            });
        });
        break;
      }
      case "dramabox": {
        info = {
          title: json.bookName,
          cover: json.coverWap || json.cover,
          intro: json.introduction,
        };
        var all = await apiGet("/dramabox/allepisode?bookId=" + enc(p.id));
        (Array.isArray(all) ? all : []).forEach(function (ch) {
          if (ch.chapterId)
            episodes.push({
              name: ch.chapterName || "Episode " + (ch.chapterIndex + 1),
              episode: ch.chapterIndex + 1,
              vid: ch.chapterId,
            });
        });
        break;
      }
      case "goodshort": {
        var bk = (json.data && json.data.book) || {};
        info = {
          title: bk.bookName,
          cover: bk.cover,
          intro: bk.bookBrief || "",
        };
        break;
      }
      case "pinedrama": {
        info = {
          title: json.title,
          cover: (json.cover_urls && json.cover_urls[0]) || json.cover,
          intro: json.description,
        };
        n = parseInt(json.total_episodes, 10) || 0;
        for (i = 1; i <= n; i++)
          episodes.push({ name: "Episode " + i, episode: i });
        break;
      }
      case "netshort": {
        info = {
          title: json.shortPlayName,
          cover: json.shortPlayCover,
          intro: json.shotIntroduce,
        };
        (json.shortPlayEpisodeInfos || []).forEach(function (e) {
          if (e.episodeId)
            episodes.push({
              name: "Episode " + e.episodeNo,
              episode: e.episodeNo,
              vid: e.episodeId,
            });
        });
        break;
      }
      case "dramanova": {
        var dn = json.data || json;
        info = {
          title: dn.title,
          cover: dn.posterImg || dn.posterImgUrl,
          intro: dn.description,
        };
        (dn.episodes || []).forEach(function (e) {
          if (e.episodeNumber)
            episodes.push({
              name: e.episodeTitle || "Episode " + e.episodeNumber,
              episode: e.episodeNumber,
              vid: e.fileId || e.id,
            });
        });
        break;
      }
      case "reelshort": {
        info = {
          title: json.title,
          cover: json.cover,
          intro: json.description,
        };
        (json.chapters || []).forEach(function (c) {
          if (c.chapterId)
            episodes.push({
              name: "Episode " + c.index,
              episode: c.index,
              vid: c.chapterId,
            });
        });
        break;
      }
      case "shortmax": {
        var sm = json.data || json;
        info = { title: sm.shortPlayName, cover: sm.picUrl, intro: sm.summary };
        n = parseInt(sm.totalEpisodes, 10) || 0;
        for (i = 1; i <= n; i++)
          episodes.push({ name: "Episode " + i, episode: i });
        break;
      }
      case "freereels": {
        var fr = (json.data && json.data.info) || {};
        info = { title: fr.name, cover: fr.cover, intro: fr.desc };
        (fr.episode_list || []).forEach(function (e) {
          if (e.id)
            episodes.push({
              name: e.name || "Episode " + e.index,
              episode: e.index,
              vid: e.id,
            });
        });
        break;
      }
    }
    if (!info.title)
      return cb({
        success: false,
        errorCode: "NOT_FOUND",
        message: "Drama not found",
      });
    var item = buildItem({
      provider: pid,
      id: p.id,
      title: info.title,
      cover: info.cover,
      intro: info.intro,
    });
    item.episodes = episodes.map(function (e) {
      return new Episode({
        name: e.name,
        url: payload({
          providerId: pid,
          id: String(p.id),
          title: info.title,
          episode: e.episode,
          vid: e.vid ? String(e.vid) : undefined,
        }),
        season: 1,
        episode: e.episode,
      });
    });
    cb({ success: true, data: item });
  }

  // 4. loadStreams: playable links for one episode. Every quality / audio
  // track / subtitle the API exposes is passed through with a label, so the
  // player can switch audio/subtitle language (e.g. English) per episode.
  async function loadStreams(url, cb) {
    var p = parsePayload(url);
    var pid = p.providerId || providerId();
    var json = null;
    var streams = [];
    var subtitles = [];
    function pushStream(u, label) {
      u = abs(u);
      if (
        !u ||
        streams.some(function (s) {
          return s.url === u;
        })
      )
        return;
      streams.push(
        new StreamResult({
          url: u,
          source: label,
          headers: { Referer: "https://sansekai.my.id/" },
          subtitles: subtitles.length ? subtitles : undefined,
        }),
      );
    }
    switch (pid) {
      case "melolo": {
        json = await apiGet("/melolo/episode?videoId=" + enc(p.vid || p.id));
        var quals = (json && json.qualities) || [];
        if (!quals.length && json && json.streamUrl) quals = [json];
        quals.forEach(function (q) {
          if (q.streamUrl) pushStream(q.streamUrl, q.definition || "Auto");
        });
        break;
      }
      case "dramabox": {
        json = await apiGet("/dramabox/allepisode?bookId=" + enc(p.id));
        var chapters = Array.isArray(json) ? json : [];
        var idx = parseInt(p.episode, 10) - 1;
        var ch = chapters[idx] || chapters[0];
        if (ch) {
          var cdn = (ch.cdnList || []).filter(function (c) {
            return c.isDefault === 1;
          });
          cdn = cdn.length ? cdn : ch.cdnList || [];
          ((cdn[0] && cdn[0].videoPathList) || []).forEach(function (v) {
            if (v.videoPath)
              pushStream(
                API +
                  "/dramabox/decrypt-stream?url=" +
                  encodeURIComponent(v.videoPath),
                (v.quality ? v.quality + "p" : "Auto") +
                  (v.isDefault === 1 ? " · Default" : ""),
              );
          });
        }
        break;
      }
      case "goodshort":
        break; // episodes endpoint currently down on the gateway
      case "pinedrama": {
        json = await apiGet(
          "/pinedrama/episode?collection_id=" +
            enc(p.id) +
            "&episodeNumber=" +
            enc(p.episode),
        );
        if (json && json.best_url)
          pushStream(json.best_url, json.quality || "Auto");
        break;
      }
      case "netshort": {
        json = await apiGet("/netshort/allepisode?shortPlayId=" + enc(p.id));
        var nEp = null;
        (json.shortPlayEpisodeInfos || []).forEach(function (e) {
          if (String(e.episodeNo) === String(p.episode)) nEp = e;
        });
        nEp = nEp || (json.shortPlayEpisodeInfos || [])[0];
        if (nEp && nEp.playVoucher) {
          subtitles = (nEp.subtitleList || []).map(function (s) {
            return {
              url: abs(s.url),
              label: s.subtitleLanguage || "Subtitle",
              lang: s.subtitleLanguage || undefined,
            };
          });
          pushStream(nEp.playVoucher, nEp.playClarity || "Auto");
        }
        break;
      }
      case "dramanova": {
        json = await apiGet("/dramanova/getvideo?fileId=" + enc(p.vid || p.id));
        var dv = (json && (json.data || json)) || {};
        var list = dv.qualities || dv.video_list || [];
        list.forEach(function (q) {
          var u =
            q.url || q.videoUrl || q.videoPath || q.playUrl || q.streamUrl;
          if (u) pushStream(u, q.definition || q.label || q.quality || "Auto");
        });
        if (dv.videoUrl) pushStream(dv.videoUrl, "Auto");
        break;
      }
      case "reelshort": {
        json = await apiGet(
          "/reelshort/episode?bookId=" +
            enc(p.id) +
            "&episodeNumber=" +
            enc(p.episode),
        );
        ((json && json.videoList) || []).forEach(function (v) {
          if (v.url)
            pushStream(
              v.url,
              (v.quality ? v.quality + "p" : "Auto") +
                (v.encode ? " " + v.encode : ""),
            );
        });
        break;
      }
      case "shortmax": {
        json = await apiGet(
          "/shortmax/episode?shortPlayId=" +
            enc(p.id) +
            "&episodeNumber=" +
            enc(p.episode),
        );
        var vu = (json && json.episode && json.episode.videoUrl) || {};
        Object.keys(vu).forEach(function (k) {
          if (vu[k]) pushStream(vu[k], k.replace("video_", "") + "p");
        });
        break;
      }
      case "freereels": {
        json = await apiGet("/freereels/detailAndAllEpisode?key=" + enc(p.id));
        var frInfo = (json.data && json.data.info) || {};
        var eps = frInfo.episode_list || [];
        var fEp = null;
        eps.forEach(function (e) {
          if (String(e.index) === String(p.episode)) fEp = e;
        });
        fEp = fEp || eps[0];
        if (fEp) {
          subtitles = (fEp.subtitle_list || []).map(function (s) {
            return {
              url: abs(s.vtt || s.subtitle),
              label: s.language || "Subtitle",
              lang: s.language || undefined,
            };
          });
          if (fEp.external_audio_h264_m3u8)
            pushStream(fEp.external_audio_h264_m3u8, "External Audio H264");
          if (fEp.external_audio_h265_m3u8)
            pushStream(fEp.external_audio_h265_m3u8, "External Audio H265");
          if (fEp.m3u8_url)
            pushStream(
              fEp.m3u8_url,
              fEp.original_audio_language
                ? "Original Audio (" + fEp.original_audio_language + ")"
                : "Original Audio",
            );
          if (fEp.video_url) pushStream(fEp.video_url, "Video");
        }
        break;
      }
    }
    if (!streams.length)
      return cb({
        success: false,
        errorCode: "NOT_FOUND",
        message: "No stream found",
      });
    cb({ success: true, data: streams });
  }

  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();
