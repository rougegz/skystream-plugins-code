"use strict";


var CryptoAdapter = require("./crypto.js").CryptoAdapter;
var BufferAdapter = require("./buffer.js").BufferAdapter;
var http = require("./http.js");
var UA = http.UA;
var httpGetRetry = http.httpGetRetry;
var httpGetWithSemaphore = http.httpGetWithSemaphore;
var _tryDecompressGzip = http._tryDecompressGzip;
var buildResponse = http.buildResponse;

var TAG = "NuvioAggregator";

var cheerio;
try {
  cheerio = require("cheerio-without-node-native");
} catch (_) {
  try {
    cheerio = require("cheerio");
  } catch (__) {
    cheerio = {};
  }
}

var _codeCache = (function (max) {
  var map = {},
    keys = [];
  return {
    get: function (k) {
      if (map[k] === undefined) return undefined;
      var idx = keys.indexOf(k);
      if (idx > -1) {
        keys.splice(idx, 1);
        keys.push(k);
      }
      return map[k];
    },
    set: function (k, v) {
      if (map[k] !== undefined) {
        var i = keys.indexOf(k);
        if (i > -1) keys.splice(i, 1);
      } else if (keys.length >= max) {
        delete map[keys.shift()];
      }
      keys.push(k);
      map[k] = v;
    },
    size: function () {
      return keys.length;
    },
  };
})(128);

var _polyfills = (function () {
  var cryptoInstance = CryptoAdapter.getInstance();
  var bufAdapter = BufferAdapter;
  return {
    cryptoJs: cryptoInstance,
    nodeCrypto: (function () {
      var cjs = cryptoInstance;
      function randomBytes(len) {
        var b = [];
        for (var i = 0; i < len; i++) b.push((Math.random() * 256) | 0);
        return bufAdapter.Buffer(b);
      }
      function createHash(alg) {
        var algo = alg.toLowerCase();
        return {
          update: function (data) {
            this._data = data;
            return this;
          },
          digest: function (encoding) {
            var bytes;
            if (algo === "md5") bytes = CryptoAdapter._md5(String(this._data));
            else if (algo === "sha1")
              bytes = CryptoAdapter._sha1(String(this._data));
            else if (algo === "sha256")
              bytes = CryptoAdapter._sha256(String(this._data));
            else bytes = CryptoAdapter._sha256(String(this._data));
            if (encoding === "hex") {
              var h = "";
              for (var i = 0; i < bytes.length; i++)
                h += ("0" + (bytes[i] & 0xff).toString(16)).slice(-2);
              return h;
            }
            if (encoding === "base64") return bufAdapter.base64Encode(bytes);
            return bufAdapter.Buffer(bytes);
          },
        };
      }
      function createHmac(alg, key) {
        return {
          update: function (data) {
            this._data = data;
            return this;
          },
          digest: function (encoding) {
            var keyStr =
              typeof key === "string" ? key : bufAdapter.toString(key);
            var dataStr =
              typeof this._data === "string"
                ? this._data
                : bufAdapter.toString(this._data);
            var result;
            if (alg.toLowerCase() === "sha1")
              result = cjs.HmacSHA1(dataStr, keyStr);
            else result = cjs.HmacSHA256(dataStr, keyStr);
            if (encoding === "hex") {
              var h = "",
                words = result.words;
              for (var i = 0; i < result.sigBytes; i++)
                h += (
                  "0" +
                  ((words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff).toString(16)
                ).slice(-2);
              return h;
            }
            if (encoding === "base64")
              return bufAdapter.base64Encode(
                (function (wa) {
                  var b = [];
                  for (var i = 0; i < wa.sigBytes; i++)
                    b.push((wa.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff);
                  return b;
                })(result),
              );
            return result;
          },
        };
      }
      return {
        randomBytes: randomBytes,
        createHash: createHash,
        createHmac: createHmac,
        createCipheriv: function () {
          return {
            update: function (d) {
              return d;
            },
            final: function () {
              return "";
            },
          };
        },
        createDecipheriv: function () {
          return {
            update: function (d) {
              return d;
            },
            final: function () {
              return "";
            },
          };
        },
      };
    })(),
    Buffer: (function () {
      var b = BufferAdapter.Buffer;
      b.from = BufferAdapter.Buffer;
      b.isBuffer = function (obj) {
        return obj instanceof Uint8Array || (obj && obj._isBuffer);
      };
      b.concat = BufferAdapter.concat;
      b.alloc = function (size) {
        return new Uint8Array(size);
      };
      b.allocUnsafe = function (size) {
        return new Uint8Array(size);
      };
      return b;
    })(),
    process: (function () {
      var p = {
        env: {},
        argv: [],
        pid: 1,
        ppid: 0,
        cwd: function () {
          return "/";
        },
        version: "v18.0.0",
        versions: { node: "18.0.0" },
        nextTick: function (cb) {
          try {
            if (typeof Promise !== "undefined") Promise.resolve().then(cb);
            else setTimeout(cb, 0);
          } catch (_) {}
        },
      };
      p.browser = true;
      return p;
    })(),
  };
})();

function preprocessCode(code) {
  if (!code) return "";
  var out = code;
  if (out.charCodeAt(0) === 0xfeff) out = out.slice(1);
  out = out.replace(/^#!.*\n/, "");
  out = out.replace(/^["']use strict["'];?\s*/i, "");
  out = out.replace(/([\{\;])\s*["']use strict["'];?\s*/gi, "$1");
  out = out.replace(/export\s+default\s+(\w+)\s*;?$/gm, "module.exports = $1;");
  out = out.replace(/export\s+default\s+(\w+)/gm, "module.exports = $1;");
  out = out.replace(
    /export\s+(function|const|let|var|class)\s+(\w+)/g,
    "module.exports.$2 = $1 $2",
  );
  out = out.replace(/export\s+\{\s*([^}]+)\s*\}/g, function (match, names) {
    var parts = names.split(",");
    var result = "";
    for (var i = 0; i < parts.length; i++) {
      var n = parts[i].trim().split(/\s+as\s+/);
      var exportName = n[0].trim();
      var localName = n[1] ? n[1].trim() : exportName;
      if (exportName === "default") exportName = "default";
      result += "module.exports." + exportName + " = " + localName + ";\n";
    }
    return result;
  });
  out = out.replace(
    /import\s+(?:\*\s+as\s+)?(\w+)\s+from\s+["']([^"']+)["']/g,
    "var $1 = require('$2')",
  );
  out = out.replace(
    /import\s+\{\s*([^}]+)\s*\}\s+from\s+["']([^"']+)["']/g,
    "var {$1} = require('$2')",
  );
  out = out.replace(/import\s+["']([^"']+)["']/g, "require('$1')");
  return out;
}

function extractGetStreams(exports) {
  if (!exports) return null;
  if (typeof exports.getStreams === "function") return exports.getStreams;
  if (exports.default) {
    if (typeof exports.default.getStreams === "function")
      return exports.default.getStreams;
    if (typeof exports.default === "function") return exports.default;
  }
  for (var k in exports) {
    if (
      Object.prototype.hasOwnProperty.call(exports, k) &&
      typeof exports[k] === "function" &&
      k.indexOf("getStream") >= 0
    )
      return exports[k];
  }
  return null;
}

function sandboxAtob(str) {
  if (typeof atob === "function") return atob(str);
  var chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  var output = "";
  str = String(str).replace(/[\s=]+$/, "");
  for (
    var bc = 0, bs, buffer, idx = 0;
    (buffer = chars.indexOf(str.charAt(idx++))) !== -1;
  ) {
    bs = bc % 4 ? bs * 64 + buffer : buffer;
    if (bc++ % 4) output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
  }
  return output;
}
function sandboxBtoa(str) {
  if (typeof btoa === "function") return btoa(str);
  var chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var bytes = [];
  for (var i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xff);
  var result = "";
  for (var i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i],
      b1 = bytes[i + 1],
      b2 = bytes[i + 2];
    result += chars.charAt(b0 >> 2);
    result += chars.charAt(((b0 & 3) << 4) | ((b1 || 0) >> 4));
    if (b1 === undefined) {
      result += "==";
      break;
    }
    result += chars.charAt(((b1 & 15) << 2) | ((b2 || 0) >> 6));
    if (b2 === undefined) {
      result += "=";
      break;
    }
    result += chars.charAt(b2 & 63);
  }
  return result;
}

function fetchProviderModule(provider) {
  if (!provider.id && provider.providerTitle) {
    provider.id = provider.providerTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  var jsUrl;
  if (provider.base && /\.js$/i.test(provider.base)) {
    jsUrl = provider.base
      .replace(
        /^https?:\/\/github\.com\//i,
        "https://raw.githubusercontent.com/",
      )
      .replace("/blob/", "/");
  } else {
    var filename = provider.file || provider.id;
    var basePath = provider.base.replace(/\/+$/, "");
    jsUrl = provider.path
      ? basePath + "/" + provider.path.replace(/^\//, "")
      : basePath + "/providers/" + filename + ".js";
  }

  var cached = _codeCache.get(provider.id);
  if (cached) return Promise.resolve(cached);

  return new Promise(function (resolve, reject) {
    var triedPaths = [];
    function attemptFetch(url) {
      triedPaths.push(url);
      httpGetWithSemaphore(url, {
        "User-Agent": UA,
        Accept: "application/javascript",
      })
        .then(function (res) {
          var respBody =
            typeof res === "string" ? res : (res && res.body) || "";
          respBody = _tryDecompressGzip(respBody);
          if (!respBody || respBody.length < 50) {
            if (url.indexOf("/providers/") > 0) {
              var altUrl = url.replace("/providers/", "/src/providers/");
              if (triedPaths.indexOf(altUrl) < 0) {
                attemptFetch(altUrl);
                return;
              }
            }
            reject(
              new Error("JS too short (" + (respBody.length || 0) + " bytes)"),
            );
            return;
          }
          var code = preprocessCode(respBody);

          code +=
            "\nif(typeof module!=='undefined'&&module.exports&&typeof getStreams==='function'&&!module.exports.getStreams)module.exports.getStreams=getStreams;";

          var sandboxModule = { exports: {} };
          var sandboxExports = sandboxModule.exports;

          function sandboxFetch(url, options) {
            options = options || {};
            if (
              typeof globalThis !== "undefined" &&
              typeof globalThis.fetch === "function"
            ) {
              try {
                return globalThis.fetch(url, options);
              } catch (e) {}
            }
            var headers = {};
            if (options.headers) {
              if (typeof options.headers.forEach === "function") {
                options.headers.forEach(function (v, k) {
                  headers[k] = v;
                });
              } else if (typeof options.headers === "object") {
                for (var hk in options.headers) {
                  if (Object.prototype.hasOwnProperty.call(options.headers, hk))
                    headers[hk] = options.headers[hk];
                }
              }
            }
            if (!headers["User-Agent"]) headers["User-Agent"] = UA;
            return new Promise(function (resolveFetch, rejectFetch) {
              http
                .http_get(url, headers)
                .then(function (fr) {
                  var fb = typeof fr === "string" ? fr : (fr && fr.body) || "";
                  var decompressed = _tryDecompressGzip(fb);
                  if (
                    decompressed !== null &&
                    typeof decompressed === "object" &&
                    typeof decompressed.then === "function"
                  ) {
                    decompressed.then(function (decoded) {
                      fb = decoded;
                      resolveFetch(buildResponse(url, fr, fb));
                    });
                    return;
                  }
                  if (typeof decompressed === "string") fb = decompressed;
                  resolveFetch(buildResponse(url, fr, fb));
                })
                .catch(function (e) {
                  rejectFetch(e);
                });
            });
          }

          function SandboxAbortController() {
            if (
              typeof globalThis !== "undefined" &&
              typeof globalThis.AbortController === "function"
            )
              return new globalThis.AbortController();
            var self = this;
            self.signal = {
              aborted: false,
              onabort: null,
              addEventListener: function (evt, handler) {
                if (evt === "abort") self.signal.onabort = handler;
              },
            };
            self.abort = function () {
              self.signal.aborted = true;
              if (typeof self.signal.onabort === "function")
                self.signal.onabort();
            };
          }

          function SandboxHeaders(init) {
            var _map = {};
            if (init) {
              if (init instanceof SandboxHeaders) {
                init.forEach(function (v, k) {
                  _map[k] = v;
                });
              } else if (typeof init.forEach === "function") {
                init.forEach(function (v, k) {
                  _map[k] = v;
                });
              } else if (typeof init === "object") {
                for (var k in init) {
                  if (Object.prototype.hasOwnProperty.call(init, k))
                    _map[k.toLowerCase()] = String(init[k]);
                }
              }
            }
            this.append = function (name, value) {
              _map[name.toLowerCase()] = value;
            };
            this.delete = function (name) {
              delete _map[name.toLowerCase()];
            };
            this.get = function (name) {
              return _map[name.toLowerCase()] || null;
            };
            this.has = function (name) {
              return _map[name.toLowerCase()] !== undefined;
            };
            this.set = function (name, value) {
              _map[name.toLowerCase()] = value;
            };
            this.forEach = function (cb) {
              for (var k in _map) {
                if (Object.prototype.hasOwnProperty.call(_map, k))
                  cb(_map[k], k, this);
              }
            };
            this.entries = function () {
              var e = [];
              for (var k in _map) {
                if (Object.prototype.hasOwnProperty.call(_map, k))
                  e.push([k, _map[k]]);
              }
              return e;
            };
            this.keys = function () {
              return Object.keys(_map);
            };
            this.values = function () {
              var vals = [];
              for (var k in _map) {
                if (Object.prototype.hasOwnProperty.call(_map, k))
                  vals.push(_map[k]);
              }
              return vals;
            };
          }

          var requireCache = {};
          function sandboxRequire(name) {
            if (requireCache[name]) return requireCache[name];
            var stub,
              n = name.toLowerCase();
            if (n.indexOf("cheerio") !== -1) stub = cheerio;
            else if (n === "crypto-js") stub = _polyfills.cryptoJs;
            else if (n === "crypto") stub = _polyfills.nodeCrypto;
            else if (n === "buffer") stub = _polyfills.Buffer;
            else if (n === "process") stub = _polyfills.process;
            else if (n === "url")
              stub = {
                URL: typeof URL !== "undefined" ? URL : function () {},
                URLSearchParams:
                  typeof URLSearchParams !== "undefined"
                    ? URLSearchParams
                    : function () {},
              };
            else if (
              n === "axios" ||
              n === "got" ||
              n === "request" ||
              n === "node-fetch"
            )
              stub = sandboxFetch;
            else if (n === "assert")
              stub = {
                AssertionError: function (o) {
                  this.name = "AssertionError [ERR_ASSERTION]";
                  this.message = o && o.message;
                },
                ok: function (v, m) {
                  if (!v) throw new Error(m || "assertion failed");
                },
                strict: {
                  equal: function (a, b, m) {
                    if (a !== b) throw new Error(m || "not equal");
                  },
                  deepEqual: function () {},
                  notEqual: function (a, b, m) {
                    if (a === b) throw new Error(m || "equal");
                  },
                },
              };
            else if (n === "events")
              stub = {
                EventEmitter: (function () {
                  function EE() {
                    this._events = {};
                  }
                  EE.prototype.on = EE.prototype.addListener = function (e, f) {
                    (this._events[e] = this._events[e] || []).push(f);
                    return this;
                  };
                  EE.prototype.once = function (e, f) {
                    var self = this;
                    function wrapper() {
                      f.apply(self, arguments);
                      self.removeListener(e, wrapper);
                    }
                    return self.on(e, wrapper);
                  };
                  EE.prototype.emit = function (e) {
                    var args = Array.prototype.slice.call(arguments, 1);
                    (this._events[e] || []).slice().forEach(function (f) {
                      f.apply(this, args);
                    }, this);
                    return this;
                  };
                  EE.prototype.removeListener = function (e, f) {
                    var list = this._events[e];
                    if (!list) return this;
                    this._events[e] = list.filter(function (x) {
                      return x !== f;
                    });
                    return this;
                  };
                  EE.prototype.removeAllListeners = function (e) {
                    if (e) this._events[e] = [];
                    else this._events = {};
                    return this;
                  };
                  EE.prototype.listeners = function (e) {
                    return (this._events[e] || []).slice();
                  };
                  return EE;
                })(),
              };
            else if (n === "stream")
              stub = {
                Writable: (function () {
                  function W(opts) {
                    this._writableState = {};
                    if (opts && opts.write) this._write = opts.write;
                  }
                  W.prototype.write = function (c, cb) {
                    try {
                      this._write && this._write(c);
                    } catch (_) {}
                    cb && cb();
                    return true;
                  };
                  W.prototype.end = function (c, cb) {
                    c && this.write(c);
                    cb && cb();
                  };
                  W.prototype.on =
                    W.prototype.once =
                    W.prototype.removeListener =
                      function () {
                        return this;
                      };
                  return W;
                })(),
                Readable: (function () {
                  function R() {
                    this._readableState = {};
                  }
                  R.prototype.on =
                    R.prototype.once =
                    R.prototype.pipe =
                    R.prototype.removeListener =
                      function () {
                        return this;
                      };
                  return R;
                })(),
                Duplex: (function () {
                  function D() {
                    this._readableState = {};
                    this._writableState = {};
                  }
                  D.prototype.on =
                    D.prototype.once =
                    D.prototype.pipe =
                    D.prototype.removeListener =
                      function () {
                        return this;
                      };
                  D.prototype.write = function () {
                    return true;
                  };
                  D.prototype.end = function () {};
                  return D;
                })(),
                Transform: (function () {
                  function T() {
                    this._readableState = {};
                    this._writableState = {};
                  }
                  T.prototype.on =
                    T.prototype.once =
                    T.prototype.pipe =
                    T.prototype.removeListener =
                      function () {
                        return this;
                      };
                  T.prototype.write = function () {
                    return true;
                  };
                  T.prototype.end = function () {};
                  return T;
                })(),
                PassThrough: (function () {
                  function PT() {
                    this._readableState = {};
                    this._writableState = {};
                  }
                  PT.prototype.on =
                    PT.prototype.once =
                    PT.prototype.pipe =
                    PT.prototype.removeListener =
                      function () {
                        return this;
                      };
                  PT.prototype.write = function () {
                    return true;
                  };
                  PT.prototype.end = function () {};
                  return PT;
                })(),
              };
            else if (n === "path")
              stub = {
                join: function () {
                  return Array.prototype.join.call(arguments, "/");
                },
                resolve: function () {
                  return Array.prototype.join.call(arguments, "/");
                },
                dirname: function (p) {
                  var parts = p.split("/");
                  if (parts.length > 1) parts.pop();
                  return parts.join("/") || ".";
                },
                basename: function (p) {
                  var parts = p.split("/");
                  return parts[parts.length - 1] || "";
                },
                extname: function (p) {
                  var m = p.match(/\.[^./]+$/);
                  return m ? m[0] : "";
                },
              };
            else if (n === "os")
              stub = {
                platform: function () {
                  return "browser";
                },
                homedir: function () {
                  return "/tmp";
                },
                tmpdir: function () {
                  return "/tmp";
                },
                EOL: "\n",
              };
            else if (n === "util")
              stub = {
                inherits: function (c, p) {
                  c.prototype = Object.create(p.prototype);
                  c.prototype.constructor = c;
                },
                format: function (s) {
                  return s;
                },
                deprecate: function (f) {
                  return f;
                },
              };
            else if (n === "querystring")
              stub = {
                stringify: function (obj) {
                  var parts = [];
                  for (var k in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, k))
                      parts.push(
                        encodeURIComponent(k) +
                          "=" +
                          encodeURIComponent(obj[k]),
                      );
                  }
                  return parts.join("&");
                },
                parse: function (s) {
                  var obj = {};
                  if (!s) return obj;
                  s.split("&").forEach(function (p) {
                    var kv = p.split("=");
                    if (kv[0])
                      obj[decodeURIComponent(kv[0])] = kv[1]
                        ? decodeURIComponent(kv[1])
                        : "";
                  });
                  return obj;
                },
              };
            else if (n === "net" || n === "tls")
              stub = {
                connect: function () {
                  return {
                    on: function () {},
                    destroy: function () {},
                    end: function () {},
                  };
                },
                createConnection: function () {
                  return { on: function () {} };
                },
                createServer: function () {
                  return { listen: function () {} };
                },
              };
            else if (n === "fs")
              stub = {
                readFileSync: function () {
                  return "";
                },
                existsSync: function () {
                  return false;
                },
                readdirSync: function () {
                  return [];
                },
                statSync: function () {
                  return {
                    isFile: function () {
                      return true;
                    },
                    isDirectory: function () {
                      return false;
                    },
                  };
                },
              };
            else if (n === "http" || n === "https")
              stub = {
                request: function () {
                  return {
                    on: function () {
                      return this;
                    },
                    end: function () {},
                  };
                },
                get: function () {
                  return {
                    on: function () {
                      return this;
                    },
                  };
                },
              };
            else {
              try {
                stub = require(name);
              } catch (__) {
                stub = {};
              }
            }
            requireCache[name] = stub;
            return stub;
          }

          var _rt =
            typeof URL !== "undefined"
              ? URL
              : function (url, base) {
                  var s = String(url);
                  if (base) {
                    var b = String(base).replace(/\/+$/, "");
                    s = b + (s[0] === "/" ? s : "/" + s);
                  }
                  var m = s.match(/^(https?:)?\/\/([^\/]+)(\/.*)?$/);
                  return {
                    href: s,
                    origin: m ? (m[1] || "https:") + "//" + m[2] : "",
                    protocol: m ? m[1] || "https:" : "",
                    hostname: m ? m[2] : "",
                    pathname: m ? m[3] || "/" : s,
                    search: "",
                    toString: function () {
                      return s;
                    },
                  };
                };
          var _te =
            typeof TextEncoder !== "undefined" ? TextEncoder : undefined;
          var _td =
            typeof TextDecoder !== "undefined" ? TextDecoder : undefined;
          var _up =
            typeof URLSearchParams !== "undefined"
              ? URLSearchParams
              : function (init) {
                  var _p = {};
                  return {
                    get: function (k) {
                      return _p[k] || null;
                    },
                    set: function (k, v) {
                      _p[k] = String(v);
                    },
                    append: function (k, v) {
                      _p[k] = (_p[k] ? _p[k] + "&" : "") + String(v);
                    },
                    toString: function () {
                      return Object.keys(_p)
                        .map(function (k) {
                          return (
                            encodeURIComponent(k) +
                            "=" +
                            encodeURIComponent(_p[k])
                          );
                        })
                        .join("&");
                    },
                    forEach: function (cb) {
                      for (var k in _p) {
                        if (Object.prototype.hasOwnProperty.call(_p, k))
                          cb(_p[k], k);
                      }
                    },
                  };
                };

          var sandboxGlobalThis = Object.assign(Object.create(null), {
            console: console,
            setTimeout: setTimeout,
            clearTimeout: clearTimeout,
            setInterval:
              typeof setInterval !== "undefined" ? setInterval : function () {},
            clearInterval:
              typeof clearInterval !== "undefined"
                ? clearInterval
                : function () {},
            Promise: Promise,
            JSON: JSON,
            Math: Math,
            String: String,
            Number: Number,
            Boolean: Boolean,
            Array: Array,
            Object: Object,
            Date: Date,
            RegExp: RegExp,
            Error: Error,
            TypeError: TypeError,
            RangeError: RangeError,
            ReferenceError: ReferenceError,
            SyntaxError: SyntaxError,
            EvalError: EvalError,
            URIError: URIError,
            parseInt: parseInt,
            parseFloat: parseFloat,
            encodeURIComponent: encodeURIComponent,
            decodeURIComponent: decodeURIComponent,
            encodeURI:
              typeof encodeURI !== "undefined"
                ? encodeURI
                : function (s) {
                    return s;
                  },
            decodeURI:
              typeof decodeURI !== "undefined"
                ? decodeURI
                : function (s) {
                    return s;
                  },
            isNaN: isNaN,
            isFinite:
              typeof isFinite !== "undefined"
                ? isFinite
                : function (v) {
                    return typeof v === "number" && !isNaN(v);
                  },
            fetch: sandboxFetch,
            atob: sandboxAtob,
            btoa: sandboxBtoa,
            cheerio: cheerio,
            AbortController: SandboxAbortController,
            Headers: SandboxHeaders,
            require: sandboxRequire,
            Buffer: _polyfills.Buffer,
            process: _polyfills.process,
            URL: _rt,
            TextEncoder: _te,
            TextDecoder: _td,
            URLSearchParams: _up,
            Uint8Array:
              typeof Uint8Array !== "undefined" ? Uint8Array : undefined,
            Int8Array: typeof Int8Array !== "undefined" ? Int8Array : undefined,
            Uint16Array:
              typeof Uint16Array !== "undefined" ? Uint16Array : undefined,
            Int16Array:
              typeof Int16Array !== "undefined" ? Int16Array : undefined,
            Uint32Array:
              typeof Uint32Array !== "undefined" ? Uint32Array : undefined,
            Int32Array:
              typeof Int32Array !== "undefined" ? Int32Array : undefined,
            Float32Array:
              typeof Float32Array !== "undefined" ? Float32Array : undefined,
            Float64Array:
              typeof Float64Array !== "undefined" ? Float64Array : undefined,
            ArrayBuffer:
              typeof ArrayBuffer !== "undefined" ? ArrayBuffer : undefined,
            DataView: typeof DataView !== "undefined" ? DataView : undefined,
            Map: typeof Map !== "undefined" ? Map : undefined,
            Set: typeof Set !== "undefined" ? Set : undefined,
            WeakMap: typeof WeakMap !== "undefined" ? WeakMap : undefined,
            WeakSet: typeof WeakSet !== "undefined" ? WeakSet : undefined,
            Symbol: typeof Symbol !== "undefined" ? Symbol : undefined,
            BigInt: typeof BigInt !== "undefined" ? BigInt : undefined,
            crypto: _polyfills.nodeCrypto,
            CryptoJS: _polyfills.cryptoJs,
            "crypto-js": _polyfills.cryptoJs,
            global: sandboxGlobalThis,
            globalThis: sandboxGlobalThis,
            module: sandboxModule,
            exports: sandboxExports,
            XMLHttpRequest: undefined,
            window: undefined,
            document: undefined,
            self: undefined,
            location: undefined,
            navigator: undefined,
            screen: undefined,
            history: undefined,
            localStorage: undefined,
            sessionStorage: undefined,
            alert: undefined,
            confirm: undefined,
            prompt: undefined,
            close: undefined,
            open: undefined,
            print: undefined,
            stop: undefined,
            name: undefined,
            closed: undefined,
            defaultStatus: undefined,
            status: undefined,
            menubar: undefined,
            toolbar: undefined,
            scrollbars: undefined,
          });

          try {
            code = code.replace(
              /\b(let|const|var)\s+(CryptoJS)\s*(=)?/g,
              function (m, kw, name, eq) {
                return eq ? name + " " + eq : "";
              },
            );
            var evalFn = new Function(
              "require",
              "module",
              "exports",
              "console",
              "fetch",
              "setTimeout",
              "clearTimeout",
              "Buffer",
              "process",
              "CryptoJS",
              "URL",
              code,
            );
            evalFn.call(
              sandboxGlobalThis,
              sandboxRequire,
              sandboxModule,
              sandboxExports,
              console,
              sandboxFetch,
              setTimeout,
              clearTimeout,
              _polyfills.Buffer,
              _polyfills.process,
              _polyfills.cryptoJs,
              _rt,
              code,
            );
          } catch (e) {
            reject(e);
            return;
          }

          var finalMod = extractGetStreams(sandboxModule.exports);
          if (!finalMod) {
            reject(
              new Error("No getStreams found in provider: " + provider.name),
            );
            return;
          }
          _codeCache.set(provider.id, finalMod);
          resolve(finalMod);
        })
        .catch(function (e) {
          var _semErr = "";
          try {
            _semErr =
              (e && e.message) || (e && e.toString ? e.toString() : String(e));
          } catch (_) {}
          try {
            console.log(
              "[" +
                TAG +
                "] FetchFail [" +
                provider.name +
                "]: " +
                _semErr.substring(0, 300),
            );
          } catch (_) {}
          httpGetRetry(
            jsUrl,
            { "User-Agent": UA, Accept: "application/javascript" },
            2,
          )
            .then(function (body) {
              body = _tryDecompressGzip(body);
              if (!body || body.length < 50) {
                reject(
                  new Error("JS too short (" + (body.length || 0) + " bytes)"),
                );
                return;
              }
              var code = preprocessCode(body);
              code +=
                "\nif(typeof module!=='undefined'&&module.exports&&typeof getStreams==='function'&&!module.exports.getStreams)module.exports.getStreams=getStreams;";
              code = code.replace(
                /\b(let|const|var)\s+(CryptoJS)\s*(=)?/g,
                function (m, kw, name, eq) {
                  return eq ? name + " " + eq : "";
                },
              );
              var sm = { exports: {} };
              function sr(name) {
                var n = name.toLowerCase();
                if (n.indexOf("cheerio") !== -1) return cheerio;
                if (n === "crypto-js" || n === "crypto" || n === "CryptoJS")
                  return _polyfills.cryptoJs;
                if (n === "buffer") return _polyfills.Buffer;
                if (n === "process") return _polyfills.process;
                return {};
              }
              var sg = {
                console: console,
                setTimeout: setTimeout,
                clearTimeout: clearTimeout,
                Promise: Promise,
                JSON: JSON,
                Math: Math,
                String: String,
                Number: Number,
                Boolean: Boolean,
                Array: Array,
                Object: Object,
                Date: Date,
                RegExp: RegExp,
                Error: Error,
                atob: sandboxAtob,
                btoa: sandboxBtoa,
                Buffer: _polyfills.Buffer,
                process: _polyfills.process,
                CryptoJS: _polyfills.cryptoJs,
                fetch: function () {
                  return Promise.resolve({
                    ok: true,
                    text: function () {
                      return Promise.resolve("");
                    },
                    json: function () {
                      return Promise.resolve({});
                    },
                  });
                },
                require: sr,
                module: sm,
                exports: sm.exports,
              };
              sg.global = sg;
              sg.globalThis = sg;
              try {
                var fn = new Function(
                  "require",
                  "module",
                  "exports",
                  "CryptoJS",
                  code,
                );
                fn.call(sg, sr, sm, sm.exports, _polyfills.cryptoJs, code);
              } catch (e2) {
                reject(
                  new Error("Fallback eval failed: " + (e2 && e2.message)),
                );
                return;
              }
              var mod = extractGetStreams(sm.exports);
              if (!mod) {
                reject(new Error("No getStreams (fallback): " + provider.name));
                return;
              }
              _codeCache.set(provider.id, mod);
              resolve(mod);
            })
            .catch(function (e2) {
              reject(e2);
            });
        });
    }
    attemptFetch(jsUrl);
  });
}

module.exports = {
  fetchProviderModule: fetchProviderModule,
  _codeCache: _codeCache,
};
