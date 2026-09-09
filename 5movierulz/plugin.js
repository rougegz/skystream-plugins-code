import { UA, qualityRank } from "./hosters/_common.js";
import { resolveStreamlare } from "./hosters/streamlare.js";
import { resolveUperbox } from "./hosters/uperbox.js";
import { resolveEasysyncr } from "./hosters/easysyncr.js";
import { resolveDownload } from "./hosters/download.js";
import { resolveStreamwish } from "./hosters/streamwish.js";
import { resolveFilelions } from "./hosters/filelions.js";

(function () {
  var HOME_CATS = [
    {
      name: "Latest Movies",
      path: function (b, p) {
        return p === 1 ? b + "/" : b + "/page/" + p + "/";
      },
    },
    {
      name: "Telugu Movies 2026",
      path: function (b, p) {
        return (
          b +
          "/category/telugu-movies-2026" +
          (p === 1 ? "" : "/page/" + p + "/")
        );
      },
    },
    {
      name: "Telugu Dubbed",
      path: function (b, p) {
        return (
          b + "/language/telugu-dubbed" + (p === 1 ? "" : "/page/" + p + "/")
        );
      },
    },
    {
      name: "Bollywood Movies 2026",
      path: function (b, p) {
        return (
          b +
          "/category/bollywood-movies-2026" +
          (p === 1 ? "" : "/page/" + p + "/")
        );
      },
    },
  ];

  var ROUTES = [
    { re: /streamlare|vcdnlare|slmaxed|vcdnx/, run: resolveStreamlare },
    { re: /uperbox/, run: resolveUperbox },
    { re: /download/, run: resolveDownload },
    { re: /easysyncr|easysync/, run: resolveEasysyncr },
    {
      re: /streamwish|wish|hglink|hgcloud|streamhls|wishfast|multimovies|katomen|uqloads|playerwish|hlswish|swhoi|swdyu|kswplayer|nekowish|hanerix|audinifer|vibuxer|masukestin|hgplaycdn|hglamioz|niramirus|playnixes|medixiru|gradehgplus|stbhg|doodporn/,
      run: resolveStreamwish,
    },
    {
      re: /filelion|lions|vidhide|minochinos|callistanise|morencius|kinoger|earnvids|streamvid|smoothpre|movearnpre|videoland|dhtpre|peytonepre|moflix|dintezuvio|dinisglows|dingtezuni|taylorplayer|ryderjet|javplaya|javion|fdewsdc|techradar|lumiawatch|azipcdn|mivalyo|motvy55|egsyxutd|e4xb5c2xnz|gsfomqu|coolciima|anime7u|bingez|6sfkrspw4u|\/f\/|\/v\/|\/embed\//,
      run: resolveFilelions,
    },
  ];

  var BASE_URL = "https://www.5movierulz.ventures";
  try {
    BASE_URL = String(manifest.baseUrl || BASE_URL).replace(/\/$/, "");
  } catch (e) {}

  function stdHeaders(ref) {
    return {
      "User-Agent": UA,
      Referer: ref || BASE_URL + "/",
      Connection: "keep-alive",
    };
  }

  function cleanHref(h) {
    if (!h) return "";
    return String(h)
      .replace(/[\r\n\t]/g, "")
      .trim()
      .replace(/&amp;/g, "&");
  }

  function resolveUrl(href, b) {
    href = cleanHref(href);
    if (!href) return "";
    if (href.indexOf("http") === 0) return href;
    if (href.charAt(0) === "/") return b + href;
    return b + "/" + href;
  }

  function stripTags(s) {
    var t = String(s || "")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, "");
    for (var i = 0; i < 2; i++) {
      t = t
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, "");
    }
    return t.replace(/\s+/g, " ").trim();
  }

  function cleanTitle(raw) {
    var t = stripTags(raw);
    t = t
      .replace(/\s+(Full\s+)?Movie\s+Watch\s+Online\s+(Free|HD).*/i, "")
      .trim();
    t = t
      .replace(
        /\s+(DVDScr|DVDRip|HDRip|BRRip|WEBRip|WEB-DL|BluRay|CAMRip|PreDVD)\s+.*/i,
        "",
      )
      .trim();
    return t || "Unknown";
  }

  function isSeries(title) {
    return /\bSeason\s*\d|\bS\d{1,2}E\d|\bEP\s*\d|Episode\s*\d/i.test(
      title || "",
    );
  }

  function yearOf(s) {
    var m = /\b(19\d{2}|20\d{2})\b/.exec(s || "");
    return m ? parseInt(m[1], 10) : 0;
  }

  function b64encodeJson(obj) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  }

  function b64decodeJson(payload) {
    return JSON.parse(decodeURIComponent(escape(atob(payload))));
  }

  function parseGrid(html, b) {
    var items = [];
    var seen = {};
    var re = /<a[^>]*href=(["'])([\s\S]*?)\1[^>]*>/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var href = cleanHref(m[2]);
      if (!href || href === "#" || href.indexOf("javascript:") === 0) continue;
      if (
        /\/(category|language|genre|quality|year|director|actor|tag)\//.test(
          href,
        )
      )
        continue;
      if (href.indexOf(".html") === -1) continue;
      var url = resolveUrl(href, b);
      if (!url || seen[url]) continue;
      var win = html.substring(m.index, m.index + 1500);
      var im = /<img[^>]+src=(["'])([\s\S]*?)\1/.exec(win);
      var poster = im ? resolveUrl(im[2], b) : "";
      if (!poster || poster.indexOf("/uploads/") === -1) continue;
      var raw = "";
      var tm = /title=(["'])([\s\S]*?)\1/.exec(m[0]);
      if (tm) raw = tm[2];
      if (!raw) {
        var alt = /alt=(["'])([\s\S]*?)\1/.exec(win);
        if (alt) raw = alt[2];
      }
      if (!raw) {
        var bt = /<b>([^<]+)<\/b>/.exec(win);
        if (bt) raw = bt[1];
      }
      var title = cleanTitle(raw);
      if (!title || title === "Unknown" || title.length < 3) continue;
      seen[url] = true;
      var item = {
        title: title,
        url: url,
        posterUrl: poster,
        type: isSeries(raw) ? "series" : "movie",
      };
      var yr = yearOf(raw);
      if (yr) item.year = yr;
      items.push(item);
    }
    return items;
  }

  function toItems(items) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var data = {
        title: items[i].title,
        url: items[i].url,
        type: items[i].type || "movie",
      };
      if (items[i].posterUrl) data.posterUrl = items[i].posterUrl;
      if (items[i].year) data.year = items[i].year;
      out.push(new MultimediaItem(data));
    }
    return out;
  }

  function fetchText(url, ref) {
    return http_get(url, stdHeaders(ref))
      .then(function (res) {
        return res && typeof res.body === "string" ? res.body : "";
      })
      .catch(function () {
        return "";
      });
  }

  function fetchSeq(urls, ref) {
    return Promise.all(
      urls.map(function (u) {
        return fetchText(u, ref);
      }),
    );
  }

  function fetchAll(urls, ref) {
    var reqs = urls.map(function (u) {
      return { url: u, headers: stdHeaders(ref) };
    });
    try {
      if (typeof http_parallel === "function") {
        return http_parallel(reqs)
          .then(function (resps) {
            return (resps || []).map(function (r) {
              return r && typeof r.body === "string" ? r.body : "";
            });
          })
          .catch(function () {
            return fetchSeq(urls, ref);
          });
      }
    } catch (e) {}
    return fetchSeq(urls, ref);
  }

  function parseHosters(html, b) {
    var out = [];
    var seen = {};
    var re = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      if (m[0].indexOf("stream-link-btn") === -1) continue;
      var hm = /href=(["'])([\s\S]*?)\1/i.exec(m[0]);
      if (!hm) continue;
      var href = cleanHref(hm[2]);
      if (!href || href === "#") continue;
      if (/^(javascript|data|vbscript|file):/i.test(href)) continue;
      var url = resolveUrl(href, b);
      if (!url || url.indexOf("http") !== 0) continue;
      var label = stripTags(m[1]).replace(/▶/g, "").trim() || "Watch";
      var key = label.toLowerCase() + "|" + url;
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ label: label, url: url });
    }
    return out;
  }

  function metaBlock(html, names) {
    for (var i = 0; i < names.length; i++) {
      var idx = html.indexOf(names[i]);
      if (idx !== -1) {
        var tail = html.substring(idx + names[i].length, idx + 600);
        var pe = tail.indexOf("</p>");
        var br = tail.indexOf("<br");
        var cut = pe !== -1 ? pe : br !== -1 ? br : tail.length;
        var txt = stripTags(tail.substring(0, cut));
        if (txt) return txt;
      }
    }
    return "";
  }

  function splitNames(s) {
    var out = [];
    var parts = String(s || "").split(",");
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p) out.push(p);
    }
    return out;
  }

  async function getHome(cb) {
    try {
      var b = BASE_URL;
      var urls = [];
      var meta = [];
      for (var c = 0; c < HOME_CATS.length; c++) {
        for (var p = 1; p <= 3; p++) {
          urls.push(HOME_CATS[c].path(b, p));
          meta.push(c);
        }
      }
      var pages = await fetchAll(urls, b + "/");
      var data = {};
      for (var i = 0; i < HOME_CATS.length; i++) {
        var merged = [];
        var seen = {};
        for (var k = 0; k < pages.length; k++) {
          if (meta[k] !== i || !pages[k]) continue;
          var items = parseGrid(pages[k], b);
          for (var j = 0; j < items.length; j++) {
            if (!seen[items[j].url]) {
              seen[items[j].url] = true;
              merged.push(items[j]);
            }
          }
        }
        if (merged.length)
          data[HOME_CATS[i].name] = toItems(merged.slice(0, 60));
      }
      if (!Object.keys(data).length) {
        return cb({
          success: false,
          errorCode: "HOME_EMPTY",
          message: "No home categories parsed",
        });
      }
      cb({ success: true, data: data });
    } catch (e) {
      cb({
        success: false,
        errorCode: "HOME_ERROR",
        message: String((e && e.message) || e),
      });
    }
  }

  async function search(query, cb) {
    try {
      if (!query || !String(query).trim())
        return cb({ success: true, data: [] });
      var b = BASE_URL;
      var q = encodeURIComponent(query || "");
      var pages = await fetchAll(
        [b + "/?s=" + q, b + "/search_movies?s=" + q, b + "/search/" + q],
        b + "/",
      );
      for (var i = 0; i < pages.length; i++) {
        if (!pages[i]) continue;
        var items = parseGrid(pages[i], b);
        if (items.length)
          return cb({ success: true, data: toItems(items.slice(0, 30)) });
      }
      cb({ success: true, data: [] });
    } catch (e) {
      cb({
        success: false,
        errorCode: "SEARCH_ERROR",
        message: String((e && e.message) || e),
      });
    }
  }

  async function load(url, cb) {
    try {
      var b = BASE_URL;
      var html = await fetchText(url, url);
      if (!html) {
        return cb({
          success: false,
          errorCode: "LOAD_HTTP",
          message: "Detail page fetch failed",
        });
      }
      var rawTitle = "";
      var em = /class="entry-title"[^>]*>([^<]+)</.exec(html);
      if (em) rawTitle = em[1];
      if (!rawTitle) {
        var h2 = /<h2[^>]*>([^<]{4,200})<\/h2>/.exec(html);
        if (h2) rawTitle = h2[1];
      }
      if (!rawTitle) {
        var tt = /<title>([^<]+)<\/title>/.exec(html);
        if (tt) rawTitle = tt[1];
      }
      var title = cleanTitle(rawTitle);
      if (!title || title === "Unknown") title = "Movie";
      var poster = "";
      var up = /<img[^>]+src="([^"]*\/uploads\/[^"]*)"/.exec(html);
      if (up) poster = resolveUrl(up[1], b);
      if (!poster) {
        var og =
          /property="og:image"[^>]*content="([^"]+)"/.exec(html) ||
          /content="([^"]+)"[^>]*property="og:image"/.exec(html);
        if (og) poster = cleanHref(og[1]);
      }
      var director = metaBlock(html, ["Directed by:", "Director:"]);
      var genres = splitNames(metaBlock(html, ["Genres:", "Genre:"]));
      var language = metaBlock(html, ["Language:"]);
      var cast = [];
      var names = splitNames(
        metaBlock(html, ["Starring by:", "Starring:", "Cast:"]),
      );
      for (var ci = 0; ci < names.length; ci++) {
        cast.push(new Actor({ name: names[ci] }));
      }
      var description = "";
      var dpos = Math.max(html.indexOf("Language:"), html.indexOf("Genres:"));
      if (dpos === -1) dpos = 0;
      for (var da = 0; da < 12; da++) {
        var ps = html.indexOf("<p>", dpos);
        if (ps === -1) break;
        var pe = html.indexOf("</p>", ps);
        if (pe === -1) break;
        var chunk = html.substring(ps + 3, pe);
        var plain = stripTags(chunk);
        if (plain.length > 60 && chunk.indexOf("href=") === -1) {
          description = plain;
          break;
        }
        dpos = pe + 4;
      }
      var hosters = parseHosters(html, b);
      if (!hosters.length) {
        return cb({
          success: false,
          errorCode: "LOAD_NO_STREAMS",
          message: "No streaming hosters found (torrents excluded)",
        });
      }
      var payload = b64encodeJson({
        page: url,
        title: title,
        hosters: hosters,
      });
      var itemData = {
        title: title,
        url: url,
        type: isSeries(rawTitle) ? "series" : "movie",
        episodes: [
          new Episode({
            name:
              "Watch" +
              (hosters.length > 1 ? " (" + hosters.length + " sources)" : ""),
            url: "mrz:" + payload,
          }),
        ],
      };
      if (poster) itemData.posterUrl = poster;
      if (description) itemData.description = description;
      var yr = yearOf(rawTitle);
      if (yr) itemData.year = yr;
      if (genres.length) itemData.genres = genres;
      if (cast.length) itemData.cast = cast;
      if (director) itemData.director = director;
      if (language) itemData.language = language;
      itemData.headers = stdHeaders(b + "/");
      cb({ success: true, data: new MultimediaItem(itemData) });
    } catch (e) {
      cb({
        success: false,
        errorCode: "LOAD_ERROR",
        message: String((e && e.message) || e),
      });
    }
  }

  function dispatchHoster(label, embedUrl, referer) {
    var key = (
      String(label || "") +
      " " +
      String(embedUrl || "")
    ).toLowerCase();
    for (var i = 0; i < ROUTES.length; i++) {
      if (ROUTES[i].re.test(key)) {
        try {
          return ROUTES[i].run(embedUrl, referer);
        } catch (e) {
          return Promise.resolve([]);
        }
      }
    }
    try {
      return resolveFilelions(embedUrl, referer).then(function (r) {
        if (r && r.length) return r;
        return resolveStreamlare(embedUrl, referer);
      });
    } catch (e) {
      return Promise.resolve([]);
    }
  }

  function streamSource(label, quality, size) {
    var s = "[5MRZ] " + label;
    if (quality) s += " • " + quality;
    if (size) s += " • " + size;
    return s;
  }

  async function loadStreams(url, cb) {
    try {
      var entries = [];
      var referer = BASE_URL + "/";
      var um = /^mrz:(.+)$/.exec(url || "");
      if (um) {
        try {
          var payload = b64decodeJson(um[1]);
          if (
            payload &&
            typeof payload.page === "string" &&
            payload.page.indexOf("http") === 0
          ) {
            referer = cleanHref(payload.page).replace(/[\r\n]/g, "");
          }
          if (payload && Array.isArray(payload.hosters)) {
            entries = payload.hosters.filter(function (e) {
              return (
                e &&
                typeof e.url === "string" &&
                e.url.indexOf("http") === 0 &&
                !/^(javascript|data|vbscript|file):/i.test(e.url)
              );
            });
          }
        } catch (e) {
          return cb({
            success: false,
            errorCode: "STREAM_PAYLOAD",
            message: "Bad episode payload",
          });
        }
      } else if (url && url.indexOf("http") === 0) {
        entries = [{ label: "Direct", url: url }];
      } else {
        return cb({
          success: false,
          errorCode: "STREAM_PAYLOAD",
          message: "Unsupported stream URL",
        });
      }
      var settled = await Promise.all(
        entries.map(function (en) {
          return dispatchHoster(en.label, en.url, referer)
            .then(function (links) {
              return { label: en.label, links: links || [] };
            })
            .catch(function () {
              return { label: en.label, links: [] };
            });
        }),
      );
      var flat = [];
      for (var i = 0; i < settled.length; i++) {
        for (var j = 0; j < settled[i].links.length; j++) {
          var lk = settled[i].links[j];
          if (lk && lk.url) {
            var q = lk.quality || "Auto";
            var sz = lk.size || "";
            flat.push({
              url: lk.url,
              quality: q,
              size: sz,
              source: streamSource(settled[i].label, q, sz),
              headers: lk.headers || stdHeaders(referer),
            });
          }
        }
      }
      flat.sort(function (a, b) {
        return qualityRank(a.quality) - qualityRank(b.quality);
      });
      var results = [];
      for (var k = 0; k < flat.length; k++) {
        results.push(
          new StreamResult({
            url: flat[k].url,
            quality: flat[k].quality,
            source: flat[k].source,
            headers: flat[k].headers,
          }),
        );
      }
      cb({ success: true, data: results });
    } catch (e) {
      cb({
        success: false,
        errorCode: "STREAM_ERROR",
        message: String((e && e.message) || e),
      });
    }
  }

  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();
