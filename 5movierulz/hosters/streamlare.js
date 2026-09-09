import { clean, isPublicHttp, reqHeaders, fetchHtml } from "./_common.js";

const SOURCE_RES = [
  /<source[^>]+src="([^"]+)"/gi,
  /file\s*:\s*["'](https?:\/\/[^"']+)["']/gi,
  /(https?:\/\/[^\s"'<>]+\.(m3u8|mp4)[^\s"'<>]*)/gi,
];

const ASSET_EXT = /\.(png|jpe?g|gif|webp|svg|css|js|vtt|srt)(\?|#|$)/i;

export async function resolveStreamlare(embedUrl, referer) {
  const url = clean(embedUrl);
  if (!isPublicHttp(url)) return [];
  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch (e) {
    return [];
  }
  const headers = reqHeaders(referer || origin + "/", origin);
  const html = await fetchHtml(url, headers);
  if (!html) return [];
  const out = [];
  for (let p = 0; p < SOURCE_RES.length; p++) {
    SOURCE_RES[p].lastIndex = 0;
    let m;
    while ((m = SOURCE_RES[p].exec(html)) !== null) {
      const u = clean(m[1]);
      if (!isPublicHttp(u) || ASSET_EXT.test(u)) continue;
      let dup = false;
      for (let i = 0; i < out.length; i++) if (out[i].url === u) dup = true;
      if (dup) continue;
      out.push({
        url: u,
        quality: /(\.m3u8|\/hls\/)/i.test(u) ? "Auto" : "HD",
        headers,
      });
    }
    if (out.length) return out;
  }
  const api = await streamlareApi(url, headers);
  if (api.length) return api;
  return out;
}

async function streamlareApi(url, headers) {
  const out = [];
  let apiBase = "";
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "streamlare.com" || host.endsWith(".streamlare.com")) {
      apiBase = "https://streamlare.com/";
    } else if (host === "slmaxed.com" || host.endsWith(".slmaxed.com")) {
      apiBase = "https://slmaxed.com/";
    } else {
      return out;
    }
  } catch (e) {
    return out;
  }
  const idMatch = /\/(e|v)\/([^\/?#]+)/.exec(url);
  if (!idMatch) return out;
  let payload = "";
  try {
    const res = await http_post(
      apiBase + "api/video/stream/get",
      {
        "User-Agent": headers["User-Agent"],
        Referer: url,
        Origin: apiBase.replace(/\/$/, ""),
        "Content-Type": "application/json",
        Connection: "keep-alive",
      },
      JSON.stringify({ id: idMatch[2] }),
    );
    if (!res || typeof res.body !== "string") return out;
    payload = res.body;
  } catch (e) {
    return out;
  }
  const fileRe = /"file"\s*:\s*"([^"]+)"/g;
  const labelRe = /"label"\s*:\s*"([^"]*)"/g;
  let fm;
  const files = [];
  const labels = [];
  while ((fm = fileRe.exec(payload)) !== null) files.push(fm[1]);
  while ((fm = labelRe.exec(payload)) !== null) labels.push(fm[1]);
  for (let i = 0; i < files.length; i++) {
    const u = clean(files[i]);
    if (!isPublicHttp(u)) continue;
    const lm = /(\d{3,4})p/.exec(labels[i] || "");
    out.push({
      url: u,
      quality: lm ? lm[1] + "p" : "Auto",
      headers: reqHeaders(url, apiBase.replace(/\/$/, "")),
    });
  }
  return out;
}
