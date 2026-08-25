(function () {
  "use strict";
  var CFG = {
    URLS_URL:
      "https://raw.githubusercontent.com/Zenda-Cross/vega-providers/refs/heads/main/urls.json",
    MANIFEST_URL:
      "https://raw.githubusercontent.com/Zenda-Cross/vega-providers/refs/heads/main/manifest.json",
    DIST_BASE:
      "https://raw.githubusercontent.com/Zenda-Cross/vega-providers/refs/heads/main/dist/",
    FETCH_TIMEOUT_MS: 20000,
    INDEX_TTL_MS: 36e5,
    MODULE_TTL_MS: 18e5,
    HOME_POOL: 6,
    SEARCH_POOL: 8,
    HOME_ITEMS: 14,
    MAX_SEARCH: 60,
    GUARD_MS: 75e3,
    CACHE_MAX: 300,
  };
  var JSON_HEADERS = { Accept: "application/json" };
  var COMMON_HEADERS = {
    "sec-ch-ua":
      '"Not_A Brand";v="8", "Chromium";v="120", "Android WebView";v="120"',
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": '"Android"',
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
  function safeStr(v) {
    return v === null || v === undefined ? "" : String(v);
  }
  function safeInt(v, d) {
    var n = parseInt(v, 10);
    return isNaN(n) ? d : n;
  }
  function delay(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }
  var _cache = new Map();
  function cacheSet(k, v, ttl) {
    _cache.set(k, { v: v, e: Date.now() + ttl });
    if (_cache.size > CFG.CACHE_MAX) _cache.delete(_cache.keys().next().value);
  }
  function cacheGet(k) {
    var e = _cache.get(k);
    if (!e) return null;
    if (Date.now() > e.e) {
      _cache.delete(k);
      return null;
    }
    return e.v;
  }
  function settle(ps) {
    return Promise.all(
      ps.map(function (p) {
        return Promise.resolve(p).then(
          function (v) {
            return { ok: true, value: v };
          },
          function (e) {
            return { ok: false, value: null };
          },
        );
      }),
    );
  }
  function pool(items, n, fn) {
    var list = Array.isArray(items) ? items : [];
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
  function guarded(fn, fb) {
    return async function () {
      var args = Array.prototype.slice.call(arguments);
      var cb =
        args.length && typeof args[args.length - 1] === "function"
          ? args[args.length - 1]
          : null;
      var delivered = false;
      function deliver(r) {
        if (!delivered && cb) {
          delivered = true;
          try {
            cb(r);
          } catch (e) {}
        }
      }
      var timer = setTimeout(function () {
        deliver(typeof fb === "function" ? fb() : fb);
      }, CFG.GUARD_MS);
      try {
        var r = await fn.apply(null, args.slice(0, -1));
        clearTimeout(timer);
        deliver(r);
      } catch (e) {
        clearTimeout(timer);
        deliver({
          success: false,
          errorCode: "PLUGIN_ERROR",
          message: safeStr(e),
        });
      }
    };
  }
  function rawHttp(url, options) {
    options = options || {};
    var headers = Object.assign({}, COMMON_HEADERS, options.headers || {});
    var done = false;
    return new Promise(function (resolve) {
      var t = setTimeout(function () {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, options.timeoutMs || CFG.FETCH_TIMEOUT_MS);
      try {
        http_get(url, headers).then(
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
      } catch (e) {
        if (!done) {
          done = true;
          clearTimeout(t);
          resolve(null);
        }
      }
    });
  }
  function respText(resp) {
    if (!resp) return null;
    var s = safeInt(resp.status || resp.statusCode || resp.code, 0);
    var loc = "";
    try {
      var h = resp.headers || {};
      var hk = Object.keys(h);
      for (var i = 0; i < hk.length; i++)
        if (hk[i].toLowerCase() === "location") loc = safeStr(h[hk[i]]);
    } catch (e) {}
    if ((s === 301 || s === 302 || s === 303 || s === 307 || s === 308) && loc)
      return { redirect: loc, status: s };
    if (s !== 200 && s !== 206 && s !== 304) return null;
    return { text: typeof resp.body === "string" ? resp.body : "", status: s };
  }
  async function fetchText(url, opts) {
    var r = await rawHttp(url, opts);
    if (!r) return null;
    if (r.redirect) return fetchText(r.redirect, opts);
    return typeof r.body === "string" ? r.body : "";
  }
  async function fetchJson(url, opts) {
    var t = await fetchText(url, opts);
    if (!t) return null;
    try {
      return JSON.parse(t);
    } catch (e) {
      return null;
    }
  }
  function MiniURL(rel, base) {
    var u = safeStr(rel);
    if (!/^https?:/i.test(u) && base) {
      var b = safeStr(base);
      if (u.charAt(0) === "/")
        u = ((b.match(/^(https?:\/\/[^/]+)/) || [b])[1] || "") + u;
      else if (/^https?:/i.test(b)) u = b.replace(/[^/]*$/, "") + u;
      else u = b + u;
    }
    this.href = u;
    var m =
      safeStr(u).match(/^(https?:\/\/)([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i) ||
      [];
    this.protocol = m[1] || "";
    this.host = m[2] || "";
    this.origin = this.protocol + "//" + this.host;
    this.pathname = m[3] || "/";
    this.search = m[4] || "";
    this.hash = m[5] || "";
    var self = this;
    this.searchParams = {
      get: function (k) {
        var q = self.search.replace(/^\?/, "");
        var parts = q ? q.split("&") : [];
        for (var i = 0; i < parts.length; i++) {
          var kv = parts[i].split("=");
          if (decodeURIComponent(kv[0]) === k)
            return decodeURIComponent((kv[1] || "").replace(/\+/g, " "));
        }
        return null;
      },
    };
    this.toString = function () {
      return this.href;
    };
  }
  function shimFetch(url, cfg) {
    cfg = cfg || {};
    return (async function () {
      var r = await rawHttp(url, {
        headers: cfg.headers,
        method: cfg.method,
        timeoutMs: 20000,
      });
      if (r && r.redirect)
        r = await rawHttp(r.redirect, { headers: cfg.headers });
      var text = r ? (typeof r.body === "string" ? r.body : "") : "";
      var status = r ? safeInt(r.status || r.statusCode, 0) : 0;
      var hmap = {};
      try {
        Object.keys((r && r.headers) || {}).forEach(function (k) {
          hmap[k.toLowerCase()] = safeStr(r.headers[k]);
        });
      } catch (e) {}
      return {
        ok: status >= 200 && status < 300,
        status: status,
        headers: {
          get: function (n) {
            return hmap[safeStr(n).toLowerCase()] || null;
          },
        },
        text: async function () {
          return text;
        },
        json: async function () {
          return JSON.parse(text);
        },
      };
    })();
  }
  function shimAxios(cfgOrUrl, maybeCfg) {
    var cfg =
      typeof cfgOrUrl === "string"
        ? Object.assign({ url: cfgOrUrl }, maybeCfg || {})
        : cfgOrUrl;
    return (async function () {
      var r = await rawHttp(cfg.url, {
        headers: cfg.headers,
        method: cfg.method,
        timeoutMs: 20000,
      });
      if (r && r.redirect)
        r = await rawHttp(r.redirect, { headers: cfg.headers });
      var text = r ? (typeof r.body === "string" ? r.body : "") : "";
      var status = r ? safeInt(r.status || r.statusCode, 0) : 0;
      var data = text;
      var ct = "";
      try {
        Object.keys((r && r.headers) || {}).forEach(function (k) {
          if (k.toLowerCase() === "content-type") ct = safeStr(r.headers[k]);
        });
      } catch (e) {}
      if (
        /json/i.test(ct) ||
        (cfg.responseType || "").toLowerCase() === "json"
      ) {
        try {
          data = JSON.parse(text);
        } catch (e) {}
      }
      return {
        data: data,
        status: status,
        statusText: "",
        headers: r && r.headers ? r.headers : {},
      };
    })();
  }
  function shimAxiosFn(cfgOrUrl, maybeCfg) {
    return shimAxios(cfgOrUrl, maybeCfg);
  }
  shimAxiosFn.get = function (url, cfg) {
    return shimAxios(Object.assign({ url: url, method: "GET" }, cfg || {}));
  };
  shimAxiosFn.post = function (url, data, cfg) {
    return shimAxios(
      Object.assign({ url: url, method: "POST", data: data }, cfg || {}),
    );
  };
  function TextEncoderStub() {}
  TextEncoderStub.prototype.encode = function (s) {
    s = safeStr(s);
    var a = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 128) a.push(c);
      else if (c < 2048) {
        a.push(192 | (c >> 6), 128 | (c & 63));
      } else {
        a.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
      }
    }
    return new Uint8Array(a);
  };
  function TextDecoderStub() {}
  TextDecoderStub.prototype.decode = function (a) {
    var s = "";
    a = a || [];
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return decodeURIComponent(escape(s));
  };
  function AbortControllerStub() {
    this.signal = { aborted: false, addEventListener: function () {} };
    this.abort = function () {
      this.signal.aborted = true;
    };
  }
  function sha256Hex(ascii) {
    function rr(v, c) {
      return (v >>> c) | (v << (32 - c));
    }
    var mathPow = Math.pow,
      maxWord = mathPow(2, 32),
      result = "",
      words = [],
      asciiBitLength = ascii.length * 8;
    var hash = [],
      k = [],
      primeCounter = 0;
    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += "\x80";
    while ((ascii.length % 64) - 56) ascii += "\x00";
    for (i = 0; i < ascii.length; i++) {
      var j = ascii.charCodeAt(i);
      if (j >> 8) return "";
      words[i >> 2] |= j << (((3 - i) % 4) * 8);
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, (j += 16)),
        oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15],
          w2 = w[i - 2];
        var a = hash[0],
          e = hash[4];
        var temp1 =
          hash[7] +
          (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) +
          ((e & hash[5]) ^ (~e & hash[6])) +
          k[i] +
          (w[i] =
            i < 16
              ? w[i]
              : (w[i - 16] +
                  (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) +
                  w[i - 7] +
                  (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) |
                0);
        var temp2 =
          (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) +
          ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++)
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? 0 : "") + b.toString(16);
      }
    return result;
  }
  function makeCheerio(html) {
    function parseNodes(html) {
      html = safeStr(html)
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
      var root = {
        tag: "#root",
        attrs: {},
        children: [],
        text: "",
        parent: null,
      };
      var cur = root;
      var re =
        /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[\w-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))*)\s*(\/?)>|([^<]+)/g;
      var m;
      while ((m = re.exec(html))) {
        if (m[4] !== undefined) {
          cur.text += m[4];
          continue;
        }
        var closing = html[m.index + 1] === "/";
        var tag = m[1].toLowerCase();
        if (closing) {
          var p = cur.parent;
          while (p && p.tag !== tag && p.tag !== "#root") p = p.parent;
          if (p && p.tag === tag) cur = p.parent || root;
          continue;
        }
        var node = { tag: tag, attrs: {}, children: [], text: "", parent: cur };
        var attrRe = /([\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g,
          am;
        while ((am = attrRe.exec(m[2] || "")))
          node.attrs[am[1].toLowerCase()] =
            am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : am[5];
        cur.children.push(node);
        if (!m[3] && !/^(br|img|input|meta|link|hr|source)$/i.test(tag))
          cur = node;
      }
      return root;
    }
    function allText(n) {
      var s = n.text || "";
      for (var i = 0; i < (n.children || []).length; i++)
        s += allText(n.children[i]);
      return s;
    }
    function matches(node, sel) {
      sel = sel.trim();
      var parts = sel.split(/\s+/);
      function simple(n, s) {
        if (s.charAt(0) === ".")
          return (n.attrs.class || "").split(/\s+/).indexOf(s.slice(1)) !== -1;
        if (s.charAt(0) === "#") return n.attrs.id === s.slice(1);
        return n.tag === s.toLowerCase();
      }
      if (parts.length === 1) return simple(node, parts[0]);
      if (!simple(node, parts[parts.length - 1])) return false;
      var ancestorWanted = parts.length - 1,
        pi = ancestorWanted - 1;
      var up = node.parent;
      while (up && up.tag !== "#root") {
        if (simple(up, parts[pi])) {
          pi--;
          if (pi < 0) return true;
        }
        up = up.parent;
      }
      return pi < 0;
    }
    function collect(nodes, sel, out) {
      nodes.forEach(function (n) {
        if (matches(n, sel)) out.push(n);
        collect(n.children || [], sel, out);
      });
    }
    function wrap(nodes) {
      nodes = nodes || [];
      var api = {
        length: nodes.length,
        find: function (sel) {
          var out = [];
          nodes.forEach(function (n) {
            collect(n.children || [], sel, out);
          });
          return wrap(out);
        },
        attr: function (name) {
          return nodes.length ? nodes[0].attrs[name.toLowerCase()] : undefined;
        },
        text: function () {
          var s = "";
          nodes.forEach(function (n) {
            s += allText(n);
          });
          return s.replace(/\s+/g, " ").trim();
        },
        html: function () {
          return nodes.length ? allText(nodes[0]) : "";
        },
        children: function (sel) {
          var out = [];
          nodes.forEach(function (n) {
            (n.children || []).forEach(function (c) {
              if (!sel || matches(c, sel)) out.push(c);
            });
          });
          return wrap(out);
        },
        first: function () {
          return wrap(nodes.slice(0, 1));
        },
        each: function (fn) {
          nodes.forEach(function (n, i) {
            fn.call(wrap([n]), i, wrap([n]));
          });
          return api;
        },
        map: function (fn) {
          var out = [];
          nodes.forEach(function (n, i) {
            var r = fn.call(wrap([n]), i, wrap([n]));
            if (r !== undefined && r !== null) out.push(r);
          });
          return wrap(out);
        },
        toArray: function () {
          return nodes.map(function (n) {
            return wrap([n]);
          });
        },
      };
      return api;
    }
    var root = parseNodes(safeStr(html));
    var $ = function (sel) {
      if (typeof sel === "object" && sel.tag) return wrap([sel]);
      if (typeof sel === "function") {
        sel(root);
        return $;
      }
      var out = [];
      collect([root], sel, out);
      return wrap(out);
    };
    $.load = makeCheerio;
    return $;
  }
  function createProviderContext(urlsMap) {
    return {
      axios: shimAxiosFn,
      cheerio: { load: makeCheerio },
      commonHeaders: COMMON_HEADERS,
      Crypto: {
        DigestAlgorithm: {
          Sha1: "SHA-1",
          Sha256: "SHA-256",
          Sha384: "SHA-384",
          Sha512: "SHA-512",
        },
        digestStringAsync: async function (alg, data) {
          alg = safeStr(alg).toUpperCase();
          if (alg.indexOf("256") !== -1) return sha256Hex(safeStr(data));
          return sha256Hex(safeStr(data));
        },
      },
      getBaseUrl: function (id) {
        var e = urlsMap[id];
        return e ? safeStr(e.url || e) : "";
      },
      openWebView: function () {},
      fetch: shimFetch,
      URL: MiniURL,
      URLSearchParams: function () {
        this.get = function () {
          return null;
        };
      },
      TextEncoder: TextEncoderStub,
      TextDecoder: TextDecoderStub,
      AbortController: AbortControllerStub,
      console: console,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
    };
  }
  async function loadIndex() {
    var c = cacheGet("idx");
    if (c) return c;
    var urls = await fetchJson(CFG.URLS_URL);
    var manifest = await fetchJson(CFG.MANIFEST_URL);
    if (!urls || !Array.isArray(manifest)) return { urls: {}, manifest: [] };
    var manifestMap = {};
    manifest.forEach(function (m) {
      if (m && m.value) manifestMap[normalizeId(m.value)] = m;
    });
    var idx = { urls: urls, manifest: manifest, manifestMap: manifestMap };
    cacheSet("idx", idx, CFG.INDEX_TTL_MS);
    return idx;
  }
  function normalizeId(v) {
    return safeStr(v)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }
  function enabledProviders(settings) {
    return (async function () {
      var idx = await loadIndex();
      var out = [];
      for (var i = 0; i < idx.manifest.length; i++) {
        var m = idx.manifest[i];
        if (!m || !m.value || m.disabled) continue;
        var dir = m.value;
        var key = "p_" + normalizeId(dir);
        var pref = await readPref(key);
        if (pref === "false") continue;
        var entry = idx.urls[dir] || null;
        out.push({
          id: dir,
          moduleDir: dir,
          displayName: m.display_name || dir,
          baseUrl: entry ? safeStr(entry.url || entry) : "",
        });
      }
      return out;
    })();
  }
  async function readPref(key) {
    try {
      if (typeof _dartAsyncCall === "function") {
        var pn = "dev.cookie.harustream";
        var r = await _dartAsyncCall("get_preference", {
          packageName: pn,
          key: key,
        });
        if (r != null) return safeStr(typeof r === "object" ? r.value : r);
      }
      if (typeof getPreference === "function") {
        var r2 = await getPreference(key);
        if (r2 != null) return safeStr(r2);
      }
    } catch (e) {}
    return null;
  }
  var moduleCache = new Map();
  async function loadModule(provider, file) {
    var key = provider.moduleDir + "/" + file;
    var c = moduleCache.get(key);
    if (c) return c;
    var src = await fetchText(
      CFG.DIST_BASE +
        encodeURIComponent(provider.moduleDir) +
        "/" +
        file +
        ".js",
    );
    if (!src) return null;
    moduleCache.set(key, src);
    return src;
  }
  function runModule(src, args) {
    var box = { exports: {} };
    var ctx = args.providerContext;
    var fn = new Function(
      "module",
      "exports",
      "providerContext",
      "fetch",
      "URL",
      "URLSearchParams",
      "TextEncoder",
      "TextDecoder",
      "AbortController",
      "console",
      "setTimeout",
      "clearTimeout",
      src,
    );
    fn(
      box,
      box.exports,
      ctx,
      ctx.fetch,
      ctx.URL,
      ctx.URLSearchParams,
      ctx.TextEncoder,
      ctx.TextDecoder,
      ctx.AbortController,
      ctx.console,
      ctx.setTimeout,
      ctx.clearTimeout,
    );
    return box.exports;
  }
  async function callProvider(provider, file, fnName, extra) {
    var src = await loadModule(provider, file);
    if (!src) return null;
    var signal = new AbortControllerStub();
    var args = Object.assign(
      {
        providerValue: provider.moduleDir,
        signal: signal.signal,
        providerContext: createProviderContext(cacheGet("urlsMap") || {}),
      },
      extra || {},
    );
    var exp = runModule(src, args);
    var fn = exp[fnName];
    if (typeof fn !== "function") return null;
    return fn(args);
  }
  function postToItem(p, provider) {
    if (!p || !p.link) return null;
    return clean({
      title: safeStr(p.title) || "Untitled",
      url:
        "hx|" + provider.moduleDir + "|movie|" + encodeURIComponent(p.link),
      posterUrl: safeStr(p.image) || undefined,
      type: /(series|season|episode|tv)/i.test(safeStr(p.title))
        ? "series"
        : "movie",
    });
  }
  function clean(o) {
    var out = {};
    Object.keys(o).forEach(function (k) {
      var v = o[k];
      if (v === null || v === undefined || v === "") return;
      if (Array.isArray(v) && !v.length) return;
      out[k] = v;
    });
    return out;
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
        key: "external_subs",
        title: "Enable External Subs",
        description: "Fetch external subtitles where supported",
        type: "toggle",
        defaultValue: "true",
        reloadOnChange: true,
      },
    ];
  }
  async function getSettingsData() {
    var ext = true;
    try {
      var v = await readPref("external_subs");
      if (v != null) ext = safeStr(v).toLowerCase() !== "false";
    } catch (e) {}
    return { englishSubs: ext };
  }
  async function getHomeInner(page) {
    var idx = await loadIndex();
    cacheSet("urlsMap", idx.urls, CFG.INDEX_TTL_MS);
    var providers = await enabledProviders();
    var res = await pool(providers, CFG.HOME_POOL, async function (p) {
      var cats = [];
      try {
        var csrc = await loadModule(p, "catalog");
        if (csrc) {
          var ce = runModule(csrc, {
            providerContext: createProviderContext(idx.urls),
          });
          var arr = Array.isArray(ce.catalog) ? ce.catalog : [];
          cats = arr.slice(0, 2).map(function (c) {
            return safeStr(c.filter);
          });
        }
      } catch (e) {}
      if (!cats.length) cats = [""];
      var posts = [];
      for (
        var ci = 0;
        ci < cats.length && posts.length < CFG.HOME_ITEMS;
        ci++
      ) {
        try {
          var r = await callProvider(p, "posts", "getPosts", {
            filter: cats[ci],
            page: safeInt(page, 1),
          });
          if (Array.isArray(r)) posts = posts.concat(r);
        } catch (e) {}
      }
      var items = [];
      posts.forEach(function (po) {
        var it = postToItem(po, p);
        if (it) items.push(it);
      });
      return { name: p.displayName, items: items.slice(0, CFG.HOME_ITEMS) };
    });
    var data = {};
    res.forEach(function (r) {
      if (r && r.ok && r.value && r.value.items.length)
        data[r.value.name] = r.value.items;
    });
    return { success: true, data: data };
  }
  async function searchInner(q) {
    var query = safeStr(q).trim();
    if (!query) return { success: true, data: [] };
    var idx = await loadIndex();
    cacheSet("urlsMap", idx.urls, CFG.INDEX_TTL_MS);
    var providers = await enabledProviders();
    var res = await pool(providers, CFG.SEARCH_POOL, async function (p) {
      var r = await callProvider(p, "posts", "getSearchPosts", {
        searchQuery: query,
        page: 1,
      });
      return Array.isArray(r) ? r : [];
    });
    var all = [];
    res.forEach(function (r, i) {
      if (!r || !r.ok || !Array.isArray(r.value)) return;
      r.value.forEach(function (p) {
        var it = postToItem(p, providers[i]);
        if (it) all.push(it);
      });
    });
    if (all.length > CFG.MAX_SEARCH) all = all.slice(0, CFG.MAX_SEARCH);
    return { success: true, data: all };
  }
  function parseRef(url) {
    var p = safeStr(url).split("|");
    if (p.length < 4 || p[0] !== "hx") return null;
    return { moduleDir: p[1], type: p[2], link: p.slice(3).join("|") };
  }
  async function loadInner(url) {
    var ref = parseRef(url);
    if (!ref)
      return { success: false, errorCode: "LOAD_ERROR", message: "bad ref" };
    var idx = await loadIndex();
    cacheSet("urlsMap", idx.urls, CFG.INDEX_TTL_MS);
    var provider = {
      id: ref.moduleDir,
      moduleDir: ref.moduleDir,
      displayName: ref.moduleDir,
      baseUrl: "",
    };
    var mEntry = idx.manifestMap[normalizeId(ref.moduleDir)];
    if (mEntry) provider.displayName = mEntry.display_name || ref.moduleDir;
    var meta = null;
    try {
      meta = await callProvider(provider, "meta", "getMeta", {
        link: ref.link,
      });
    } catch (e) {}
    meta = meta && typeof meta === "object" ? meta : {};
    var isSeries =
      /series|tv/i.test(safeStr(meta.type)) ||
      (Array.isArray(meta.episodes) && meta.episodes.length > 0);
    var episodes = [];
    if (isSeries) {
      var eps = [];
      try {
        eps =
          (await callProvider(provider, "episodes", "getEpisodes", {
            url: ref.link,
          })) || [];
      } catch (e) {}
      if (!eps.length && Array.isArray(meta.episodes)) eps = meta.episodes;
      eps.forEach(function (e, i) {
        var link = safeStr(e.link || e.url);
        if (!link) return;
        episodes.push(
          clean({
            name: safeStr(e.title) || "Episode " + (i + 1),
            url: "hx|" + ref.moduleDir + "|stream|" + encodeURIComponent(link),
            season: safeInt(e.season, 1),
            episode: safeInt(e.number || e.episode, i + 1),
            posterUrl: safeStr(e.thumbnail || e.image) || undefined,
            description: safeStr(e.description) || undefined,
          }),
        );
      });
    }
    if (!episodes.length) {
      episodes.push(
        clean({
          name: "Watch",
          url:
            "hx|" + ref.moduleDir + "|stream|" + encodeURIComponent(ref.link),
          season: 1,
          episode: 1,
        }),
      );
    }
    var data = clean({
      title: safeStr(meta.title || meta.name) || ref.moduleDir,
      url: url,
      posterUrl:
        safeStr(meta.image || meta.poster || meta.thumbnail) || undefined,
      bannerUrl: safeStr(meta.background || meta.banner) || undefined,
      type: isSeries ? "series" : "movie",
      description: safeStr(meta.description || meta.synopsis) || undefined,
      score: Number(meta.rating) || undefined,
      year:
        safeInt(String(meta.year || "").match(/\d{4}/), undefined) || undefined,
      tags: Array.isArray(meta.genres) ? meta.genres : undefined,
      episodes: episodes,
    });
    return { success: true, data: data };
  }
  async function loadStreamsInner(url) {
    var ref = parseRef(url);
    if (!ref)
      return { success: false, errorCode: "STREAM_ERROR", message: "bad ref" };
    var idx = await loadIndex();
    cacheSet("urlsMap", idx.urls, CFG.INDEX_TTL_MS);
    var provider = {
      id: ref.moduleDir,
      moduleDir: ref.moduleDir,
      displayName: ref.moduleDir,
      baseUrl: "",
    };
    var raw = [];
    try {
      raw =
        (await callProvider(provider, "stream", "getStream", {
          link: ref.link,
          type: ref.type,
        })) || [];
    } catch (e) {}
    var out = [];
    raw.forEach(function (s, i) {
      var u = safeStr(s.link || s.url);
      if (!u) return;
      out.push(
        clean({
          url: u,
          source: [
            safeStr(s.server || s.name) || "HaruStream " + (i + 1),
            safeStr(s.quality),
          ]
            .filter(Boolean)
            .join(" | "),
          quality: safeStr(s.quality) || undefined,
          headers:
            s.headers && typeof s.headers === "object" ? s.headers : undefined,
          subtitles: Array.isArray(s.subtitles)
            ? s.subtitles
                .filter(function (x) {
                  return x && x.url;
                })
                .map(function (x) {
                  return {
                    id: x.url,
                    url: x.url,
                    lang: safeStr(x.lang) || "en",
                    label: safeStr(x.label || x.lang) || "Subtitle",
                  };
                })
            : undefined,
        }),
      );
    });
    return { success: true, data: out };
  }
  globalThis.getHome = guarded(getHomeInner, {
    success: false,
    errorCode: "TIMEOUT",
  });
  globalThis.search = guarded(searchInner, { success: true, data: [] });
  globalThis.load = guarded(loadInner, {
    success: false,
    errorCode: "LOAD_ERROR",
  });
  globalThis.loadStreams = guarded(loadStreamsInner, {
    success: false,
    errorCode: "STREAM_ERROR",
  });
  globalThis.getSettings = getSettings;
  globalThis.__haru = {
    loadIndex: loadIndex,
    enabledProviders: enabledProviders,
    callProvider: callProvider,
    loadModule: loadModule,
    runModule: runModule,
    createProviderContext: createProviderContext,
    cacheGet: cacheGet,
    fetchText: fetchText,
    fetchJson: fetchJson,
    rawHttp: rawHttp,
  };
})();
