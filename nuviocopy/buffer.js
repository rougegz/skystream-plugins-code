"use strict";

/**
 * BufferAdapter — Proper Buffer polyfill using TextEncoder/TextDecoder.
 * Used by providers that expect Node.js Buffer API.
 */

var BufferAdapter = (function () {
  "use strict";

  function base64Encode(bytes) {
    var B64 =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var result = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i],
        b1 = bytes[i + 1],
        b2 = bytes[i + 2];
      result += B64.charAt(b0 >> 2);
      result += B64.charAt(((b0 & 3) << 4) | ((b1 || 0) >> 4));
      if (b1 === undefined) {
        result += "==";
        break;
      }
      result += B64.charAt(((b1 & 15) << 2) | ((b2 || 0) >> 6));
      if (b2 === undefined) {
        result += "=";
        break;
      }
      result += B64.charAt(b2 & 63);
    }
    return result;
  }

  function base64Decode(str) {
    var B64 =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    str = String(str).replace(/[^A-Za-z0-9+/=]/g, "");
    var bytes = [];
    for (var i = 0; i < str.length; i += 4) {
      var c1 = B64.indexOf(str.charAt(i));
      var c2 = B64.indexOf(str.charAt(i + 1));
      var c3 = B64.indexOf(str.charAt(i + 2));
      var c4 = B64.indexOf(str.charAt(i + 3));
      if (c1 < 0 || c2 < 0) break;
      bytes.push((c1 << 2) | (c2 >> 4));
      if (c3 >= 0 && str.charAt(i + 2) !== "=")
        bytes.push(((c2 & 15) << 4) | (c3 >> 2));
      if (c4 >= 0 && str.charAt(i + 3) !== "=")
        bytes.push(((c3 & 3) << 6) | c4);
    }
    return bytes;
  }

  function createBuffer(thing, encoding) {
    if (typeof thing === "number") return new Uint8Array(thing);
    if (thing instanceof Uint8Array) return thing;
    if (typeof thing === "string") {
      encoding = (encoding || "utf8").toLowerCase();
      var bytes;
      if (encoding === "base64") bytes = base64Decode(thing);
      else if (encoding === "hex") {
        var s = thing.replace(/[^0-9a-fA-F]/g, "");
        bytes = [];
        for (var i = 0; i < s.length; i += 2)
          bytes.push(parseInt(s.substr(i, 2), 16));
      } else if (encoding === "binary" || encoding === "latin1") {
        bytes = [];
        for (var i = 0; i < thing.length; i++)
          bytes.push(thing.charCodeAt(i) & 0xff);
      } else {
        // Default: utf8
        if (typeof TextEncoder !== "undefined")
          return new TextEncoder().encode(thing);
        bytes = [];
        for (var i = 0; i < thing.length; i++) {
          var c = thing.charCodeAt(i);
          if (c < 0x80) bytes.push(c);
          else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
          else if (c < 0xd800 || c >= 0xe000)
            bytes.push(
              0xe0 | (c >> 12),
              0x80 | ((c >> 6) & 0x3f),
              0x80 | (c & 0x3f),
            );
          else {
            i++;
            var c2 = thing.charCodeAt(i);
            var cp = ((c & 0x3ff) << 10) | (c2 & 0x3ff) | 0x10000;
            bytes.push(
              0xf0 | (cp >> 18),
              0x80 | ((cp >> 12) & 0x3f),
              0x80 | ((cp >> 6) & 0x3f),
              0x80 | (cp & 0x3f),
            );
          }
        }
      }
      return new Uint8Array(bytes);
    }
    if (Array.isArray(thing)) return new Uint8Array(thing);
    return new Uint8Array(0);
  }

  function bufferToString(buf, encoding) {
    if (!buf) return "";
    encoding = (encoding || "utf8").toLowerCase();
    var arr =
      buf instanceof Uint8Array
        ? Array.from(buf)
        : Array.from(new Uint8Array(buf));
    if (encoding === "base64") return base64Encode(arr);
    if (encoding === "hex") {
      var h = "";
      for (var i = 0; i < arr.length; i++)
        h += ("0" + (arr[i] & 0xff).toString(16)).slice(-2);
      return h;
    }
    if (encoding === "binary" || encoding === "latin1") {
      var s = "";
      for (var i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
      return s;
    }
    // Default: utf8
    if (typeof TextDecoder !== "undefined")
      return new TextDecoder().decode(new Uint8Array(arr));
    var str = "";
    for (var i = 0; i < arr.length; i++) {
      var b = arr[i];
      if (b < 0x80) str += String.fromCharCode(b);
      else if (b < 0xe0)
        str += String.fromCharCode(((b & 0x1f) << 6) | (arr[++i] & 0x3f));
      else if (b < 0xf0)
        str += String.fromCharCode(
          ((b & 0x0f) << 12) | ((arr[++i] & 0x3f) << 6) | (arr[++i] & 0x3f),
        );
      else {
        var cp =
          ((b & 0x07) << 18) |
          ((arr[++i] & 0x3f) << 12) |
          ((arr[++i] & 0x3f) << 6) |
          (arr[++i] & 0x3f);
        str += String.fromCharCode(0xd800 + ((cp - 0x10000) >> 10));
        str += String.fromCharCode(0xdc00 + ((cp - 0x10000) & 0x3ff));
      }
    }
    return str;
  }

  function bufConcat(list) {
    if (!list || !list.length) return new Uint8Array(0);
    var total = 0;
    for (var i = 0; i < list.length; i++) total += (list[i] || []).length || 0;
    var result = new Uint8Array(total);
    var offset = 0;
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (item) {
        result.set(
          item instanceof Uint8Array ? item : new Uint8Array(item),
          offset,
        );
        offset += item.length || 0;
      }
    }
    return result;
  }

  return {
    Buffer: createBuffer,
    toString: bufferToString,
    concat: bufConcat,
    base64Encode: base64Encode,
    base64Decode: base64Decode,
  };
})();

module.exports = { BufferAdapter: BufferAdapter };
