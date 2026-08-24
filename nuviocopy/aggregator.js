"use strict";

var PROVIDERS = require("./providers.js");
var { fetchProviderModule } = require("./sandbox.js");

var TAG = "NuvioAggregator";

var _env = {};
try {
  _env = (typeof process !== "undefined" && process.env) || {};
} catch (_) {}
var PER_SOURCE_TIMEOUT = parseInt(
  _env.NUVIO_PER_SOURCE_TIMEOUT || _env.NUVIO_TIMEOUT || "50000",
  10,
);
var AGGREGATOR_TIMEOUT = parseInt(
  _env.NUVIO_GLOBAL_TIMEOUT || _env.NUVIO_TIMEOUT || "55000",
  10,
);

var _streamCache = {};
var STREAM_CACHE_TTL = 1800000; // 30 min

function withTimeout(promise, ms, label) {
  var tid = null;
  var tp = new Promise(function (_, reject) {
    tid = setTimeout(function () {
      tid = null;
      reject(new Error("Timeout (" + ms + "ms) for " + (label || "req")));
    }, ms);
  });
  return Promise.race([promise, tp]).finally(function () {
    if (tid !== null) clearTimeout(tid);
  });
}

function deduplicate(streams) {
  var seen = Object.create(null),
    result = [];
  for (var i = 0; i < streams.length; i++) {
    var key = streams[i].url;
    if (!key || seen[key]) continue;
    seen[key] = true;
    result.push(streams[i]);
  }
  return result;
}

var LANG_CODE = {
  eng: "Eng",
  hin: "Hin",
  tel: "Tel",
  tam: "Tam",
  mal: "Mal",
  kan: "Kan",
  ben: "Ben",
  mar: "Mar",
  guj: "Guj",
  pan: "Pan",
  urd: "Urd",
  spa: "Spa",
  fra: "Fra",
  deu: "Deu",
  jpn: "Jpn",
  kor: "Kor",
  zho: "Zho",
  rus: "Rus",
  ara: "Ara",
  por: "Por",
  ita: "Ita",
  nld: "Nld",
  pol: "Pol",
  tur: "Tur",
  tha: "Tha",
  vie: "Vie",
  ind: "Ind",
  english: "Eng",
  hindi: "Hin",
  telugu: "Tel",
  tamil: "Tam",
  malayalam: "Mal",
  kannada: "Kan",
  bengali: "Ben",
  marathi: "Mar",
  gujarati: "Guj",
  punjabi: "Pan",
  spanish: "Spa",
  french: "Fra",
  german: "Deu",
  japanese: "Jpn",
  korean: "Kor",
  chinese: "Zho",
  russian: "Rus",
  arabic: "Ara",
  portuguese: "Por",
  italian: "Ita",
  dutch: "Nld",
  polish: "Pol",
  turkish: "Tur",
  thai: "Tha",
  vietnamese: "Vie",
  indonesian: "Ind",
  en: "Eng",
  hi: "Hin",
  te: "Tel",
  ta: "Tam",
  ml: "Mal",
  kn: "Kan",
  bn: "Ben",
  mr: "Mar",
  gu: "Guj",
  pa: "Pan",
  es: "Spa",
  fr: "Fra",
  de: "Deu",
  ja: "Jpn",
  ko: "Kor",
  zh: "Zho",
  ru: "Rus",
  ar: "Ara",
  pt: "Por",
  it: "Ita",
  nl: "Nld",
  pl: "Pol",
  tr: "Tur",
  th: "Tha",
  vi: "Vie",
  id: "Ind",
};

function parseLanguages(text) {
  if (!text) return [];
  var lower = String(text).toLowerCase();
  var detected = [];
  var multiRe = /([a-z]{2,4})\s*[\/+]\s*([a-z]{2,4})/gi;
  var mm;
  while ((mm = multiRe.exec(lower)) !== null) {
    for (var mi = 1; mi < mm.length; mi++) {
      var code = LANG_CODE[mm[mi]];
      if (code && detected.indexOf(code) < 0) detected.push(code);
    }
  }
  var checks = [
    { re: /\b(hindi|hin)\b/i, code: "Hin" },
    { re: /\b(telugu|tel)\b/i, code: "Tel" },
    { re: /\b(tamil|tam)\b/i, code: "Tam" },
    { re: /\b(malayalam|mal)\b/i, code: "Mal" },
    { re: /\b(kannada|kan)\b/i, code: "Kan" },
    { re: /\b(bengali|ben)\b/i, code: "Ben" },
    { re: /\b(marathi|mar)\b/i, code: "Mar" },
    { re: /\b(gujarati|guj)\b/i, code: "Guj" },
    { re: /\b(punjabi|pan)\b/i, code: "Pan" },
    { re: /\b(urdu|urd)\b/i, code: "Urd" },
    { re: /\b(english|eng)\b/i, code: "Eng" },
    { re: /\b(japanese|jpn|ja)\b/i, code: "Jpn" },
    { re: /\b(korean|kor|ko)\b/i, code: "Kor" },
    { re: /\b(chinese|zho|zh)\b/i, code: "Zho" },
    { re: /\b(russian|rus|ru)\b/i, code: "Rus" },
    { re: /\b(french|fra|fr)\b/i, code: "Fra" },
    { re: /\b(spanish|spa|es)\b/i, code: "Spa" },
    { re: /\b(german|deu|de)\b/i, code: "Deu" },
    { re: /\b(italian|ita|it)\b/i, code: "Ita" },
    { re: /\b(dutch|nld|nl)\b/i, code: "Nld" },
    { re: /\b(polish|pol|pl)\b/i, code: "Pol" },
    { re: /\b(turkish|tur|tr)\b/i, code: "Tur" },
    { re: /\b(thai|tha|th)\b/i, code: "Tha" },
    { re: /\b(vietnamese|vi|vie)\b/i, code: "Vie" },
    { re: /\b(indonesian|id|ind)\b/i, code: "Ind" },
    { re: /\b(portuguese|por|pt)\b/i, code: "Por" },
    { re: /\b(arabic|ara|ar)\b/i, code: "Ara" },
  ];
  for (var ci = 0; ci < checks.length; ci++) {
    if (checks[ci].re.test(lower) && detected.indexOf(checks[ci].code) < 0)
      detected.push(checks[ci].code);
  }
  if (detected.length > 0 || /\b(multi|dual|dub|sub)\b/i.test(lower)) {
    var tags = [];
    if (/\b(multi)\b/i.test(lower)) tags.push("Multi");
    else if (/\b(dual)\b/i.test(lower)) tags.push("Dual");
    if (/\bdub\b/i.test(lower)) tags.push("Dub");
    if (/\bsub\b/i.test(lower)) tags.push("Sub");
    if (/\b(original)\b/i.test(lower)) tags.push("Original");
    for (var ti = 0; ti < tags.length; ti++) {
      if (detected.indexOf(tags[ti]) < 0) detected.push(tags[ti]);
    }
  }
  return detected;
}

function formatStreamName(s, providerName, pluginName, providerTitle) {
  if (!s) return "Stream";
  var searchText = "";
  var textFields = [
    s.name,
    s.title,
    s.description,
    s.label,
    s.filename,
    s.quality,
  ];
  var bh = s.behaviorHints || s.behaviourHints || {};
  if (bh.filename) searchText += " " + bh.filename;
  if (typeof bh.videoSize === "number") searchText += " " + bh.videoSize;
  for (var ti = 0; ti < textFields.length; ti++) {
    if (textFields[ti]) searchText += " " + textFields[ti];
  }

  var parts = [];

  var quality = s.resolution || s.quality || "";
  var qMatch = searchText.match(
    /\b(\d{3,4}p|\d{3,4}\s*[xX]\s*\d{3,4}|\d+K|8K|HD|SD|CAM|TS|DVD|WEB|BRRip|BluRay|HDRip)\b/i,
  );
  parts.push(qMatch ? qMatch[1].toUpperCase() : quality || "HD");

  var sizeMatch = searchText.match(/\b(\d+(?:\.\d+)?)\s*(GB|MB|GiB|MiB)\b/i);
  if (sizeMatch) {
    var num = parseFloat(sizeMatch[1]);
    var unit = sizeMatch[2].toUpperCase();
    parts.push(
      unit === "GB" || unit === "GIB"
        ? num >= 1
          ? num.toFixed(1) + "GB"
          : (num * 1024).toFixed(0) + "MB"
        : num.toFixed(0) + "MB",
    );
  }

  var codecMatch = searchText.match(
    /\b(H\.?264|H\.?265|X\.?264|X\.?265|HEVC|AV1|VP9|VP8|AVC|MPEG-?4|DIVX)\b/i,
  );
  if (codecMatch) parts.push(codecMatch[1].toUpperCase().replace(/\./g, ""));

  var hdrMatch = searchText.match(/\b(HDR10?|DOLBY\s*VISION|DV|HLG|HDR)\b/i);
  if (hdrMatch) parts.push(hdrMatch[1].toUpperCase());

  var chMatch = searchText.match(/\b([257]\.\d)\b/i);
  if (chMatch) parts.push(chMatch[1]);

  var languages = parseLanguages(searchText);
  if (languages.length > 0) parts.push(languages.join("+"));

  var label = parts.join(" - ");

  var prov = providerTitle || providerName;
  if (prov) label += " " + (prov.indexOf("[") === 0 ? prov : "[" + prov + "]");

  return label;
}

function normalizeStreams(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object" && raw.url) return [raw];
  var results = [];
  var knownKeys = [
    "streams",
    "sources",
    "variants",
    "items",
    "data",
    "result",
    "results",
    "links",
    "playlist",
  ];
  for (var ki = 0; ki < knownKeys.length; ki++) {
    var val = raw[knownKeys[ki]];
    if (Array.isArray(val) && val.length > 0) return normalizeStreams(val);
  }
  for (var k in raw) {
    if (
      Object.prototype.hasOwnProperty.call(raw, k) &&
      Array.isArray(raw[k]) &&
      raw[k].length > 0
    ) {
      results = normalizeStreams(raw[k]);
      if (results.length > 0) return results;
    }
  }
  return results;
}

function executeGetStreams(provider, params, mod) {
  return new Promise(function (resolve) {
    var getStreamsFn = typeof mod === "function" ? mod : mod.getStreams || null;
    if (!getStreamsFn) {
      resolve({
        source: provider.name,
        status: "skip",
        error: "no getStreams fn",
        streams: [],
      });
      return;
    }
    withTimeout(
      Promise.resolve(
        getStreamsFn(params.tmdbId, params.type, params.season, params.episode),
      ),
      PER_SOURCE_TIMEOUT,
      provider.name,
    )
      .then(function (raw) {
        if (!raw) {
          resolve({ source: provider.name, status: "empty", streams: [] });
          return;
        }
        var list = normalizeStreams(raw);
        if (!Array.isArray(list)) list = [list];
        var formatted = [];
        for (var i = 0; i < list.length; i++) {
          var s = list[i];
          if (!s || (!s.url && !s.name)) continue;
          var _name_ = formatStreamName(
            s,
            provider.name,
            provider.plugin,
            provider.providerTitle,
          );
          formatted.push({
            url: s.url || "",
            name: _name_,
            quality: s.resolution || s.quality || "HD",
            headers: s.headers || {},
            subtitles: s.subtitles || [],
          });
        }
        resolve({
          source: provider.name,
          status: "working",
          streams: deduplicate(formatted),
        });
      })
      .catch(function (e) {
        resolve({
          source: provider.name,
          status: "error",
          error: (e && e.message) || String(e),
          streams: [],
        });
      });
  });
}

function aggregateAll(tmdbId, type, season, episode) {
  var cacheKey =
    tmdbId + ":" + (type || "") + ":" + (season || 1) + ":" + (episode || 1);
  var cached = _streamCache[cacheKey];
  if (cached && Date.now() - cached.ts < STREAM_CACHE_TTL) {
    try {
      console.log("[" + TAG + "] Cache hit for " + cacheKey);
    } catch (_) {}
    return Promise.resolve(cached.data);
  }

  var start = Date.now();
  var params = {
    tmdbId: tmdbId,
    type: type,
    season: season || 1,
    episode: episode || 1,
  };
  var providers = PROVIDERS.filter(function (p) {
    return p.enabled !== false;
  });

  return new Promise(function (resolveAgg) {
    var allResults = [];
    var settled = false;

    function tryFinalize() {
      if (settled) return;
      clearInterval(deadlineCheck);
      var totalStreams = 0;
      for (var ri = 0; ri < allResults.length; ri++) {
        if (allResults[ri].status === "working")
          totalStreams += allResults[ri].streams.length;
      }
      try {
        var elapsed = Date.now() - start;
        if (elapsed > AGGREGATOR_TIMEOUT) elapsed = AGGREGATOR_TIMEOUT;
        console.log(
          "[" +
            TAG +
            "] " +
            providers.length +
            " providers: " +
            allResults.length +
            " done, " +
            totalStreams +
            " streams in " +
            elapsed +
            "ms",
        );
      } catch (_) {}
      settled = true;
      var result = {
        success: true,
        sources: allResults,
        totalStreams: totalStreams,
      };
      _streamCache[cacheKey] = { ts: Date.now(), data: result };
      resolveAgg(result);
    }

    var aggregatorTimer = setTimeout(function () {
      try {
        console.warn(
          "[" + TAG + "] Global timeout (" + AGGREGATOR_TIMEOUT + "ms)",
        );
      } catch (_) {}
      tryFinalize();
    }, AGGREGATOR_TIMEOUT);
    var deadlineCheck = setInterval(function () {
      if (!settled && Date.now() - start >= AGGREGATOR_TIMEOUT) {
        clearInterval(deadlineCheck);
        tryFinalize();
      }
    }, 200);

    var completed = {};
    var pending = providers.length;

    function collectResult(result, name) {
      if (settled || completed[name]) return;
      if (Date.now() - start >= AGGREGATOR_TIMEOUT) {
        clearTimeout(aggregatorTimer);
        clearInterval(deadlineCheck);
        tryFinalize();
        return;
      }
      completed[name] = true;
      allResults.push(result);
      pending--;
      if (pending <= 0) {
        clearTimeout(aggregatorTimer);
        clearInterval(deadlineCheck);
        tryFinalize();
      }
    }

    try {
      console.log(
        "[" +
          TAG +
          "] Starting " +
          providers.length +
          " providers — " +
          AGGREGATOR_TIMEOUT +
          "ms global timeout",
      );
    } catch (_) {}

    for (var i = 0; i < providers.length; i++) {
      var prov = providers[i];
      if (prov.types && prov.types.indexOf(type) < 0) {
        collectResult(
          {
            source: prov.name,
            status: "skip",
            error: "unsupported type",
            streams: [],
          },
          prov.id,
        );
        continue;
      }
      (function (p) {
        fetchProviderModule(p)
          .then(function (mod) {
            if (!settled && Date.now() - start >= AGGREGATOR_TIMEOUT) {
              clearTimeout(aggregatorTimer);
              clearInterval(deadlineCheck);
              tryFinalize();
              return {
                source: p.name,
                status: "error",
                error: "deadline",
                streams: [],
              };
            }
            return withTimeout(
              executeGetStreams(p, params, mod).then(function (result) {
                if (
                  result.status === "working" &&
                  result.streams.length === 0 &&
                  !settled
                ) {
                  return executeGetStreams(p, params, mod).catch(function () {
                    return result;
                  });
                }
                return result;
              }),
              PER_SOURCE_TIMEOUT,
              p.name,
            );
          })
          .then(function (result) {
            if (!settled && Date.now() - start >= AGGREGATOR_TIMEOUT) {
              clearTimeout(aggregatorTimer);
              clearInterval(deadlineCheck);
              tryFinalize();
              return;
            }
            collectResult(result, p.id);
          })
          .catch(function (e) {
            collectResult(
              {
                source: p.name,
                status: "error",
                error: String(e),
                streams: [],
              },
              p.id,
            );
          });
      })(prov);
    }
  });
}

module.exports = { aggregateAll: aggregateAll, PROVIDERS: PROVIDERS };
