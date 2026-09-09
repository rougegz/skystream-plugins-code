export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\]|fc00:|fe80:)/i;

const PACKER_RE =
  /eval\(function\(p,a,c,k,e,d?\)[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/g;

const PACKER_ALPHA =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

const QUALITY_RANK = {
  "2160p": 0,
  "1080p": 1,
  "720p": 2,
  "480p": 3,
  hd: 4,
  auto: 5,
};

export function clean(u) {
  return (u || "")
    .replace(/[\r\n\t ]/g, "")
    .trim()
    .replace(/&amp;/g, "&");
}

export function abs(href, base) {
  href = clean(href);
  if (!href) return "";
  if (href.indexOf("http") === 0) return href;
  try {
    return new URL(href, base).toString();
  } catch (e) {
    return "";
  }
}

export function isPublicHttp(u) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return (
      (u.indexOf("https://") === 0 || u.indexOf("http://") === 0) &&
      !PRIVATE_HOST.test(h)
    );
  } catch (e) {
    return false;
  }
}

export function reqHeaders(referer, origin) {
  return {
    "User-Agent": UA,
    Referer: referer,
    Origin: origin,
    Connection: "keep-alive",
  };
}

export async function fetchHtml(url, headers) {
  try {
    const res = await http_get(url, headers);
    if (!res || typeof res.body !== "string") return "";
    return res.body;
  } catch (e) {
    return "";
  }
}

export function parseQuality(s) {
  const t = String(s || "").toLowerCase();
  if (/(4k|2160p|uhd)/.test(t)) return "2160p";
  if (/1080p/.test(t)) return "1080p";
  if (/720p/.test(t)) return "720p";
  if (/480p/.test(t)) return "480p";
  return "";
}

export function parseSize(s) {
  const m = /(\d+(?:\.\d+)?)\s*(mb|gb)/i.exec(String(s || ""));
  return m ? m[1] + m[2].toUpperCase() : "";
}

export function qualityRank(q) {
  const r = QUALITY_RANK[String(q || "").toLowerCase()];
  return r === undefined ? 4 : r;
}

export function pageTitle(html) {
  const m = /<title>([^<]+)<\/title>/i.exec(html || "");
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

export async function followTokenChain(pageUrl, referer) {
  let host = "";
  try {
    host = new URL(pageUrl).origin;
  } catch (e) {
    return null;
  }
  const landing = await fetchHtml(
    pageUrl,
    reqHeaders(referer || host + "/", host),
  );
  if (!landing) return null;
  const result = {
    host,
    landing,
    title: pageTitle(landing),
    dlPage: "",
    page: "",
    fileUrl: "",
  };
  const m1 = /href=["']([^"']*\/download\?token=[^"']+)["']/i.exec(landing);
  result.dlPage = abs(m1 && m1[1], pageUrl);
  if (!isPublicHttp(result.dlPage)) return result;
  result.page = await fetchHtml(result.dlPage, reqHeaders(pageUrl, host));
  const m2 = /href=["']([^"']*\/dl\?code=[^"']+)["']/i.exec(result.page);
  result.fileUrl = abs(m2 && m2[1], result.dlPage);
  if (!isPublicHttp(result.fileUrl)) result.fileUrl = "";
  return result;
}

function packerBaseN(num, base) {
  if (num === 0) return "0";
  let s = "";
  while (num > 0 && s.length < 12) {
    s = PACKER_ALPHA[num % base] + s;
    num = Math.floor(num / base);
  }
  return s;
}

export function unpackPacker(body) {
  const src = String(body || "").slice(0, 500000);
  PACKER_RE.lastIndex = 0;
  const out = [];
  let m;
  let rounds = 0;
  while ((m = PACKER_RE.exec(src)) !== null && rounds < 10) {
    rounds++;
    const p0 = m[1];
    const a = parseInt(m[2], 10);
    const c = parseInt(m[3], 10);
    const k = m[4].split("|");
    if (!(a >= 2 && a <= 62) || !(c >= 0 && c <= 2000) || !k.length) continue;
    let p = p0;
    for (let i = c - 1; i >= 0; i--) {
      if (k[i]) {
        const rep = k[i];
        p = p.replace(
          new RegExp("\\b" + packerBaseN(i, a) + "\\b", "g"),
          () => rep,
        );
      }
    }
    out.push(p);
  }
  return out.join("\n");
}

export function unpackWithBridge(body) {
  let code = String(body || "");
  try {
    if (typeof getAndUnpack === "function") {
      const unpacked = getAndUnpack(code);
      if (unpacked && unpacked !== code) code = code + "\n" + unpacked;
    }
  } catch (e) {
    code = String(body || "");
  }
  const local = unpackPacker(code);
  if (local) code = code + "\n" + local;
  return code;
}
