import {
  clean,
  isPublicHttp,
  reqHeaders,
  fetchHtml,
  unpackWithBridge,
} from "./_common.js";

const RULE_HOSTS = ["dhcplay.com", "hglink.to", "hgcloud.to"];
const RULE_MIRRORS = [
  "hanerix.com",
  "audinifer.com",
  "vibuxer.com",
  "masukestin.com",
  "streamhls.to",
  "wishfast.top",
];
const DMCA_MIRRORS = [
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

const SRC_RE =
  /sources\s*:\s*\[\s*\{\s*file\s*:\s*["'](https?:\/\/[^"']+)["']/gi;
const HLS_RE = /"hls[24]"\s*:\s*"((?:https?:)?\/\/[^"]+)"/gi;
const FILE_RE = /file\s*:\s*["'](https?:\/\/[^"']+\.(m3u8|mp4)[^"']*)["']/gi;
const ASSET_EXT = /\.(png|jpe?g|gif|webp|svg|css|js|vtt|srt)(\?|#|$)/i;

export async function resolveStreamwish(embedUrl, referer) {
  const pageUrl = clean(embedUrl);
  if (!isPublicHttp(pageUrl)) return [];
  const idMatch =
    /\/(e|f|d)\/([A-Za-z0-9]+)/.exec(pageUrl) ||
    /\/([A-Za-z0-9]{6,})[\/?#]?$/.exec(pageUrl);
  const mediaId = idMatch ? idMatch[idMatch.length - 1] : "";
  let host = "";
  try {
    host = new URL(pageUrl).hostname.toLowerCase();
  } catch (e) {
    return [];
  }
  const pool = RULE_HOSTS.indexOf(host) !== -1 ? RULE_MIRRORS : DMCA_MIRRORS;
  const candidates = [pageUrl];
  if (mediaId) {
    for (let i = 0; i < pool.length; i++) {
      candidates.push("https://" + pool[i] + "/e/" + mediaId);
    }
  }
  const out = [];
  const push = (u, headers) => {
    u = clean(u);
    if (u.indexOf("//") === 0) u = "https:" + u;
    if (!isPublicHttp(u) || ASSET_EXT.test(u)) return;
    for (let i = 0; i < out.length; i++) if (out[i].url === u) return;
    out.push({ url: u, quality: /\.m3u8/i.test(u) ? "Auto" : "HD", headers });
  };
  for (let c = 0; c < candidates.length; c++) {
    let origin = "";
    try {
      origin = new URL(candidates[c]).origin;
    } catch (e) {
      continue;
    }
    const headers = reqHeaders(referer || origin + "/", origin);
    const body = await fetchHtml(candidates[c], headers);
    if (!body) continue;
    if (body.indexOf("Page is loading") !== -1 && body.length < 3000) continue;
    const code = unpackWithBridge(body);
    const res = [SRC_RE, HLS_RE, FILE_RE];
    for (let r = 0; r < res.length; r++) {
      res[r].lastIndex = 0;
      let m;
      while ((m = res[r].exec(code)) !== null) push(m[1], headers);
    }
    if (out.length) return out;
  }
  return out;
}
