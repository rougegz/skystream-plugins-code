import {
  clean,
  isPublicHttp,
  reqHeaders,
  followTokenChain,
  parseQuality,
  parseSize,
} from "./_common.js";

export async function resolveEasysyncr(embedUrl, referer) {
  const pageUrl = clean(embedUrl);
  if (!isPublicHttp(pageUrl)) return [];
  const hop = await followTokenChain(pageUrl, referer);
  if (!hop || !hop.fileUrl) return [];
  const measured = /(\d+\.\d+)\s*MB/.exec(hop.page || "");
  return [
    {
      url: hop.fileUrl,
      quality: parseQuality(hop.title) || "HD",
      size: measured ? measured[1] + "MB" : parseSize(hop.title),
      singleUse: true,
      headers: reqHeaders(hop.dlPage, hop.host),
    },
  ];
}
