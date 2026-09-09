import {
  clean,
  isPublicHttp,
  reqHeaders,
  fetchHtml,
  unpackWithBridge,
} from "./_common.js";

const DEAD = [
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
const LINKS_RE = /var\s+links\s*=\s*(\{[^}]+\})/g;
const SRC_RE = /sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/gi;
const HLS_ORDER = ["hls4", "hls3", "hls2"];

export async function resolveFilelions(embedUrl, referer) {
  const pageUrl = clean(embedUrl);
  if (!isPublicHttp(pageUrl)) return [];
  let u;
  try {
    u = new URL(pageUrl);
  } catch (e) {
    return [];
  }
  let host = u.hostname.toLowerCase();
  for (let i = 0; i < DEAD.length; i++) {
    if (host === DEAD[i] || host.endsWith("." + DEAD[i])) {
      host = "callistanise.com";
      break;
    }
  }
  const target = "https://" + host + u.pathname + (u.search || "");
  const html = await fetchHtml(
    target,
    reqHeaders(referer || "https://" + host + "/", "https://" + host),
  );
  if (!html) return [];
  const code = unpackWithBridge(html);
  const streamHeaders = reqHeaders(target, "https://" + host);
  const out = [];
  const push = (link) => {
    link = clean(link);
    if (!link) return;
    if (link.indexOf("//") === 0) link = "https:" + link;
    else if (link.charAt(0) === "/") link = "https://" + host + link;
    if (!isPublicHttp(link)) return;
    for (let i = 0; i < out.length; i++) if (out[i].url === link) return;
    out.push({ url: link, quality: "Auto", headers: streamHeaders });
  };
  LINKS_RE.lastIndex = 0;
  let lm;
  while ((lm = LINKS_RE.exec(code)) !== null) {
    for (let i = 0; i < HLS_ORDER.length; i++) {
      const km = new RegExp('"' + HLS_ORDER[i] + '"\\s*:\\s*"([^"]+)"').exec(
        lm[1],
      );
      if (km) push(km[1]);
    }
  }
  if (out.length) return out;
  SRC_RE.lastIndex = 0;
  let sm;
  while ((sm = SRC_RE.exec(code)) !== null) push(sm[1]);
  return out;
}
