import {
  clean,
  isPublicHttp,
  reqHeaders,
  followTokenChain,
  parseQuality,
  parseSize,
} from "./_common.js";

const UPER_TLDS = ["net", "io", "com", "cx"];

function normalizeUperbox(pageUrl) {
  try {
    const u = new URL(pageUrl);
    const parts = u.hostname.toLowerCase().split(".");
    if (
      parts.length === 2 &&
      parts[0] === "uperbox" &&
      UPER_TLDS.includes(parts[1])
    ) {
      u.hostname = "www." + u.hostname;
      return u.toString();
    }
  } catch (e) {}
  return pageUrl;
}

export async function resolveUperbox(embedUrl, referer) {
  const pageUrl = normalizeUperbox(clean(embedUrl));
  if (!isPublicHttp(pageUrl)) return [];
  const hop = await followTokenChain(pageUrl, referer);
  if (!hop || !hop.fileUrl) return [];
  return [
    {
      url: hop.fileUrl,
      quality: parseQuality(hop.title) || "HD",
      size: parseSize(hop.title),
      headers: reqHeaders(hop.dlPage, hop.host),
    },
  ];
}
