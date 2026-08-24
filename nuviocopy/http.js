"use strict";


var UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

var _appHttpGet;
try {
  if (typeof globalThis !== "undefined") _appHttpGet = globalThis.http_get;
} catch (e) {}
if (typeof _appHttpGet !== "function") _appHttpGet = null;

function _gzipInflate(body) {
  function toBytes(inp) {
    var b = new Uint8Array(inp.length);
    for (var i = 0; i < inp.length; i++) b[i] = inp.charCodeAt(i) & 0xff;
    return b;
  }
  var bytes = toBytes(body),
    pos = 10,
    fl = bytes[3];
  if (fl & 4) {
    var xl = bytes[pos] | (bytes[pos + 1] << 8);
    pos += 2 + xl;
  }
  if (fl & 8) {
    while (bytes[pos]) pos++;
    pos++;
  }
  if (fl & 16) {
    while (bytes[pos]) pos++;
    pos++;
  }
  if (fl & 2) pos += 2;

  var bitBuf = 0,
    bitCnt = 0;
  function rb(n) {
    while (bitCnt < n) {
      bitBuf |= bytes[pos++] << bitCnt;
      bitCnt += 8;
    }
    var v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  }

  function buildTree(codeLens) {
    var max = 0;
    for (var i = 0; i < codeLens.length; i++)
      if (codeLens[i] > max) max = codeLens[i];
    var blCount = [];
    for (var i = 0; i <= max; i++) blCount[i] = 0;
    for (var i = 0; i < codeLens.length; i++)
      if (codeLens[i]) blCount[codeLens[i]]++;
    var nextCode = [],
      code = 0;
    for (var bits = 1; bits <= max; bits++) {
      code = (code + (blCount[bits - 1] || 0)) << 1;
      nextCode[bits] = code;
    }
    var tbl = [];
    for (var i = 0; i < codeLens.length; i++) {
      var len = codeLens[i];
      if (len) {
        var rev = 0,
          tmp = nextCode[len];
        for (var b = 0; b < len; b++) {
          rev = (rev << 1) | (tmp & 1);
          tmp >>>= 1;
        }
        tbl[rev] = i;
        nextCode[len]++;
      }
    }
    return { tbl: tbl, maxBits: max };
  }

  function decode(tree) {
    var code = 0;
    for (var i = 0; i < tree.maxBits; i++) {
      code |= rb(1) << i;
      if (tree.tbl[code] !== undefined) return tree.tbl[code];
    }
    return 0;
  }

  var lenBase = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
    83, 99, 115, 131, 163, 195, 227, 258,
  ];
  var lenExtra = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5,
    5, 5, 5, 0,
  ];
  var distBase = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513,
    769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
  ];
  var distExtra = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10,
    11, 11, 12, 12, 13, 13,
  ];

  var fixedLens = [];
  for (var i = 0; i < 144; i++) fixedLens[i] = 8;
  for (var i = 144; i < 256; i++) fixedLens[i] = 9;
  for (var i = 256; i < 280; i++) fixedLens[i] = 7;
  for (var i = 280; i < 288; i++) fixedLens[i] = 8;
  var fixedTree = buildTree(fixedLens);

  var out = [],
    isFinal = 0;
  while (!isFinal) {
    isFinal = rb(1);
    var btype = rb(2);
    if (btype === 0) {
      bitCnt = 0;
      bitBuf = 0;
      var len = bytes[pos] | (bytes[pos + 1] << 8);
      pos += 4;
      for (var i = 0; i < len; i++) out.push(bytes[pos++]);
    } else if (btype === 1 || btype === 2) {
      var litTree, distTree;
      if (btype === 1) {
        litTree = fixedTree;
        var distFixedLens = [];
        for (var i = 0; i < 32; i++) distFixedLens[i] = 5;
        distTree = buildTree(distFixedLens);
      } else {
        var nlen = rb(5) + 257,
          ndist = rb(5) + 1,
          nclen = rb(4) + 4;
        var clOrder = [
          16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
        ];
        var clLens = [];
        for (var i = 0; i < nclen; i++) clLens[clOrder[i]] = rb(3);
        var clTree = buildTree(clLens);
        var allLens = [],
          totalLens = nlen + ndist;
        while (allLens.length < totalLens) {
          var sym = decode(clTree);
          if (sym < 16) allLens.push(sym);
          else if (sym === 16) {
            var repeat = rb(2) + 3,
              prev = allLens[allLens.length - 1] || 0;
            for (var j = 0; j < repeat; j++) allLens.push(prev);
          } else if (sym === 17) {
            var repeat = rb(3) + 3;
            for (var j = 0; j < repeat; j++) allLens.push(0);
          } else if (sym === 18) {
            var repeat = rb(7) + 11;
            for (var j = 0; j < repeat; j++) allLens.push(0);
          }
        }
        litTree = buildTree(allLens.slice(0, nlen));
        distTree = buildTree(allLens.slice(nlen));
      }
      while (true) {
        var sym = decode(litTree);
        if (sym < 256) out.push(sym);
        else if (sym === 256) break;
        else {
          var length = lenBase[sym - 257] + rb(lenExtra[sym - 257]);
          var distance =
            distBase[decode(distTree)] + rb(distExtra[decode(distTree)]);
          for (var k = 0; k < length; k++) out.push(out[out.length - distance]);
        }
      }
    }
  }

  var result = "";
  for (var i = 0; i < out.length;) {
    var c = out[i++];
    if (c < 0x80) result += String.fromCharCode(c);
    else if (c < 0xe0)
      result += String.fromCharCode(((c & 0x1f) << 6) | (out[i++] & 0x3f));
    else if (c < 0xf0)
      result += String.fromCharCode(
        ((c & 0x0f) << 12) | ((out[i++] & 0x3f) << 6) | (out[i++] & 0x3f),
      );
    else {
      var cp =
        ((c & 0x07) << 18) |
        ((out[i++] & 0x3f) << 12) |
        ((out[i++] & 0x3f) << 6) |
        (out[i++] & 0x3f);
      if (cp > 0xffff) {
        cp -= 0x10000;
        result += String.fromCharCode(
          0xd800 + (cp >> 10),
          0xdc00 + (cp & 0x3ff),
        );
      } else result += String.fromCharCode(cp);
    }
  }
  return result;
}

function _tryDecompressGzip(body) {
  if (!body || body.length < 2) return body;
  if (body.charCodeAt(0) !== 0x1f || body.charCodeAt(1) !== 0x8b) return body;
  try {
    var z = require("zlib");
    if (z && typeof z.gunzipSync === "function")
      return z.gunzipSync(Buffer.from(body, "binary")).toString("utf8");
  } catch (_) {}
  try {
    return _gzipInflate(body);
  } catch (_) {}
  return body;
}

function http_get(url, headers) {
  headers = headers || {};
  var h = {};
  if (typeof headers.forEach === "function") {
    headers.forEach(function (v, k) {
      h[k] = v;
    });
  } else if (typeof headers === "object") {
    for (var k in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, k)) h[k] = headers[k];
    }
  }
  if (!h["User-Agent"]) h["User-Agent"] = UA;

  return new Promise(function (resolve, reject) {
    try {
      if (typeof _appHttpGet === "function") {
        var cbCalled = false;
        var ret;
        try {
          ret = _appHttpGet(
            url,
            h,
            function (response) {
              cbCalled = true;
              if (
                response &&
                typeof response === "object" &&
                typeof response.body === "string"
              ) {
                resolve({
                  body: response.body,
                  headers: response.headers || h,
                });
              } else if (response) {
                reject(
                  new Error(
                    response.message ? response.message : String(response),
                  ),
                );
              } else {
                resolve({ body: "", headers: h });
              }
            },
            "utf8",
          );
        } catch (_) {}
        if (
          ret !== undefined &&
          ret !== null &&
          typeof ret.then === "function"
        ) {
          ret
            .then(function (r) {
              if (!cbCalled)
                resolve({
                  body: r.body || "",
                  headers: r.headers || h,
                });
            })
            .catch(function (err) {
              if (!cbCalled)
                reject(
                  new Error(err && err.message ? err.message : String(err)),
                );
            });
        }
        return;
      }
    } catch (_) {}
    try {
      if (
        typeof globalThis !== "undefined" &&
        typeof globalThis.fetch === "function"
      ) {
        var fetchOpts = { method: "GET", headers: h };
        if (
          typeof AbortSignal !== "undefined" &&
          typeof AbortSignal.timeout === "function"
        )
          fetchOpts.signal = AbortSignal.timeout(30000);
        globalThis
          .fetch(url, fetchOpts)
          .then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.text();
          })
          .then(function (body) {
            resolve({ body: body, headers: h });
          })
          .catch(reject);
        return;
      }
    } catch (_) {}
    try {
      var mod =
        url.indexOf("https:") === 0 ? require("https") : require("http");
      var parsed = require("url").parse(url);
      var opts = {
        hostname: parsed.hostname,
        port: parsed.port || (url.indexOf("https:") === 0 ? 443 : 80),
        path: parsed.path || "/",
        method: "GET",
        headers: h,
        timeout: 30000,
      };
      var req = mod
        .request(opts, function (res) {
          var data = "";
          res.on("data", function (chunk) {
            data += chunk;
          });
          res.on("end", function () {
            resolve({ body: data, headers: res.headers });
          });
        })
        .on("error", reject)
        .on("timeout", function () {
          req.destroy();
          reject(new Error("HTTP timeout"));
        });
      req.end();
    } catch (_) {
      reject(new Error("No HTTP client available"));
    }
  });
}

function buildResponse(reqUrl, fr, fb) {
  var respHeaders = {};
  if (fr && fr.headers) {
    for (var hk in fr.headers) {
      if (Object.prototype.hasOwnProperty.call(fr.headers, hk))
        respHeaders[hk] = fr.headers[hk];
    }
  }
  respHeaders.get = function (name) {
    return respHeaders[name] || null;
  };
  respHeaders.forEach = function (cb) {
    for (var k in respHeaders) {
      if (
        Object.prototype.hasOwnProperty.call(respHeaders, k) &&
        typeof respHeaders[k] !== "function"
      )
        cb(respHeaders[k], k);
    }
  };
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url: reqUrl,
    headers: respHeaders,
    text: function () {
      return Promise.resolve(fb);
    },
    json: function () {
      try {
        return Promise.resolve(JSON.parse(fb));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    arrayBuffer: function () {
      if (typeof Uint8Array !== "undefined")
        return Promise.resolve(new Uint8Array(fb.length));
      return Promise.resolve(fb);
    },
    body: fb,
  };
}

function httpGetRetry(url, headers, retries) {
  retries = retries || 2;
  var attempt = 0;
  function tryFetch() {
    attempt++;
    return http_get(url, headers).then(function (res) {
      var body = typeof res === "string" ? res : (res && res.body) || "";
      if (!body || body.length < 50) {
        if (attempt <= retries) return tryFetch();
      }
      return body;
    });
  }
  return tryFetch();
}

var _fetchQueue = [];
var _fetchInFlight = 0;
var _FETCH_MAX = 95;

function _drainFetchQueue() {
  while (_fetchInFlight < _FETCH_MAX && _fetchQueue.length > 0) {
    var job = _fetchQueue.shift();
    _fetchInFlight++;
    http_get(job.url, job.headers)
      .then(function (r) {
        _fetchInFlight--;
        job.resolve(r);
        _drainFetchQueue();
      })
      .catch(function (e) {
        _fetchInFlight--;
        job.reject(e);
        _drainFetchQueue();
      });
  }
}

function httpGetWithSemaphore(url, headers) {
  return new Promise(function (resolve, reject) {
    _fetchQueue.push({
      url: url,
      headers: headers,
      resolve: resolve,
      reject: reject,
    });
    _drainFetchQueue();
  });
}

module.exports = {
  UA: UA,
  _appHttpGet: _appHttpGet,
  _gzipInflate: _gzipInflate,
  _tryDecompressGzip: _tryDecompressGzip,
  http_get: http_get,
  httpGetRetry: httpGetRetry,
  httpGetWithSemaphore: httpGetWithSemaphore,
  buildResponse: buildResponse,
};
