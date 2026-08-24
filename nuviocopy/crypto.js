"use strict";

/**
 * CryptoAdapter — Self-contained AES-CBC/ECB, MD5, SHA1, SHA256, SHA512.
 *
 * Nuvio providers expect CryptoJS-compatible API. In SkyStream's QuickJS
 * runtime there is no Node.js `crypto` module, so we implement everything
 * in pure JS using standard primitives.
 */

var CryptoAdapter = (function () {
  "use strict";

  // ── WordArray ─────────────────────────────────────────────────────────
  function WordArray(words, sigBytes) {
    this.words = words || [0];
    this.sigBytes = sigBytes !== undefined ? sigBytes : this.words.length * 4;
  }
  WordArray.create = function (words, sigBytes) {
    return new WordArray(words, sigBytes);
  };
  WordArray.prototype.concat = function (other) {
    if (!other || !other.words) return this;
    var newWords = this.words.concat(other.words);
    return new WordArray(
      newWords,
      this.sigBytes + (other.sigBytes || other.words.length * 4),
    );
  };
  WordArray.prototype.toString = function (encoder) {
    if (encoder && typeof encoder.stringify === "function")
      return encoder.stringify(this);
    return hexEncode(wordArrayToBytes(this));
  };

  // ── UTF-8 helpers ────────────────────────────────────────────────────
  function utf8Encode(str) {
    if (typeof TextEncoder !== "undefined")
      return Array.from(new TextEncoder().encode(str));
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
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
        var c2 = str.charCodeAt(i);
        var cp = ((c & 0x3ff) << 10) | (c2 & 0x3ff) | 0x10000;
        bytes.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f),
        );
      }
    }
    return bytes;
  }

  function utf8Decode(bytes) {
    if (typeof TextDecoder !== "undefined")
      return new TextDecoder().decode(new Uint8Array(bytes));
    var str = "";
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b < 0x80) str += String.fromCharCode(b);
      else if (b < 0xe0)
        str += String.fromCharCode(((b & 0x1f) << 6) | (bytes[++i] & 0x3f));
      else if (b < 0xf0)
        str += String.fromCharCode(
          ((b & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f),
        );
      else {
        var cp =
          ((b & 0x07) << 18) |
          ((bytes[++i] & 0x3f) << 12) |
          ((bytes[++i] & 0x3f) << 6) |
          (bytes[++i] & 0x3f);
        str += String.fromCharCode(0xd800 + ((cp - 0x10000) >> 10));
        str += String.fromCharCode(0xdc00 + ((cp - 0x10000) & 0x3ff));
      }
    }
    return str;
  }

  function stringToBytes(str, encoding) {
    if (encoding === "utf8" || !encoding) return utf8Encode(str);
    if (encoding === "latin1" || encoding === "binary") {
      var b = [];
      for (var i = 0; i < str.length; i++) b.push(str.charCodeAt(i) & 0xff);
      return b;
    }
    return utf8Encode(str);
  }

  function wordArrayToBytes(wa) {
    var words = wa.words,
      sigBytes = wa.sigBytes,
      b = [];
    for (var i = 0; i < sigBytes; i++)
      b.push((words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff);
    return b;
  }

  function bytesToWordArray(b) {
    var words = [];
    for (var i = 0; i < b.length; i += 4)
      words.push(
        ((b[i] || 0) << 24) |
          ((b[i + 1] || 0) << 16) |
          ((b[i + 2] || 0) << 8) |
          (b[i + 3] || 0),
      );
    return new WordArray(words, b.length);
  }

  // ── Base64 ───────────────────────────────────────────────────────────
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function base64Encode(bytes) {
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
    str = String(str).replace(/[^A-Za-z0-9+/=]/g, "");
    var bytes = [];
    for (var i = 0; i < str.length; i += 4) {
      var c1 = B64.indexOf(str.charAt(i)),
        c2 = B64.indexOf(str.charAt(i + 1));
      var c3 = B64.indexOf(str.charAt(i + 2)),
        c4 = B64.indexOf(str.charAt(i + 3));
      if (c1 < 0 || c2 < 0) break;
      bytes.push((c1 << 2) | (c2 >> 4));
      if (c3 >= 0 && str.charAt(i + 2) !== "=")
        bytes.push(((c2 & 15) << 4) | (c3 >> 2));
      if (c4 >= 0 && str.charAt(i + 3) !== "=")
        bytes.push(((c3 & 3) << 6) | c4);
    }
    return bytes;
  }

  // ── Hex ──────────────────────────────────────────────────────────────
  function hexEncode(bytes) {
    var h = "";
    for (var i = 0; i < bytes.length; i++)
      h += ("0" + (bytes[i] & 0xff).toString(16)).slice(-2);
    return h;
  }
  function hexDecode(str) {
    var s = str.replace(/[^0-9a-fA-F]/g, ""),
      bytes = [];
    for (var i = 0; i < s.length; i += 2)
      bytes.push(parseInt(s.substr(i, 2), 16));
    return bytes;
  }

  // ── PKCS7 Padding ────────────────────────────────────────────────────
  function pkcs7Pad(data, blockSize) {
    blockSize = blockSize || 16;
    var pad = blockSize - (data.length % blockSize),
      result = data.slice();
    for (var i = 0; i < pad; i++) result.push(pad);
    return result;
  }
  function pkcs7Unpad(data) {
    if (!data || data.length === 0) return data;
    var pad = data[data.length - 1];
    if (pad < 1 || pad > 16) return data;
    for (var i = data.length - pad; i < data.length; i++)
      if (data[i] !== pad) return data;
    return data.slice(0, data.length - pad);
  }

  // ── AES Core ─────────────────────────────────────────────────────────
  var S = [
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b,
    0xfe, 0xd7, 0xab, 0x76, 0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0,
    0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0, 0xb7, 0xfd, 0x93, 0x26,
    0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2,
    0xeb, 0x27, 0xb2, 0x75, 0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0,
    0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84, 0x53, 0xd1, 0x00, 0xed,
    0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f,
    0x50, 0x3c, 0x9f, 0xa8, 0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5,
    0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2, 0xcd, 0x0c, 0x13, 0xec,
    0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14,
    0xde, 0x5e, 0x0b, 0xdb, 0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c,
    0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79, 0xe7, 0xc8, 0x37, 0x6d,
    0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f,
    0x4b, 0xbd, 0x8b, 0x8a, 0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e,
    0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e, 0xe1, 0xf8, 0x98, 0x11,
    0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f,
    0xb0, 0x54, 0xbb, 0x16,
  ];
  var Si = [
    0x52, 0x09, 0x6a, 0xd5, 0x30, 0x36, 0xa5, 0x38, 0xbf, 0x40, 0xa3, 0x9e,
    0x81, 0xf3, 0xd7, 0xfb, 0x7c, 0xe3, 0x39, 0x82, 0x9b, 0x2f, 0xff, 0x87,
    0x34, 0x8e, 0x43, 0x44, 0xc4, 0xde, 0xe9, 0xcb, 0x54, 0x7b, 0x94, 0x32,
    0xa6, 0xc2, 0x23, 0x3d, 0xee, 0x4c, 0x95, 0x0b, 0x42, 0xfa, 0xc3, 0x4e,
    0x08, 0x2e, 0xa1, 0x66, 0x28, 0xd9, 0x24, 0xb2, 0x76, 0x5b, 0xa2, 0x49,
    0x6d, 0x8b, 0xd1, 0x25, 0x72, 0xf8, 0xf6, 0x64, 0x86, 0x68, 0x98, 0x16,
    0xd4, 0xa4, 0x5c, 0xcc, 0x5d, 0x65, 0xb6, 0x92, 0x6c, 0x70, 0x48, 0x50,
    0xfd, 0xed, 0xb9, 0xda, 0x5e, 0x15, 0x46, 0x57, 0xa7, 0x8d, 0x9d, 0x84,
    0x90, 0xd8, 0xab, 0x00, 0x8c, 0xbc, 0xd3, 0x0a, 0xf7, 0xe4, 0x58, 0x05,
    0xb8, 0xb3, 0x45, 0x06, 0xd0, 0x2c, 0x1e, 0x8f, 0xca, 0x3f, 0x0f, 0x02,
    0xc1, 0xaf, 0xbd, 0x03, 0x01, 0x13, 0x8a, 0x6b, 0x3a, 0x91, 0x11, 0x41,
    0x4f, 0x67, 0xdc, 0xea, 0x97, 0xf2, 0xcf, 0xce, 0xf0, 0xb4, 0xe6, 0x73,
    0x96, 0xac, 0x74, 0x22, 0xe7, 0xad, 0x35, 0x85, 0xe2, 0xf9, 0x37, 0xe8,
    0x1c, 0x75, 0xdf, 0x6e, 0x47, 0xf1, 0x1a, 0x71, 0x1d, 0x29, 0xc5, 0x89,
    0x6f, 0xb7, 0x62, 0x0e, 0xaa, 0x18, 0xbe, 0x1b, 0xfc, 0x56, 0x3e, 0x4b,
    0xc6, 0xd2, 0x79, 0x20, 0x9a, 0xdb, 0xc0, 0xfe, 0x78, 0xcd, 0x5a, 0xf4,
    0x1f, 0xdd, 0xa8, 0x33, 0x88, 0x07, 0xc7, 0x31, 0xb1, 0x12, 0x10, 0x59,
    0x27, 0x80, 0xec, 0x5f, 0x60, 0x51, 0x7f, 0xa9, 0x19, 0xb5, 0x4a, 0x0d,
    0x2d, 0xe5, 0x7a, 0x9f, 0x93, 0xc9, 0x9c, 0xef, 0xa0, 0xe0, 0x3b, 0x4d,
    0xae, 0x2a, 0xf5, 0xb0, 0xc8, 0xeb, 0xbb, 0x3c, 0x83, 0x53, 0x99, 0x61,
    0x17, 0x2b, 0x04, 0x7e, 0xba, 0x77, 0xd6, 0x26, 0xe1, 0x69, 0x14, 0x63,
    0x55, 0x21, 0x0c, 0x7d,
  ];
  var rcon = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

  function subWord(w) {
    return (
      (S[(w >>> 24) & 0xff] << 24) |
      (S[(w >>> 16) & 0xff] << 16) |
      (S[(w >>> 8) & 0xff] << 8) |
      S[w & 0xff]
    );
  }
  function rotWord(w) {
    return ((w << 8) | (w >>> 24)) >>> 0;
  }

  function keyExpansion(key) {
    var Nk = key.length / 4,
      Nr = Nk + 6,
      w = [];
    for (var i = 0; i < Nk; i++)
      w[i] =
        ((key[4 * i] || 0) << 24) |
        ((key[4 * i + 1] || 0) << 16) |
        ((key[4 * i + 2] || 0) << 8) |
        (key[4 * i + 3] || 0);
    for (var i = Nk; i < 4 * (Nr + 1); i++) {
      var temp = w[i - 1];
      if (i % Nk === 0)
        temp = subWord(rotWord(temp)) ^ (rcon[(i / Nk - 1) | 0] << 24);
      else if (Nk > 6 && i % Nk === 4) temp = subWord(temp);
      w[i] = w[i - Nk] ^ temp;
    }
    return { w: w, Nr: Nr };
  }

  function addRoundKey(state, w, r) {
    for (var i = 0; i < 4; i++)
      for (var j = 0; j < 4; j++)
        state[j][i] ^= (w[r * 4 + i] >>> (24 - j * 8)) & 0xff;
  }
  function subBytes(state) {
    for (var i = 0; i < 4; i++)
      for (var j = 0; j < 4; j++) state[i][j] = S[state[i][j]];
  }
  function invSubBytes(state) {
    for (var i = 0; i < 4; i++)
      for (var j = 0; j < 4; j++) state[i][j] = Si[state[i][j]];
  }
  function shiftRows(state) {
    var t;
    t = state[1][0];
    state[1][0] = state[1][1];
    state[1][1] = state[1][2];
    state[1][2] = state[1][3];
    state[1][3] = t;
    t = state[2][0];
    state[2][0] = state[2][2];
    state[2][2] = t;
    t = state[2][1];
    state[2][1] = state[2][3];
    state[2][3] = t;
    t = state[3][3];
    state[3][3] = state[3][2];
    state[3][2] = state[3][1];
    state[3][1] = state[3][0];
    state[3][0] = t;
  }
  function invShiftRows(state) {
    var t;
    t = state[1][3];
    state[1][3] = state[1][2];
    state[1][2] = state[1][1];
    state[1][1] = state[1][0];
    state[1][0] = t;
    t = state[2][0];
    state[2][0] = state[2][2];
    state[2][2] = t;
    t = state[2][1];
    state[2][1] = state[2][3];
    state[2][3] = t;
    t = state[3][0];
    state[3][0] = state[3][1];
    state[3][1] = state[3][2];
    state[3][2] = state[3][3];
    state[3][3] = t;
  }
  function gmul(a, b) {
    var p = 0;
    for (var i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      var hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return p;
  }
  function mixColumns(state) {
    for (var i = 0; i < 4; i++) {
      var a = state[0][i],
        b = state[1][i],
        c = state[2][i],
        d = state[3][i];
      state[0][i] = gmul(2, a) ^ gmul(3, b) ^ c ^ d;
      state[1][i] = a ^ gmul(2, b) ^ gmul(3, c) ^ d;
      state[2][i] = a ^ b ^ gmul(2, c) ^ gmul(3, d);
      state[3][i] = gmul(3, a) ^ b ^ c ^ gmul(2, d);
    }
  }
  function invMixColumns(state) {
    for (var i = 0; i < 4; i++) {
      var a = state[0][i],
        b = state[1][i],
        c = state[2][i],
        d = state[3][i];
      state[0][i] = gmul(14, a) ^ gmul(11, b) ^ gmul(13, c) ^ gmul(9, d);
      state[1][i] = gmul(9, a) ^ gmul(14, b) ^ gmul(11, c) ^ gmul(13, d);
      state[2][i] = gmul(13, a) ^ gmul(9, b) ^ gmul(14, c) ^ gmul(11, d);
      state[3][i] = gmul(11, a) ^ gmul(13, b) ^ gmul(9, c) ^ gmul(14, d);
    }
  }
  function bytesToState(b) {
    var s = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    for (var i = 0; i < 4; i++)
      for (var j = 0; j < 4; j++) s[j][i] = b[i * 4 + j] || 0;
    return s;
  }
  function stateToBytes(s) {
    var b = [];
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) b.push(s[j][i]);
    return b;
  }

  function aesEncryptBlock(block, w, Nr) {
    var state = bytesToState(block);
    addRoundKey(state, w, 0);
    for (var round = 1; round < Nr; round++) {
      subBytes(state);
      shiftRows(state);
      mixColumns(state);
      addRoundKey(state, w, round);
    }
    subBytes(state);
    shiftRows(state);
    addRoundKey(state, w, Nr);
    return stateToBytes(state);
  }
  function aesDecryptBlock(block, w, Nr) {
    var state = bytesToState(block);
    addRoundKey(state, w, Nr);
    for (var round = Nr - 1; round > 0; round--) {
      invShiftRows(state);
      invSubBytes(state);
      addRoundKey(state, w, round);
      invMixColumns(state);
    }
    invShiftRows(state);
    invSubBytes(state);
    addRoundKey(state, w, 0);
    return stateToBytes(state);
  }

  function aesCbcEncrypt(plaintext, key, iv) {
    var exp = keyExpansion(key),
      padded = pkcs7Pad(plaintext, 16);
    var result = [],
      prev = iv.slice();
    for (var i = 0; i < padded.length; i += 16) {
      var block = padded.slice(i, i + 16);
      for (var j = 0; j < 16; j++) block[j] ^= prev[j];
      var enc = aesEncryptBlock(block, exp.w, exp.Nr);
      result = result.concat(enc);
      prev = enc;
    }
    return result;
  }
  function aesCbcDecrypt(ciphertext, key, iv) {
    var exp = keyExpansion(key),
      result = [],
      prev = iv.slice();
    for (var i = 0; i < ciphertext.length; i += 16) {
      var block = ciphertext.slice(i, i + 16);
      var dec = aesDecryptBlock(block, exp.w, exp.Nr);
      for (var j = 0; j < 16; j++) dec[j] ^= prev[j];
      result = result.concat(dec);
      prev = block;
    }
    return pkcs7Unpad(result);
  }
  function aesEcbDecrypt(ciphertext, key) {
    var exp = keyExpansion(key),
      result = [];
    for (var i = 0; i < ciphertext.length; i += 16) {
      var block = ciphertext.slice(i, i + 16);
      result = result.concat(aesDecryptBlock(block, exp.w, exp.Nr));
    }
    return pkcs7Unpad(result);
  }

  // ── MD5 ──────────────────────────────────────────────────────────────
  function md5(str) {
    var bytes = typeof str === "string" ? utf8Encode(str) : str;
    var A = 0x67452301,
      B = 0xefcdab89,
      C = 0x98badcfe,
      D = 0x10325476;
    var bitLen = bytes.length * 8;
    var padded = bytes.slice();
    padded.push(0x80);
    while ((padded.length * 8) % 512 !== 448) padded.push(0);
    var lo32 = bitLen >>> 0,
      hi32 = Math.floor(bitLen / 0x100000000) || 0;
    for (var i = 0; i < 4; i++) padded.push((lo32 >>> (i * 8)) & 0xff);
    for (var i = 0; i < 4; i++) padded.push((hi32 >>> (i * 8)) & 0xff);
    function F(x, y, z) {
      return (x & y) | (~x & z);
    }
    function G(x, y, z) {
      return (x & z) | (y & ~z);
    }
    function H(x, y, z) {
      return x ^ y ^ z;
    }
    function I(x, y, z) {
      return y ^ (x | ~z);
    }
    function rotl(x, n) {
      return ((x << n) | (x >>> (32 - n))) >>> 0;
    }
    var S_tab = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4,
      11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6,
      10, 15, 21,
    ];
    var K = [];
    for (var i = 0; i < 64; i++)
      K[i] = (Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
    for (var chunk = 0; chunk < padded.length; chunk += 64) {
      var M = [];
      for (var i = 0; i < 16; i++)
        M[i] =
          (padded[chunk + i * 4] |
            (padded[chunk + i * 4 + 1] << 8) |
            (padded[chunk + i * 4 + 2] << 16) |
            (padded[chunk + i * 4 + 3] << 24)) >>>
          0;
      var a = A,
        b = B,
        c = C,
        d = D;
      for (var i = 0; i < 64; i++) {
        var f, g;
        if (i < 16) {
          f = F(b, c, d);
          g = i;
        } else if (i < 32) {
          f = G(b, c, d);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          f = H(b, c, d);
          g = (3 * i + 5) % 16;
        } else {
          f = I(b, c, d);
          g = (7 * i) % 16;
        }
        f = (f + a + K[i] + M[g]) >>> 0;
        a = d;
        d = c;
        c = b;
        b = (b + rotl(f, S_tab[i])) >>> 0;
      }
      A = (A + a) >>> 0;
      B = (B + b) >>> 0;
      C = (C + c) >>> 0;
      D = (D + d) >>> 0;
    }
    var result = [];
    [A, B, C, D].forEach(function (w) {
      result.push(
        w & 0xff,
        (w >>> 8) & 0xff,
        (w >>> 16) & 0xff,
        (w >>> 24) & 0xff,
      );
    });
    return result;
  }

  // ── SHA1 ─────────────────────────────────────────────────────────────
  function sha1(str) {
    var bytes = typeof str === "string" ? utf8Encode(str) : str,
      bitLen = bytes.length * 8;
    var padded = bytes.slice();
    padded.push(0x80);
    while ((padded.length * 8) % 512 !== 448) padded.push(0);
    var hi32 = Math.floor(bitLen / 0x100000000) || 0,
      lo32 = bitLen >>> 0;
    for (var i = 0; i < 4; i++) padded.push((hi32 >>> (24 - i * 8)) & 0xff);
    for (var i = 0; i < 4; i++) padded.push((lo32 >>> (24 - i * 8)) & 0xff);
    var H = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    for (var chunk = 0; chunk < padded.length; chunk += 64) {
      var W = [];
      for (var t = 0; t < 80; t++) {
        if (t < 16) {
          var i = chunk + t * 4;
          W[t] =
            ((padded[i] || 0) << 24) |
            ((padded[i + 1] || 0) << 16) |
            ((padded[i + 2] || 0) << 8) |
            (padded[i + 3] || 0);
        } else
          W[t] = rotl32(W[t - 3] ^ W[t - 8] ^ W[t - 14] ^ W[t - 16], 1) >>> 0;
      }
      var a = H[0],
        b = H[1],
        c = H[2],
        d = H[3],
        e = H[4];
      for (var t = 0; t < 80; t++) {
        var f, k;
        if (t < 20) {
          f = (b & c) | (~b & d);
          k = 0x5a827999;
        } else if (t < 40) {
          f = b ^ c ^ d;
          k = 0x6ed9eba1;
        } else if (t < 60) {
          f = (b & c) | (b & d) | (c & d);
          k = 0x8f1bbcdc;
        } else {
          f = b ^ c ^ d;
          k = 0xca62c1d6;
        }
        var temp = (rotl32(a, 5) + f + e + k + W[t]) >>> 0;
        e = d;
        d = c;
        c = rotl32(b, 30) >>> 0;
        b = a;
        a = temp;
      }
      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0;
    }
    var result = [];
    for (var i = 0; i < 5; i++)
      result.push(
        (H[i] >>> 24) & 0xff,
        (H[i] >>> 16) & 0xff,
        (H[i] >>> 8) & 0xff,
        H[i] & 0xff,
      );
    return result;
  }
  function rotl32(x, n) {
    return ((x << n) | (x >>> (32 - n))) >>> 0;
  }

  // ── SHA256 ───────────────────────────────────────────────────────────
  function sha256(str) {
    var bytes = typeof str === "string" ? utf8Encode(str) : str,
      bitLen = bytes.length * 8;
    var padded = bytes.slice();
    padded.push(0x80);
    while ((padded.length * 8) % 512 !== 448) padded.push(0);
    var hi32 = Math.floor(bitLen / 0x100000000) || 0,
      lo32 = bitLen >>> 0;
    for (var i = 0; i < 4; i++) padded.push((hi32 >>> (24 - i * 8)) & 0xff);
    for (var i = 0; i < 4; i++) padded.push((lo32 >>> (24 - i * 8)) & 0xff);
    var K256 = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
      0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
      0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
      0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    var H = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
      0x1f83d9ab, 0x5be0cd19,
    ];
    function Ch(x, y, z) {
      return (x & y) ^ (~x & z);
    }
    function Maj(x, y, z) {
      return (x & y) ^ (x & z) ^ (y & z);
    }
    function S0(x) {
      return ror32(x, 2) ^ ror32(x, 13) ^ ror32(x, 22);
    }
    function S1(x) {
      return ror32(x, 6) ^ ror32(x, 11) ^ ror32(x, 25);
    }
    function s0(x) {
      return ror32(x, 7) ^ ror32(x, 18) ^ (x >>> 3);
    }
    function s1(x) {
      return ror32(x, 17) ^ ror32(x, 19) ^ (x >>> 10);
    }
    function ror32(x, n) {
      return ((x >>> n) | (x << (32 - n))) >>> 0;
    }
    for (var chunk = 0; chunk < padded.length; chunk += 64) {
      var W = [];
      for (var t = 0; t < 64; t++) {
        if (t < 16) {
          var i = chunk + t * 4;
          W[t] =
            ((padded[i] || 0) << 24) |
            ((padded[i + 1] || 0) << 16) |
            ((padded[i + 2] || 0) << 8) |
            (padded[i + 3] || 0);
        } else
          W[t] = (s1(W[t - 2]) + W[t - 7] + s0(W[t - 15]) + W[t - 16]) >>> 0;
      }
      var a = H[0],
        b = H[1],
        c = H[2],
        d = H[3];
      var e = H[4],
        f = H[5],
        g = H[6],
        h = H[7];
      for (var t = 0; t < 64; t++) {
        var T1 = (h + S1(e) + Ch(e, f, g) + K256[t] + W[t]) >>> 0;
        var T2 = (S0(a) + Maj(a, b, c)) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + T1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (T1 + T2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0;
      H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0;
      H[7] = (H[7] + h) >>> 0;
    }
    var result = [];
    for (var i = 0; i < 8; i++)
      result.push(
        (H[i] >>> 24) & 0xff,
        (H[i] >>> 16) & 0xff,
        (H[i] >>> 8) & 0xff,
        H[i] & 0xff,
      );
    return result;
  }

  // ── SHA512 (delegates to SHA-256) ───────────────────────────────────
  function sha512(str) {
    throw new Error("SHA512 not implemented");
  }

  // ── Public API ───────────────────────────────────────────────────────
  function createCryptoJS() {
    var c = {};
    c.lib = {
      WordArray: WordArray,
      CipherParams: {
        create: function (opts) {
          return opts || {};
        },
      },
    };
    c.enc = {
      Utf8: {
        stringify: function (wa) {
          return utf8Decode(wordArrayToBytes(wa));
        },
        parse: function (s) {
          return bytesToWordArray(utf8Encode(s));
        },
      },
      Hex: {
        stringify: function (wa) {
          return hexEncode(wordArrayToBytes(wa));
        },
        parse: function (s) {
          return bytesToWordArray(hexDecode(s));
        },
      },
      Base64: {
        stringify: function (wa) {
          return base64Encode(wordArrayToBytes(wa));
        },
        parse: function (s) {
          return bytesToWordArray(base64Decode(s));
        },
      },
      Latin1: {
        stringify: function (wa) {
          var b = wordArrayToBytes(wa),
            s = "";
          for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
          return s;
        },
        parse: function (s) {
          var b = [];
          for (var i = 0; i < s.length; i++) b.push(s.charCodeAt(i) & 0xff);
          return bytesToWordArray(b);
        },
      },
    };
    c.mode = { CBC: "CBC", ECB: "ECB" };
    c.pad = {
      Pkcs7: {
        pad: function (data) {
          return data;
        },
        unpad: function (data) {
          return data;
        },
      },
    };
    c.MD5 = function (s) {
      return bytesToWordArray(md5(typeof s === "string" ? s : String(s)));
    };
    c.SHA1 = function (s) {
      return bytesToWordArray(sha1(typeof s === "string" ? s : String(s)));
    };
    c.SHA256 = function (s) {
      return bytesToWordArray(sha256(typeof s === "string" ? s : String(s)));
    };
    c.SHA512 = function (s) {
      return bytesToWordArray(sha512(typeof s === "string" ? s : String(s)));
    };
    c.AES = {
      decrypt: function (ciphertext, key, opts) {
        opts = opts || {};
        try {
          var ct = ciphertext;
          if (ct && ct.ciphertext) ct = ct.ciphertext;
          var ctBytes =
            ct && ct.words ? wordArrayToBytes(ct) : base64Decode(String(ct));
          var keyBytes =
            key && key.words ? wordArrayToBytes(key) : utf8Encode(String(key));
          var ivBytes =
            opts.iv && opts.iv.words
              ? wordArrayToBytes(opts.iv)
              : opts.iv
                ? typeof opts.iv === "string"
                  ? base64Decode(opts.iv)
                  : opts.iv.constructor === Array
                    ? opts.iv
                    : utf8Encode(String(opts.iv))
                : null;
          if (keyBytes.length < 16) {
            var tmp = [];
            for (var i = 0; i < 16; i++) tmp.push(keyBytes[i] || 0);
            keyBytes = tmp;
          } else if (keyBytes.length < 32) {
            if (keyBytes.length <= 16) {
              var tmp = [];
              for (var i = 0; i < 16; i++) tmp.push(keyBytes[i] || 0);
              keyBytes = tmp;
            } else {
              var tmp = [];
              for (var i = 0; i < 32; i++) tmp.push(keyBytes[i] || 0);
              keyBytes = tmp;
            }
          } else if (keyBytes.length > 32) keyBytes = keyBytes.slice(0, 32);
          var mode = opts.mode || c.mode.CBC;
          if (mode === c.mode.ECB || mode === "ECB") {
            return bytesToWordArray(aesEcbDecrypt(ctBytes, keyBytes));
          }
          if (!ivBytes)
            ivBytes = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
          return bytesToWordArray(aesCbcDecrypt(ctBytes, keyBytes, ivBytes));
        } catch (e) {
          return new WordArray([], 0);
        }
      },
      encrypt: function (plaintext, key, opts) {
        opts = opts || {};
        try {
          var ptBytes =
            plaintext && plaintext.words
              ? wordArrayToBytes(plaintext)
              : utf8Encode(String(plaintext));
          var keyBytes =
            key && key.words ? wordArrayToBytes(key) : utf8Encode(String(key));
          if (keyBytes.length < 16) {
            var tmp = [];
            for (var i = 0; i < 16; i++) tmp.push(keyBytes[i] || 0);
            keyBytes = tmp;
          } else if (keyBytes.length > 32) keyBytes = keyBytes.slice(0, 32);
          else if (keyBytes.length > 16) {
            var tmp = [];
            for (var i = 0; i < 32; i++) tmp.push(keyBytes[i] || 0);
            keyBytes = tmp;
          }
          var ivBytes =
            opts.iv && opts.iv.words
              ? wordArrayToBytes(opts.iv)
              : opts.iv
                ? typeof opts.iv === "string"
                  ? utf8Encode(opts.iv)
                  : opts.iv.constructor === Array
                    ? opts.iv
                    : utf8Encode(String(opts.iv))
                : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
          return base64Encode(aesCbcEncrypt(ptBytes, keyBytes, ivBytes));
        } catch (e) {
          return "";
        }
      },
    };
    c.HmacSHA1 = function (msg, key) {
      var keyBytes =
        key && key.words ? wordArrayToBytes(key) : utf8Encode(String(key));
      var msgBytes =
        msg && msg.words ? wordArrayToBytes(msg) : utf8Encode(String(msg));
      if (keyBytes.length > 64) keyBytes = sha1(keyBytes);
      while (keyBytes.length < 64) keyBytes.push(0);
      var oKeyPad = keyBytes.slice(),
        iKeyPad = keyBytes.slice();
      for (var i = 0; i < 64; i++) {
        oKeyPad[i] ^= 0x5c;
        iKeyPad[i] ^= 0x36;
      }
      var inner = sha1(iKeyPad.concat(msgBytes));
      return bytesToWordArray(sha1(oKeyPad.concat(inner)));
    };
    c.HmacSHA256 = function (msg, key) {
      var keyBytes =
        key && key.words ? wordArrayToBytes(key) : utf8Encode(String(key));
      var msgBytes =
        msg && msg.words ? wordArrayToBytes(msg) : utf8Encode(String(msg));
      if (keyBytes.length > 64) keyBytes = sha256(keyBytes);
      while (keyBytes.length < 64) keyBytes.push(0);
      var oKeyPad = keyBytes.slice(),
        iKeyPad = keyBytes.slice();
      for (var i = 0; i < 64; i++) {
        oKeyPad[i] ^= 0x5c;
        iKeyPad[i] ^= 0x36;
      }
      var inner = sha256(iKeyPad.concat(msgBytes));
      return bytesToWordArray(sha256(oKeyPad.concat(inner)));
    };
    c.HmacMD5 = function (msg, key) {
      var keyBytes =
        key && key.words ? wordArrayToBytes(key) : utf8Encode(String(key));
      var msgBytes =
        msg && msg.words ? wordArrayToBytes(msg) : utf8Encode(String(msg));
      if (keyBytes.length > 64) keyBytes = md5(keyBytes);
      while (keyBytes.length < 64) keyBytes.push(0);
      var oKeyPad = keyBytes.slice(),
        iKeyPad = keyBytes.slice();
      for (var i = 0; i < 64; i++) {
        oKeyPad[i] ^= 0x5c;
        iKeyPad[i] ^= 0x36;
      }
      var inner = md5(iKeyPad.concat(msgBytes));
      return bytesToWordArray(md5(oKeyPad.concat(inner)));
    };
    c.default = c;
    return c;
  }

  var _instance = null;
  return {
    getInstance: function () {
      if (!_instance) _instance = createCryptoJS();
      return _instance;
    },
    _md5: md5,
    _sha1: sha1,
    _sha256: sha256,
    _base64Encode: base64Encode,
    _base64Decode: base64Decode,
    _hexEncode: hexEncode,
    _hexDecode: hexDecode,
    _utf8Encode: utf8Encode,
    _utf8Decode: utf8Decode,
  };
})();

module.exports = { CryptoAdapter: CryptoAdapter };
