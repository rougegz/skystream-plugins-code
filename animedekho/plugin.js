(function () {
  /**
   * AnimeDekho source: https://animedekho.app — WordPress theme "toronites".
   *
   * Home rows (each fetched across 5 pages):
   *   Series Recent   -> /series-hindi/ pages 1-5 (HTML)
   *   Series Popular  -> admin-ajax action_search, sort=3 (popularity desc)
   *   Top 10 Today    -> /home/ .top10 carousels (series + movies, server-rendered)
   *   Crunchyroll     -> /category/crunchyroll/ pages 1-5
   *   Cartoon         -> /category/cartoon/ pages 1-5
   *   Movies Recent   -> /movie-hindi/ pages 1-5
   *   Movies Popular  -> admin-ajax action_search, sort=3, type=movie
   *
   * Streams: episode/movie page with Cookie toronites_server=vidstream exposes
   * iframe.serversel + a named server selector (base64 data-src). Resolved
   * embed URLs feed per-host extractors:
   *   as-cdn21.top / z.awstream.net (AWSStream): POST player/index.php ->
   *     master.m3u8 -> quality variants + audio languages parsed from the
   *     playlist (perfect labels: "VidStream • 720p • Hindi/Japanese").
   *   blakiteapi.xyz (MyCloud): api/get.php -> quality + format + dataId.
   *   rubystm.com (SRuby): X-Requested-With GET -> file:"..." regex.
   * JS-only hosts (VidStack/VidHidePro/VidSrc/Omega/Vidmoly/NeoCDN) are
   * skipped — they need a browser.
   */

  const BASE = "https://animedekho.app";
  const AJAX = BASE + "/wp-admin/admin-ajax.php";
  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  const COOKIE = "toronites_server=vidstream";
  const PAGES = 5; // categories fetch 5 pages
  const ROW_CAP = 60; // max items per home row
  const SEARCH_CAP = 60;

  // SSRF guard: http(s) to DNS names only. Blocks control chars, IPv6, IP
  // literals in any encoding, loopback/private/metadata hosts and internal
  // TLDs. ponytail: DNS-rebinding names can't be stopped here — the host
  // must validate resolved IPs on every fetch.
  function isSafeUrl(u) {
    if (/[\x00-\x1f\x7f]/.test(String(u))) return false;
    try {
      const p = new URL(u);
      if (p.protocol !== "http:" && p.protocol !== "https:") return false;
      const h = p.hostname.toLowerCase().replace(/\.$/, "");
      if (!h || h.includes("[") || h.includes(":")) return false;
      if (/^[0-9a-fx.]+$/i.test(h)) return false;
      if (
        h === "localhost" ||
        h.endsWith(".localhost") ||
        h.endsWith(".local") ||
        h.endsWith(".internal") ||
        h.endsWith(".home.arpa")
      )
        return false;
      if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false;
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function headers(extra) {
    return Object.assign(
      { "User-Agent": UA, Referer: BASE + "/" },
      extra || {},
    );
  }

  function abs(u, base) {
    try {
      return new URL(u, base).href;
    } catch (e) {
      return u;
    }
  }

  // ---- card parsing -------------------------------------------------------

  function decodeEntities(s) {
    return (s || "")
      .replace(/&amp;/g, "&")
      .replace(/&#0?38;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&#8217;/g, "'")
      .replace(/&#8211;/g, "-")
      .replace(/&#8212;/g, "-")
      .replace(/&#8230;/g, "...");
  }

  function cardFromHtml(h) {
    const href =
      (h.match(/<a[^>]*class="[^"]*lnk-blk[^"]*"[^>]*href="([^"]+)"/) ||
        h.match(/<a[^>]*href="([^"]+)"[^>]*class="[^"]*lnk-blk[^"]*"/) ||
        [])[1] || "";
    const img = h.match(/<img[^>]*>/);
    let poster = ((img && img[0].match(/src="([^"]+)"/)) || [])[1] || "";
    if (poster.startsWith("data:image")) {
      poster =
        ((img && img[0].match(/data-lazy-src="([^"]+)"/)) || [])[1] || "";
    }
    const alt = ((img && img[0].match(/alt="([^"]*)"/)) || [])[1] || "";
    const h2 = (h.match(/<h2[^>]*>([^<]*)<\/h2>/) || [])[1] || "";
    const year = (h.match(/<span class="year">([^<]+)<\/span>/) || [])[1] || "";
    let title = h2.trim();
    if (!title || title.toLowerCase().includes("animedekho")) {
      title = alt.trim();
    }
    title = decodeEntities(title);
    if (!title) {
      // slug fallback: last path segment, dashes -> spaces
      const slug = (href.split("/").filter(Boolean).pop() || "").replace(
        /-/g,
        " ",
      );
      title = slug.charAt(0).toUpperCase() + slug.slice(1);
    }
    return { href, poster, title, year };
  }

  // app runtime returns {text, html, attr}; cli test runtime returns innerHTML
  function htmlOf(el) {
    return (el && (el.html || el.innerHTML)) || "";
  }

  async function parseCards(html) {
    const cards = await parse_html(html, "article", null);
    const out = [];
    for (const c of cards || []) {
      const card = cardFromHtml(htmlOf(c));
      if (!card.href) continue;
      out.push(card);
    }
    return out;
  }

  // ---- listing fetchers ---------------------------------------------------

  async function fetchListing(url) {
    const res = await http_get(url, headers());
    if (!res || !res.body) return [];
    return parseCards(res.body);
  }

  function nonceFrom(html) {
    const m =
      html.match(/"nonce"\s*:\s*"([^"]+)"/) ||
      html.match(/"_wpsearch"\s*:\s*"([^"]+)"/);
    return m ? m[1] : "";
  }

  async function fetchPopular(type, page, nonce, referer) {
    const vars = JSON.stringify({
      _wpsearch: nonce,
      taxonomy: "none",
      search: "none",
      term: "none",
      type: type,
      genres: [],
      years: [],
      sort: 3,
      page: page,
    });
    const res = await http_post(
      AJAX,
      headers({
        "Content-Type": "application/x-www-form-urlencoded",
        "X-WP-Nonce": nonce,
        "X-Requested-With": "XMLHttpRequest",
        Referer: referer,
      }),
      "action=action_search&vars=" + encodeURIComponent(vars),
    );
    if (!res || !res.body) return [];
    let json;
    try {
      json = JSON.parse(res.body);
    } catch (e) {
      return [];
    }
    if (!json.html) return [];
    return parseCards(json.html);
  }

  function toItem(card) {
    const poster = isSafeUrl(card.poster) ? card.poster : "";
    return new MultimediaItem({
      title: card.title || "Untitled",
      url: card.href,
      posterUrl: poster,
      type: card.href.includes("/movie-hindi/") ? "movie" : "series",
      year: parseInt(card.year, 10) || undefined,
    });
  }

  // ---- getHome ------------------------------------------------------------

  async function getHome(cb) {
    try {
      const rows = {};
      const listingUrls = {
        "Series Recent": BASE + "/series-hindi/",
        "Movies Recent": BASE + "/movie-hindi/",
        Crunchyroll: BASE + "/category/crunchyroll/",
        Cartoon: BASE + "/category/cartoon/",
      };
      const reqs = [{ url: BASE + "/home/", headers: headers() }];
      for (const name of Object.keys(listingUrls)) {
        for (let p = 1; p <= PAGES; p++) {
          reqs.push({
            url:
              p === 1
                ? listingUrls[name]
                : listingUrls[name] + "page/" + p + "/",
            headers: headers(),
          });
        }
      }
      const resps = await http_parallel(reqs);
      const byUrl = {};
      resps.forEach((r, i) => {
        byUrl[reqs[i].url] = r;
      });

      // Top 10 Today from the home page (.top10 carousels, series + movies)
      const homeRes = byUrl[reqs[0].url];
      if (homeRes && homeRes.body) {
        const top = await parse_html(homeRes.body, ".top10 article", null);
        const seen = new Set();
        const items = [];
        for (const c of top || []) {
          const card = cardFromHtml(htmlOf(c));
          if (!card.href || seen.has(card.href)) continue;
          seen.add(card.href);
          items.push(toItem(card));
        }
        if (items.length) rows["Top 10 Today"] = items.slice(0, ROW_CAP);
      }

      // Recent + category rows from plain HTML pages
      for (const name of Object.keys(listingUrls)) {
        const items = [];
        for (let p = 1; p <= PAGES; p++) {
          const url =
            p === 1 ? listingUrls[name] : listingUrls[name] + "page/" + p + "/";
          const res = byUrl[url];
          if (!res || !res.body) continue;
          const cards = await parseCards(res.body);
          for (const c of cards) items.push(toItem(c));
          if (items.length >= ROW_CAP) break;
        }
        if (items.length) rows[name] = items.slice(0, ROW_CAP);
      }

      // Popular rows via ajax (sort=3 popularity desc). Nonce comes from the
      // page-1 HTML already fetched above.
      const seriesP1 = byUrl[listingUrls["Series Recent"]];
      const moviesP1 = byUrl[listingUrls["Movies Recent"]];
      const seriesNonce =
        seriesP1 && seriesP1.body ? nonceFrom(seriesP1.body) : "";
      const moviesNonce =
        moviesP1 && moviesP1.body ? nonceFrom(moviesP1.body) : "";
      if (seriesNonce) {
        const items = [];
        for (let p = 1; p <= PAGES && items.length < ROW_CAP; p++) {
          const cards = await fetchPopular(
            "series",
            p,
            seriesNonce,
            listingUrls["Series Recent"],
          );
          for (const c of cards) items.push(toItem(c));
        }
        if (items.length) rows["Series Popular"] = items.slice(0, ROW_CAP);
      }
      if (moviesNonce) {
        const items = [];
        for (let p = 1; p <= PAGES && items.length < ROW_CAP; p++) {
          const cards = await fetchPopular(
            "movie",
            p,
            moviesNonce,
            listingUrls["Movies Recent"],
          );
          for (const c of cards) items.push(toItem(c));
        }
        if (items.length) rows["Movies Popular"] = items.slice(0, ROW_CAP);
      }

      cb({ success: true, data: rows });
    } catch (e) {
      cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
    }
  }

  // ---- search -------------------------------------------------------------

  async function search(query, cb) {
    try {
      const q = String(query || "").trim();
      if (!q) return cb({ success: true, data: [] });
      const items = [];
      const res = await http_get(
        BASE + "/?s=" + encodeURIComponent(q),
        headers(),
      );
      if (res && res.body) {
        const cards = await parseCards(res.body);
        for (const c of cards) items.push(toItem(c));
        const nonce = nonceFrom(res.body);
        if (nonce) {
          for (let p = 2; p <= 3 && items.length < SEARCH_CAP; p++) {
            const vars = JSON.stringify({
              _wpsearch: nonce,
              taxonomy: "none",
              search: q,
              season: "none",
              type: "mixed",
              genres: [],
              years: [],
              sort: "1",
              page: p,
            });
            const r = await http_post(
              AJAX,
              headers({
                "Content-Type": "application/x-www-form-urlencoded",
                "X-WP-Nonce": nonce,
                "X-Requested-With": "XMLHttpRequest",
                Referer: BASE + "/?s=" + encodeURIComponent(q),
              }),
              "action=action_search&vars=" + encodeURIComponent(vars),
            );
            if (!r || !r.body) break;
            let json;
            try {
              json = JSON.parse(r.body);
            } catch (e) {
              break;
            }
            if (!json.html) break;
            const more = await parseCards(json.html);
            for (const c of more) items.push(toItem(c));
          }
        }
      }
      cb({ success: true, data: items.slice(0, SEARCH_CAP) });
    } catch (e) {
      cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
    }
  }

  // ---- load ---------------------------------------------------------------

  async function load(url, cb) {
    try {
      if (!isSafeUrl(url)) {
        return cb({
          success: false,
          errorCode: "NOT_FOUND",
          message: "Invalid URL",
        });
      }
      const res = await http_get(url, headers());
      if (!res || !res.body) {
        return cb({
          success: false,
          errorCode: "SITE_OFFLINE",
          message: "Empty page",
        });
      }
      const html = res.body;
      let title =
        (html.match(/<h1[^>]*>([^<]*)<\/h1>/) || [])[1] ||
        (html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/) ||
          [])[1] ||
        (html.match(/<title>([^<]*)<\/title>/) || [])[1] ||
        "";
      title = decodeEntities(title);
      const poster =
        (html.match(
          /<div class="post-thumbnail[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/,
        ) || [])[1] ||
        (html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/) ||
          [])[1] ||
        "";
      const desc =
        (html.match(/<div class="entry-content">[\s\S]*?<p>([\s\S]*?)<\/p>/) ||
          [])[1] ||
        (html.match(
          /<meta[^>]*name="twitter:description"[^>]*content="([^"]+)"/,
        ) || [])[1] ||
        "";
      const year =
        (html.match(/<span class="year">([^<]+)<\/span>/) || [])[1] || "";
      const isSeries = url.includes("/series-hindi/") || url.includes("/epi/");

      const episodes = [];
      const epEls = await parse_html(html, "ul.seasons-lst li", null);
      for (const el of epEls || []) {
        const h = htmlOf(el);
        const a = h.match(/<a[^>]*href="([^"]+)"/);
        if (!a) continue;
        const span =
          (h.match(/<h3 class="title"><span>([^<]*)<\/span>/) || [])[1] || "";
        const name =
          (h.match(/<h3 class="title"><span>[^<]*<\/span>\s*([^<]*)<\/h3>/) ||
            [])[1] ||
          (h.match(/<img[^>]*alt="([^"]+)"/) || [])[1] ||
          "";
        const img = (h.match(/<img[^>]*src="([^"]+)"/) || [])[1] || "";
        const m = span.match(/S(\d+)-E(\d+)/i);
        episodes.push(
          new Episode({
            name: (name || span || "Episode").trim(),
            season: m ? parseInt(m[1], 10) : 1,
            episode: m ? parseInt(m[2], 10) : episodes.length + 1,
            url: a[1],
            posterUrl: isSafeUrl(img) ? img : "",
          }),
        );
      }
      if (!episodes.length) {
        episodes.push(
          new Episode({
            name: "Full Movie",
            season: 1,
            episode: 1,
            url: url,
            posterUrl: isSafeUrl(poster) ? poster : "",
          }),
        );
      }

      cb({
        success: true,
        data: new MultimediaItem({
          title: (title || "Untitled").trim(),
          url: url,
          posterUrl: isSafeUrl(poster) ? poster : "",
          bannerUrl: isSafeUrl(poster) ? poster : "",
          type: isSeries ? "series" : "movie",
          year: parseInt(year, 10) || undefined,
          description: desc.trim() || undefined,
          episodes,
        }),
      });
    } catch (e) {
      cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
    }
  }

  // ---- stream extractors --------------------------------------------------

  // AWSStream (as-cdn21.top / z.awstream.net): embed -> hash -> POST
  // player/index.php -> master.m3u8. Quality + audio languages parsed from
  // the master playlist so labels are exact.
  async function awsStream(embedUrl) {
    const host = new URL(embedUrl).origin;
    const hash = embedUrl.split("/").pop();
    const res = await http_post(
      host + "/player/index.php?data=" + hash + "&do=getVideo",
      headers({
        "x-requested-with": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: embedUrl,
      }),
      "hash=" + hash + "&r=" + host,
    );
    if (!res || !res.body) return [];
    let json;
    try {
      json = JSON.parse(res.body);
    } catch (e) {
      return [];
    }
    const m3u8 = json.videoSource || json.securedLink;
    if (!m3u8 || !isSafeUrl(m3u8)) return [];
    const pl = await http_get(m3u8, headers({ Referer: host + "/" }));
    if (!pl || !pl.body) return [];
    const body = pl.body;
    const langs = [];
    const re = /#EXT-X-MEDIA:TYPE=AUDIO[^\n]*NAME="([^"]+)"/g;
    let lm;
    while ((lm = re.exec(body))) langs.push(lm[1]);
    const streams = [];
    const lines = body.split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
      const next = lines[i + 1];
      if (!next || next.startsWith("#")) continue;
      const name = (lines[i].match(/NAME="([^"]+)"/) || [])[1] || "";
      const resMatch = lines[i].match(/RESOLUTION=\d+x(\d+)/);
      const q = name || (resMatch ? resMatch[1] + "p" : "HD");
      const label =
        "VidStream • " + q + (langs.length ? " • " + langs.join("/") : "");
      streams.push(
        new StreamResult({
          url: abs(next, m3u8),
          source: label,
          headers: headers({ Referer: host + "/" }),
        }),
      );
    }
    return streams;
  }

  // Blakiteapi (MyCloud): api/get.php -> {quality, format, dataId}
  async function blakite(embedUrl) {
    const m = embedUrl.match(/\/embed\/([^/]+)\/([^/]+)/);
    if (!m) return [];
    const res = await http_get(
      "https://blakiteapi.xyz/api/get.php?id=" + m[2] + "&tmdbId=" + m[1],
      headers({ Referer: embedUrl }),
    );
    if (!res || !res.body) return [];
    let json;
    try {
      json = JSON.parse(res.body);
    } catch (e) {
      return [];
    }
    if (!json.success || !json.data) return [];
    const d = json.data;
    const streamUrl =
      "https://blakiteapi.xyz/stream/" +
      d.dataId +
      "." +
      (d.format || "M3U8").toLowerCase();
    if (!isSafeUrl(streamUrl)) return [];
    const lang =
      (String(d.animeTitle || "").match(/\(([^)]*(?:Dub|Sub)[^)]*)\)/i) ||
        [])[1] || "";
    return [
      new StreamResult({
        url: streamUrl,
        source: "MyCloud • " + (d.quality || "HD") + (lang ? " • " + lang : ""),
        headers: headers({ Referer: "https://blakiteapi.xyz/" }),
      }),
    ];
  }

  // StreamRuby (SRuby): X-Requested-With GET -> file:"..." in player script
  async function sruby(embedUrl) {
    const res = await http_get(
      embedUrl,
      headers({ "X-Requested-With": "XMLHttpRequest" }),
    );
    if (!res || !res.body) return [];
    const m = res.body.match(/file\s*:\s*"([^"]+)"/);
    if (!m || !isSafeUrl(m[1])) return [];
    return [
      new StreamResult({
        url: m[1],
        source: "SRuby • HD",
        headers: headers(),
      }),
    ];
  }

  // ---- loadStreams --------------------------------------------------------

  async function loadStreams(dataStr, cb) {
    try {
      const url = String(dataStr || "").trim();
      if (!isSafeUrl(url)) {
        return cb({
          success: false,
          errorCode: "NOT_FOUND",
          message: "Invalid URL",
        });
      }
      // The toronites_server cookie makes the theme render iframe.serversel
      // with the real embed srcs.
      const res = await http_get(url, headers({ Cookie: COOKIE }));
      if (!res || !res.body) {
        return cb({
          success: false,
          errorCode: "SITE_OFFLINE",
          message: "Empty page",
        });
      }
      const html = res.body;

      // 1. serversel iframes (VidStream server)
      const serverUrls = [];
      const iframes = await parse_html(html, "iframe.serversel", "src");
      for (const f of iframes || []) {
        const src = (f.attr || "").trim();
        if (src && isSafeUrl(src)) serverUrls.push(src);
      }

      // 2. named server selector (base64 data-src -> trdekho/embed URLs)
      const sel = await parse_html(html, "[data-src]", "data-src");
      for (const s of sel || []) {
        let dec = "";
        try {
          dec = atob(s.attr || "");
        } catch (e) {
          continue;
        }
        if (dec && isSafeUrl(dec)) serverUrls.push(dec);
      }

      // 3. resolve each server URL to an extractor embed URL
      const embedUrls = [];
      const seen = new Set();
      for (const su of serverUrls) {
        if (seen.has(su)) continue;
        seen.add(su);
        try {
          if (su.includes("/aaa/myth/play.php")) continue; // NeoCDN, JS player
          if (su.includes("animedekho.app")) {
            const r = await http_get(su, headers({ Cookie: COOKIE }));
            if (!r || !r.body) continue;
            const inner = await parse_html(r.body, "iframe", "src");
            const src = ((inner && inner[0] && inner[0].attr) || "").trim();
            if (src && isSafeUrl(src)) embedUrls.push(src);
          } else {
            embedUrls.push(su);
          }
        } catch (e) {
          // skip dead servers
        }
      }

      // 4. run extractors per host
      const streams = [];
      const done = new Set();
      for (const eu of embedUrls) {
        if (done.has(eu)) continue;
        done.add(eu);
        try {
          const host = new URL(eu).hostname;
          let found = [];
          if (/as-cdn21\.top|z\.awstream\.net|awstream/i.test(host)) {
            found = await awsStream(eu);
          } else if (/blakiteapi\.xyz/i.test(host)) {
            found = await blakite(eu);
          } else if (/rubystm\.com/i.test(host)) {
            found = await sruby(eu);
          }
          // JS-only hosts (vidmoly, upns, p2pstream, hanerix, smoothpre,
          // emturbovid, mirror.xerver, bysetayico, iqsmartgames) skipped.
          for (const s of found) streams.push(s);
        } catch (e) {
          // skip failed extractor
        }
      }

      if (!streams.length) {
        return cb({
          success: false,
          errorCode: "NOT_FOUND",
          message: "No playable sources",
        });
      }
      cb({ success: true, data: streams.slice(0, 12) });
    } catch (e) {
      cb({ success: false, errorCode: "SITE_OFFLINE", message: e.message });
    }
  }

  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();
