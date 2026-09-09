/* ============================================================================
 *
 *  5MovieRulz — SkyStream Gen 2 Plugin
 *  ================================
 *  Source site : https://www.5movierulz.ventures  (ONE domain only,
 *                taken from plugin.json -> manifest.baseUrl, see BASE_URL)
 *  Content     : Telugu / Hindi / Tamil / Malayalam movies
 *  Streams     : DIRECT video files only — Streamlare, Uperbox, Easysyncr,
 *                Download, Streamwish, Filelions. No torrents, no magnets.
 *
 *  HOW THIS FILE IS ORGANISED (read top to bottom):
 *  --------------------------------------------------------------------------
 *    SECTION 1  —  SHARED HELPERS
 *                   Small generic tools every part of the plugin reuses:
 *                   base URL, request headers, URL cleaning, page fetching,
 *                   quality/size parsing, P.A.C.K.E.R. unpacking and the
 *                   token-chain walker used by the file hosts.
 *
 *    SECTION 2  —  HOSTER SCRAPERS  (the scraping layer)
 *                   One self-contained resolver per video file host. Each
 *                   resolver takes an embed/page URL and returns a list of
 *                   direct playable file URLs. Nothing in this section knows
 *                   anything about the SkyStream app — pure scraping:
 *                     2A. Streamlare   — direct <source> HLS (+ API fallback)
 *                     2B. Uperbox      — 3-hop download-token chain to file
 *                     2C. Easysyncr    — 3-hop download-token chain to file
 *                     2D. Download     — "Download" button (same chain type)
 *                     2E. Streamwish   — packed-player unpack + mirror rotation
 *                     2F. Filelions    — packed "var links" HLS (VidHide family)
 *
 *    SECTION 3  —  APP FUNCTIONS  (the SkyStream layer)
 *                   The four functions the SkyStream app itself calls. They
 *                   scrape the movie site (home grids, search, details) and
 *                   fan out to the SECTION 2 scrapers to resolve streams:
 *                     3A. getHome      — 4 categories x 3 pages of posters
 *                     3B. search       — movie search across 3 endpoints
 *                     3C. load         — movie details + hoster buttons
 *                     3D. loadStreams  — direct playable streams, best first
 *
 *  DATA FLOW:
 *    getHome/search  ->  movie page URL  ->  load()  ->  episode payload
 *    (hoster buttons)  ->  loadStreams()  ->  SECTION 2 resolvers in
 *    parallel  ->  sorted StreamResult list  ->  played by the app.
 *
 * ========================================================================== */

(function () {
  /* ========================================================================
   *  SECTION 1 — SHARED HELPERS
   *  ------------------------------------------------------------------------
   *  Generic building blocks used by BOTH the scraper layer (Section 2)
   *  and the app layer (Section 3). No site-specific logic lives here.
   * ====================================================================== */

  /* ------------------------------------------------------------------------
   *  1A. Base URL — mentioned exactly ONCE in this whole file.
   *  The value comes from plugin.json ("baseUrl"), injected by the app as
   *  `manifest`. The hard-coded string is only a fallback in case the host
   *  ever fails to inject the manifest. Every fetch below reuses BASE_URL.
   * ---------------------------------------------------------------------- */
  var BASE_URL = "https://www.5movierulz.ventures";
  try {
    BASE_URL = String(manifest.baseUrl || BASE_URL).replace(/\/$/, "");
  } catch (e) {}

  /* ------------------------------------------------------------------------
   *  1B. Browser identity shared by every request the plugin makes.
   * ---------------------------------------------------------------------- */
  var UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

  /* ------------------------------------------------------------------------
   *  1C. Request headers builder.
   *  Every HTTP call carries a desktop User-Agent, a Referer and a
   *  keep-alive hint. `origin` is only attached when the caller passes one
   *  (file hosts check Origin; the movie site does not need it).
   * ---------------------------------------------------------------------- */
  function httpHeaders(referer, origin) {
    var h = {
      "User-Agent": UA,
      Referer: referer,
      Connection: "keep-alive",
    };
    if (origin) h["Origin"] = origin;
    return h;
  }

  function siteHeaders(ref) {
    return httpHeaders(ref || BASE_URL + "/");
  }

  /* ------------------------------------------------------------------------
   *  1D. URL cleaning + resolving.
   *  The movie site litters href attributes with raw \r / \n / spaces and
   *  &amp; entities, so every URL is scrubbed before use. cleanUrl() strips
   *  the junk; resolveUrl() additionally turns site-relative paths into
   *  absolute URLs against a base; abs() does the same via the URL parser
   *  for hoster pages.
   * ---------------------------------------------------------------------- */
  function cleanUrl(u) {
    if (!u) return "";
    return String(u)
      .replace(/[\r\n\t ]/g, "")
      .trim()
      .replace(/&amp;/g, "&");
  }

  function resolveUrl(href, b) {
    href = cleanUrl(href);
    if (!href) return "";
    if (href.indexOf("http") === 0) return href;
    if (href.charAt(0) === "/") return b + href;
    return b + "/" + href;
  }

  function abs(href, base) {
    href = cleanUrl(href);
    if (!href) return "";
    if (href.indexOf("http") === 0) return href;
    try {
      return new URL(href, base).toString();
    } catch (e) {
      return "";
    }
  }

  /* ------------------------------------------------------------------------
   *  1E. Safety gate for outgoing URLs.
   *  Only public http(s) hosts are ever fetched. This blocks divisas such as
   *  javascript:/data: links and private-network addresses even if a
   *  compromised mirror ever serves one.
   * ---------------------------------------------------------------------- */
  var PRIVATE_HOST =
    /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\]|fc00:|fe80:)/i;

  function isPublicHttp(u) {
    try {
      var h = new URL(u).hostname.toLowerCase();
      return (
        (u.indexOf("https://") === 0 || u.indexOf("http://") === 0) &&
        !PRIVATE_HOST.test(h)
      );
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------------------------------------------------
   *  1F. Page fetching.
   *  fetchHtml() performs ONE GET and always resolves to a string ("" on
   *  any failure — callers never have to try/catch it). fetchSeq() fetches
   *  a list one after another. fetchAll() fetches a whole list in ONE
   *  parallel batch via the host's http_parallel bridge (used for the 12
   *  home-page requests and the 3 search endpoints), falling back to
   *  sequential fetching where the bridge is unavailable.
   * ---------------------------------------------------------------------- */
  async function fetchHtml(url, headers) {
    try {
      var res = await http_get(url, headers);
      if (!res || typeof res.body !== "string") return "";
      return res.body;
    } catch (e) {
      return "";
    }
  }

  function fetchText(url, ref) {
    return fetchHtml(url, siteHeaders(ref));
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
      return { url: u, headers: siteHeaders(ref) };
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

  /* ------------------------------------------------------------------------
   *  1G. Quality + size parsing for stream labels.
   *  parseQuality() reads an explicit resolution token out of a file name
   *  ("...720p...", "...1080p...") and parseSize() reads a file size
   *  ("700MB", "781.72 MB"). qualityRank() orders qualities best-first so
   *  loadStreams() can sort the final list. pageTitle() grabs <title>.
   * ---------------------------------------------------------------------- */
  function parseQuality(s) {
    var t = String(s || "").toLowerCase();
    if (/(4k|2160p|uhd)/.test(t)) return "2160p";
    if (/1080p/.test(t)) return "1080p";
    if (/720p/.test(t)) return "720p";
    if (/480p/.test(t)) return "480p";
    return "";
  }

  function parseSize(s) {
    var m = /(\d+(?:\.\d+)?)\s*(mb|gb)/i.exec(String(s || ""));
    return m ? m[1] + m[2].toUpperCase() : "";
  }

  var QUALITY_RANK = {
    "2160p": 0,
    "1080p": 1,
    "720p": 2,
    "480p": 3,
    hd: 4,
    auto: 5,
  };

  function qualityRank(q) {
    var r = QUALITY_RANK[String(q || "").toLowerCase()];
    return r === undefined ? 4 : r;
  }

  function pageTitle(html) {
    var m = /<title>([^<]+)<\/title>/i.exec(html || "");
    return m ? m[1].replace(/\s+/g, " ").trim() : "";
  }

  /* ------------------------------------------------------------------------
   *  1H. Token-chain walker (Uperbox / Easysyncr / Download button).
   *  These file hosts all work the same way:
   *      landing page  ->  ".../download?token=A"  ->  "/dl?code=..&token=B"
   *  and that final /dl URL *IS* the video file (it is returned, never
   *  fetched here — fetching it would download the movie). Resolves fresh
   *  on every call because the tokens are single-use and short-lived.
   * ---------------------------------------------------------------------- */
  async function followTokenChain(pageUrl, referer) {
    var host = "";
    try {
      host = new URL(pageUrl).origin;
    } catch (e) {
      return null;
    }
    var landing = await fetchHtml(
      pageUrl,
      httpHeaders(referer || host + "/", host),
    );
    if (!landing) return null;
    var result = {
      host: host,
      landing: landing,
      title: pageTitle(landing),
      dlPage: "",
      page: "",
      fileUrl: "",
    };
    var m1 = /href=["']([^"']*\/download\?token=[^"']+)["']/i.exec(landing);
    result.dlPage = abs(m1 && m1[1], pageUrl);
    if (!isPublicHttp(result.dlPage)) return result;
    result.page = await fetchHtml(result.dlPage, httpHeaders(pageUrl, host));
    var m2 = /href=["']([^"']*\/dl\?code=[^"']+)["']/i.exec(result.page);
    result.fileUrl = abs(m2 && m2[1], result.dlPage);
    if (!isPublicHttp(result.fileUrl)) result.fileUrl = "";
    return result;
  }

  /* ------------------------------------------------------------------------
   *  1I. P.A.C.K.E.R. unpacker (Streamwish / Filelions player pages).
   *  Those hosts hide their stream URLs inside eval-packed JavaScript.
   *  unpackWithBridge() first asks the host app's native getAndUnpack
   *  bridge, then falls back to the embedded pure-string unpacker below
   *  (no eval is ever executed — packed text is only decoded, then the
   *  URLs are pulled out with plain regexes in Section 2).
   * ---------------------------------------------------------------------- */
  var PACKER_RE =
    /eval\(function\(p,a,c,k,e,d?\)[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/g;

  var PACKER_ALPHA =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

  function packerBaseN(num, base) {
    if (num === 0) return "0";
    var s = "";
    while (num > 0 && s.length < 12) {
      s = PACKER_ALPHA[num % base] + s;
      num = Math.floor(num / base);
    }
    return s;
  }

  function unpackPacker(body) {
    var src = String(body || "").slice(0, 500000);
    PACKER_RE.lastIndex = 0;
    var out = [];
    var m;
    var rounds = 0;
    while ((m = PACKER_RE.exec(src)) !== null && rounds < 10) {
      rounds++;
      var p0 = m[1];
      var a = parseInt(m[2], 10);
      var c = parseInt(m[3], 10);
      var k = m[4].split("|");
      if (!(a >= 2 && a <= 62) || !(c >= 0 && c <= 2000) || !k.length) continue;
      var p = p0;
      for (var i = c - 1; i >= 0; i--) {
        if (k[i]) {
          var rep = k[i];
          p = p.replace(
            new RegExp("\\b" + packerBaseN(i, a) + "\\b", "g"),
            function () {
              return rep;
            },
          );
        }
      }
      out.push(p);
    }
    return out.join("\n");
  }

  function unpackWithBridge(body) {
    var code = String(body || "");
    try {
      if (typeof getAndUnpack === "function") {
        var unpacked = getAndUnpack(code);
        if (unpacked && unpacked !== code) code = code + "\n" + unpacked;
      }
    } catch (e) {
      code = String(body || "");
    }
    var local = unpackPacker(code);
    if (local) code = code + "\n" + local;
    return code;
  }

  /* ========================================================================
   *  SECTION 2 — HOSTER SCRAPERS  (the scraping layer)
   *  ------------------------------------------------------------------------
   *  One resolver per video file host. CONTRACT (same for all six):
   *    input   : embed/page URL + the movie-page URL (sent as Referer)
   *    output  : Promise of [{ url, quality, size?, headers }]
   *              url     = DIRECT playable file URL (http(s) only)
   *              quality = "2160p" | "1080p" | "720p" | "480p" | "HD" | "Auto"
   *              size    = e.g. "700MB" (only when the host shows one)
   *              headers = Referer/Origin/UA the player must send
   *    failure : ALWAYS resolves to [] — never throws, so one dead hoster
   *              can never break the other five.
   *  Scraper 2B/2C/2D additionally set singleUse: true — their tokens burn
   *  on first use, so Section 3 sorts them after the re-playable HLS links
   *  and the app's health probe never touches them.
   * ====================================================================== */

  /* ------------------------------------------------------------------------
   *  SCRAPER 2A — Streamlare  (embed on ww*.vcdnlare.com)
   *  The embed page contains a plain <video><source src="...m3u8"> tag, so
   *  one GET is enough. If scraping finds nothing AND the URL belongs to
   *  streamlare.com/slmaxed.com, it falls back to their JSON video API.
   * ---------------------------------------------------------------------- */
  var STREAMLARE_RES = [
    /<source[^>]+src="([^"]+)"/gi,
    /file\s*:\s*["'](https?:\/\/[^"']+)["']/gi,
    /(https?:\/\/[^\s"'<>]+\.(m3u8|mp4)[^\s"'<>]*)/gi,
  ];

  var STREAMLARE_ASSETS = /\.(png|jpe?g|gif|webp|svg|css|js|vtt|srt)(\?|#|$)/i;

  async function resolveStreamlare(embedUrl, referer) {
    var url = cleanUrl(embedUrl);
    if (!isPublicHttp(url)) return [];
    var origin = "";
    try {
      origin = new URL(url).origin;
    } catch (e) {
      return [];
    }
    var headers = httpHeaders(referer || origin + "/", origin);
    var html = await fetchHtml(url, headers);
    if (!html) return [];
    var out = [];
    for (var p = 0; p < STREAMLARE_RES.length; p++) {
      STREAMLARE_RES[p].lastIndex = 0;
      var m;
      while ((m = STREAMLARE_RES[p].exec(html)) !== null) {
        var u = cleanUrl(m[1]);
        if (!isPublicHttp(u) || STREAMLARE_ASSETS.test(u)) continue;
        var dup = false;
        for (var i = 0; i < out.length; i++) if (out[i].url === u) dup = true;
        if (dup) continue;
        out.push({
          url: u,
          quality: /(\.m3u8|\/hls\/)/i.test(u) ? "Auto" : "HD",
          headers: headers,
        });
      }
      if (out.length) return out;
    }
    return streamlareApi(url, headers);
  }

  async function streamlareApi(url, headers) {
    var out = [];
    var apiBase = "";
    try {
      var host = new URL(url).hostname.toLowerCase();
      if (host === "streamlare.com" || host.endsWith(".streamlare.com")) {
        apiBase = "https://streamlare.com/";
      } else if (host === "slmaxed.com" || host.endsWith(".slmaxed.com")) {
        apiBase = "https://slmaxed.com/";
      } else {
        return out;
      }
    } catch (e) {
      return out;
    }
    var idMatch = /\/(e|v)\/([^\/?#]+)/.exec(url);
    if (!idMatch) return out;
    var payload = "";
    try {
      var res = await http_post(
        apiBase + "api/video/stream/get",
        {
          "User-Agent": headers["User-Agent"],
          Referer: url,
          Origin: apiBase.replace(/\/$/, ""),
          "Content-Type": "application/json",
          Connection: "keep-alive",
        },
        JSON.stringify({ id: idMatch[2] }),
      );
      if (!res || typeof res.body !== "string") return out;
      payload = res.body;
    } catch (e) {
      return out;
    }
    var fileRe = /"file"\s*:\s*"([^"]+)"/g;
    var labelRe = /"label"\s*:\s*"([^"]*)"/g;
    var files = [];
    var labels = [];
    var fm;
    while ((fm = fileRe.exec(payload)) !== null) files.push(fm[1]);
    while ((fm = labelRe.exec(payload)) !== null) labels.push(fm[1]);
    for (var i = 0; i < files.length; i++) {
      var u = cleanUrl(files[i]);
      if (!isPublicHttp(u)) continue;
      var lm = /(\d{3,4})p/.exec(labels[i] || "");
      out.push({
        url: u,
        quality: lm ? lm[1] + "p" : "Auto",
        headers: httpHeaders(url, apiBase.replace(/\/$/, "")),
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------------
   *  SCRAPER 2B — Uperbox  (page on www.uperbox.net/.io/.com/.cx)
   *  Walks the site's 3-hop chain (landing -> download?token -> dl file)
   *  via the shared Section 1H walker. Bare uperbox.TLD hosts are rewritten
   *  to their www. form first. Reads quality + size out of the file name.
   * ---------------------------------------------------------------------- */
  var UPER_TLDS = ["net", "io", "com", "cx"];

  function normalizeUperbox(pageUrl) {
    try {
      var u = new URL(pageUrl);
      var parts = u.hostname.toLowerCase().split(".");
      if (
        parts.length === 2 &&
        parts[0] === "uperbox" &&
        UPER_TLDS.indexOf(parts[1]) !== -1
      ) {
        u.hostname = "www." + u.hostname;
        return u.toString();
      }
    } catch (e) {}
    return pageUrl;
  }

  async function resolveUperbox(embedUrl, referer) {
    var pageUrl = normalizeUperbox(cleanUrl(embedUrl));
    if (!isPublicHttp(pageUrl)) return [];
    var hop = await followTokenChain(pageUrl, referer);
    if (!hop || !hop.fileUrl) return [];
    return [
      {
        url: hop.fileUrl,
        quality: parseQuality(hop.title) || "HD",
        size: parseSize(hop.title),
        singleUse: true,
        headers: httpHeaders(hop.dlPage, hop.host),
      },
    ];
  }

  /* ------------------------------------------------------------------------
   *  SCRAPER 2C — Easysyncr  (page on www.easysyncr.me / .io)
   *  Same 3-hop chain shape as Uperbox, resolved by the shared Section 1H
   *  walker. Prefers the measured size printed on the analyzing page
   *  ("781.72 MB") over the size guessed from the file name.
   * ---------------------------------------------------------------------- */
  async function resolveEasysyncr(embedUrl, referer) {
    var pageUrl = cleanUrl(embedUrl);
    if (!isPublicHttp(pageUrl)) return [];
    var hop = await followTokenChain(pageUrl, referer);
    if (!hop || !hop.fileUrl) return [];
    var measured = /(\d+\.\d+)\s*MB/.exec(hop.page || "");
    return [
      {
        url: hop.fileUrl,
        quality: parseQuality(hop.title) || "HD",
        size: measured ? measured[1] + "MB" : parseSize(hop.title),
        singleUse: true,
        headers: httpHeaders(hop.dlPage, hop.host),
      },
    ];
  }

  /* ------------------------------------------------------------------------
   *  SCRAPER 2D — Download button  (points at an Easysyncr file page)
   *  The "Download" button on the movie page leads to a file-host landing
   *  page, so: already-a-file  ->  return as-is; token chain  ->  resolve
   *  it like 2C; anything else  ->  first direct file link on the page.
   * ---------------------------------------------------------------------- */
  var DOWNLOAD_DIRECT = /\.(mp4|mkv|avi|mov|m3u8)(\?|#|$)/i;
  var DOWNLOAD_LINK = /href=["']([^"']+\.(mp4|mkv|avi|mov|m3u8)[^"']*)["']/i;

  async function resolveDownload(embedUrl, referer) {
    var pageUrl = cleanUrl(embedUrl);
    if (!isPublicHttp(pageUrl)) return [];
    var host = "";
    try {
      host = new URL(pageUrl).origin;
    } catch (e) {
      return [];
    }
    var pageHeaders = httpHeaders(referer || host + "/", host);
    if (DOWNLOAD_DIRECT.test(pageUrl)) {
      return [
        {
          url: pageUrl,
          quality: /\.m3u8/i.test(pageUrl)
            ? "Auto"
            : parseQuality(pageUrl) || "HD",
          size: parseSize(pageUrl),
          headers: pageHeaders,
        },
      ];
    }
    var hop = await followTokenChain(pageUrl, referer);
    if (hop && hop.fileUrl) {
      var measured = /(\d+\.\d+)\s*MB/.exec(hop.page || "");
      return [
        {
          url: hop.fileUrl,
          quality: parseQuality(hop.title) || "HD",
          size: measured ? measured[1] + "MB" : parseSize(hop.title),
          singleUse: true,
          headers: httpHeaders(hop.dlPage, hop.host),
        },
      ];
    }
    var landing =
      (hop && hop.landing) || (await fetchHtml(pageUrl, pageHeaders));
    var m = DOWNLOAD_LINK.exec(landing);
    var fileUrl = abs(m && m[1], pageUrl);
    if (!isPublicHttp(fileUrl)) return [];
    return [
      {
        url: fileUrl,
        quality: /\.m3u8/i.test(fileUrl)
          ? "Auto"
          : parseQuality(fileUrl) || "HD",
        size: parseSize(pageTitle(landing)),
        headers: pageHeaders,
      },
    ];
  }

  /* ------------------------------------------------------------------------
   *  SCRAPER 2E — Streamwish  (hglink.to / hgcloud.to / wish mirrors)
   *  Ports the ResolveURL streamwish resolver: links routed through the
   *  rule hosts are re-pointed at working wish mirrors (/e/<id>), each
   *  candidate page is unpacked (Section 1I) and scanned for sources /
   *  hls URLs. Best-effort and fail-soft — hglink sometimes serves a
   *  browser-only challenge page, which is simply skipped.
   * ---------------------------------------------------------------------- */
  var WISH_RULE_HOSTS = ["dhcplay.com", "hglink.to", "hgcloud.to"];
  var WISH_RULE_MIRRORS = [
    "hanerix.com",
    "audinifer.com",
    "vibuxer.com",
    "masukestin.com",
    "streamhls.to",
    "wishfast.top",
  ];
  var WISH_DMCA_MIRRORS = [
    "hgplaycdn.com",
    "hglamioz.com",
    "niramirus.com",
    "playnixes.com",
    "medixiru.com",
    "streamwish.to",
    "strwish.xyz",
    "hlswish.com",
    "kswplayer.info",
    "nekowish.my.id",
    "multimovies.cloud",
    "katomen.store",
    "gradehgplus.com",
    "stbhg.click",
    "sfastwish.com",
    "playerwish.com",
  ];

  var WISH_SRC_RE =
    /sources\s*:\s*\[\s*\{\s*file\s*:\s*["'](https?:\/\/[^"']+)["']/gi;
  var WISH_HLS_RE = /"hls[24]"\s*:\s*"((?:https?:)?\/\/[^"]+)"/gi;
  var WISH_FILE_RE =
    /file\s*:\s*["'](https?:\/\/[^"']+\.(m3u8|mp4)[^"']*)["']/gi;
  var WISH_ASSETS = /\.(png|jpe?g|gif|webp|svg|css|js|vtt|srt)(\?|#|$)/i;

  async function resolveStreamwish(embedUrl, referer) {
    var pageUrl = cleanUrl(embedUrl);
    if (!isPublicHttp(pageUrl)) return [];
    var idMatch =
      /\/(e|f|d)\/([A-Za-z0-9]+)/.exec(pageUrl) ||
      /\/([A-Za-z0-9]{6,})[\/?#]?$/.exec(pageUrl);
    var mediaId = idMatch ? idMatch[idMatch.length - 1] : "";
    var host = "";
    try {
      host = new URL(pageUrl).hostname.toLowerCase();
    } catch (e) {
      return [];
    }
    var pool =
      WISH_RULE_HOSTS.indexOf(host) !== -1
        ? WISH_RULE_MIRRORS
        : WISH_DMCA_MIRRORS;
    var candidates = [pageUrl];
    if (mediaId) {
      for (var i = 0; i < pool.length; i++) {
        candidates.push("https://" + pool[i] + "/e/" + mediaId);
      }
    }
    var out = [];
    var push = function (u, headers) {
      u = cleanUrl(u);
      if (u.indexOf("//") === 0) u = "https:" + u;
      if (!isPublicHttp(u) || WISH_ASSETS.test(u)) return;
      for (var k = 0; k < out.length; k++) if (out[k].url === u) return;
      out.push({
        url: u,
        quality: /\.m3u8/i.test(u) ? "Auto" : "HD",
        headers: headers,
      });
    };
    for (var c = 0; c < candidates.length; c++) {
      var origin = "";
      try {
        origin = new URL(candidates[c]).origin;
      } catch (e) {
        continue;
      }
      var headers = httpHeaders(referer || origin + "/", origin);
      var body = await fetchHtml(candidates[c], headers);
      if (!body) continue;
      if (body.indexOf("Page is loading") !== -1 && body.length < 3000)
        continue;
      var code = unpackWithBridge(body);
      var res = [WISH_SRC_RE, WISH_HLS_RE, WISH_FILE_RE];
      for (var r = 0; r < res.length; r++) {
        res[r].lastIndex = 0;
        var m;
        while ((m = res[r].exec(code)) !== null) push(m[1], headers);
      }
      if (out.length) return out;
    }
    return out;
  }

  /* ------------------------------------------------------------------------
   *  SCRAPER 2F — Filelions  (VidHide family: callistanise, minochinos…)
   *  Ports the ResolveURL filelions resolver: dead VidHide domains are
   *  remapped to callistanise.com, the page is unpacked (Section 1I) and
   *  the "var links" map is read preferring hls4 > hls3 > hls2. Relative
   *  /stream/... paths are absolutized and carry the embed page as Referer.
   * ---------------------------------------------------------------------- */
  var LIONS_DEAD = [
    "filelions.com",
    "filelions.to",
    "filelions.live",
    "filelions.xyz",
    "filelions.online",
    "filelions.site",
    "filelions.co",
    "ajmidyadfihayh.sbs",
    "alhayabambi.sbs",
    "vidhideplus.com",
    "vidhidepro.com",
    "vidhidevip.com",
    "vidhidepre.com",
    "vidhidefun.com",
    "vidhidefast.com",
    "azipcdn.com",
    "mlions.pro",
    "alions.pro",
    "dlions.pro",
    "mivalyo.com",
    "motvy55.store",
    "lumiawatch.top",
    "fviplions.com",
    "egsyxutd.sbs",
    "e4xb5c2xnz.sbs",
    "taylorplayer.com",
    "ryderjet.com",
    "techradar.ink",
    "anime7u.com",
    "coolciima.online",
    "gsfomqu.sbs",
    "bingezove.com",
    "katomen.online",
    "6sfkrspw4u.sbs",
    "dingtezuni.com",
    "dinisglows.com",
    "dintezuvio.com",
    "vidhide.com",
    "minochinos.com",
  ];
  var LIONS_LINKS_RE = /var\s+links\s*=\s*(\{[^}]+\})/g;
  var LIONS_SRC_RE = /sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/gi;
  var LIONS_HLS_ORDER = ["hls4", "hls3", "hls2"];

  async function resolveFilelions(embedUrl, referer) {
    var pageUrl = cleanUrl(embedUrl);
    if (!isPublicHttp(pageUrl)) return [];
    var u;
    try {
      u = new URL(pageUrl);
    } catch (e) {
      return [];
    }
    var host = u.hostname.toLowerCase();
    for (var i = 0; i < LIONS_DEAD.length; i++) {
      if (host === LIONS_DEAD[i] || host.endsWith("." + LIONS_DEAD[i])) {
        host = "callistanise.com";
        break;
      }
    }
    var target = "https://" + host + u.pathname + (u.search || "");
    var html = await fetchHtml(
      target,
      httpHeaders(referer || "https://" + host + "/", "https://" + host),
    );
    if (!html) return [];
    var code = unpackWithBridge(html);
    var streamHeaders = httpHeaders(target, "https://" + host);
    var out = [];
    var push = function (link) {
      link = cleanUrl(link);
      if (!link) return;
      if (link.indexOf("//") === 0) link = "https:" + link;
      else if (link.charAt(0) === "/") link = "https://" + host + link;
      if (!isPublicHttp(link)) return;
      for (var k = 0; k < out.length; k++) if (out[k].url === link) return;
      out.push({ url: link, quality: "Auto", headers: streamHeaders });
    };
    LIONS_LINKS_RE.lastIndex = 0;
    var lm;
    while ((lm = LIONS_LINKS_RE.exec(code)) !== null) {
      for (var h = 0; h < LIONS_HLS_ORDER.length; h++) {
        var km = new RegExp(
          '"' + LIONS_HLS_ORDER[h] + '"\\s*:\\s*"([^"]+)"',
        ).exec(lm[1]);
        if (km) push(km[1]);
      }
    }
    if (out.length) return out;
    LIONS_SRC_RE.lastIndex = 0;
    var sm;
    while ((sm = LIONS_SRC_RE.exec(code)) !== null) push(sm[1]);
    return out;
  }

  /* ========================================================================
   *  SECTION 3 — APP FUNCTIONS  (the SkyStream layer)
   *  ------------------------------------------------------------------------
   *  These four functions are ALL the app ever calls. They scrape the movie
   *  SITE (categories, search, details) and hand hoster URLs to the
   *  Section 2 scrapers above. 3A/3B/3C fetch site pages; 3D fans out to
   *  every hoster resolver in parallel and returns the sorted stream list.
   * ====================================================================== */

  /* ------------------------------------------------------------------------
   *  3.0  Home-page category map.
   *  THE 4 categories live here and ONLY here: the site path per category
   *  plus the 3 pages merged into each one (user requirement: 3 pages of
   *  posters inside a single category).
   * ---------------------------------------------------------------------- */
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

  /* ------------------------------------------------------------------------
   *  3.0  Hoster dispatch table.
   *  Matches a hoster button (label + URL, lower-cased) to its Section 2
   *  scraper, in priority order. Anything unrecognised falls through to a
   *  generic unpack-then-source attempt. Every branch is fail-soft.
   * ---------------------------------------------------------------------- */
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

  /* ------------------------------------------------------------------------
   *  3.0  HTML parsing helpers for the movie site.
   *  stripTags() decodes entities BEFORE stripping tags (twice) so encoded
   *  markup can never survive as real tags. cleanTitle() trims the site's
   *  "Watch Online Free" / quality suffixes. parseGrid() reads one "boxed
   *  film" poster grid — a poster under /uploads/ is REQUIRED, which is
   *  what keeps sidebar text links out of the results. metaBlock() reads
   *  one "<p><strong>Label:</strong> …</p>" facts block (director, genres…).
   * ---------------------------------------------------------------------- */
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
      var href = cleanUrl(m[2]);
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

  function parseHosters(html, b) {
    var out = [];
    var seen = {};
    var re = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      if (m[0].indexOf("stream-link-btn") === -1) continue;
      var hm = /href=(["'])([\s\S]*?)\1/i.exec(m[0]);
      if (!hm) continue;
      var href = cleanUrl(hm[2]);
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

  function streamSource(label, quality, size) {
    var s = "[5MRZ] " + label;
    if (quality) s += " • " + quality;
    if (size) s += " • " + size;
    return s;
  }

  /* ------------------------------------------------------------------------
   *  APP FUNCTION 3A — getHome(cb)
   *  Builds the 4 home categories from HOME_CATS above. All 12 page URLs
   *  (4 categories x 3 pages) are fetched in ONE parallel batch, then each
   *  category's pages are merged, de-duplicated and capped at 60 posters.
   * ---------------------------------------------------------------------- */
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

  /* ------------------------------------------------------------------------
   *  APP FUNCTION 3B — search(query, cb)
   *  Tries the 3 known search endpoints in ONE parallel batch and returns
   *  the first batch with results. Blank queries short-circuit to [].
   *  NOTE: the site currently WAF-blocks server-side search (HTTP 403),
   *  so this fails soft to [] until their rules allow it again.
   * ---------------------------------------------------------------------- */
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

  /* ------------------------------------------------------------------------
   *  APP FUNCTION 3C — load(url, cb)
   *  Opens a movie detail page and returns full metadata (title, poster,
   *  description, year, genres, cast, director, language) plus ONE "Watch"
   *  episode. That episode's URL is an encoded payload holding the 6
   *  hoster buttons, which 3D resolves into playable streams. Torrents /
   *  magnets on the page are deliberately ignored.
   * ---------------------------------------------------------------------- */
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
        if (og) poster = cleanUrl(og[1]);
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
      itemData.headers = siteHeaders(b + "/");
      cb({ success: true, data: new MultimediaItem(itemData) });
    } catch (e) {
      cb({
        success: false,
        errorCode: "LOAD_ERROR",
        message: String((e && e.message) || e),
      });
    }
  }

  /* ------------------------------------------------------------------------
   *  APP FUNCTION 3D — loadStreams(url, cb)
   *  Decodes the episode payload from 3C (validating every field first),
   *  resolves ALL hosters CONCURRENTLY through the dispatch table above,
   *  then sorts best-first: re-playable links by quality, single-use file
   *  tokens (2B/2C/2D) always last so the app's health probe never burns
   *  them before the viewer taps. One hoster failing never affects others.
   * ---------------------------------------------------------------------- */
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
            referer = cleanUrl(payload.page).replace(/[\r\n]/g, "");
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
              rank: qualityRank(q) + (lk.singleUse ? 10 : 0),
              source: streamSource(settled[i].label, q, sz),
              headers: lk.headers || siteHeaders(referer),
            });
          }
        }
      }
      flat.sort(function (a, b) {
        return a.rank - b.rank;
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

  /* ------------------------------------------------------------------------
   *  Plugin exports — the four Section 3 functions the app calls.
   * ---------------------------------------------------------------------- */
  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();
