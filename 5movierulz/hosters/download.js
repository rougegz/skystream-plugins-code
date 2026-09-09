import {
  clean,
  abs,
  isPublicHttp,
  reqHeaders,
  fetchHtml,
  followTokenChain,
  parseQuality,
  parseSize,
  pageTitle,
} from "./_common.js";

const DIRECT_FILE = /\.(mp4|mkv|avi|mov|m3u8)(\?|#|$)/i;
const FILE_LINK = /href=["']([^"']+\.(mp4|mkv|avi|mov|m3u8)[^"']*)["']/i;

export async function resolveDownload(embedUrl, referer) {
  const pageUrl = clean(embedUrl);
  if (!isPublicHttp(pageUrl)) return [];
  let host = "";
  try {
    host = new URL(pageUrl).origin;
  } catch (e) {
    return [];
  }
  const pageHeaders = reqHeaders(referer || host + "/", host);
  if (DIRECT_FILE.test(pageUrl)) {
    return [
      {
        url: pageUrl,
        quality: /\.m3u8/i.test(pageUrl)
          ? "Auto"
          : parseQuality(pageUrl) || "HD",
        size: parseSize(pageUrl),
        headers: pageHeaders,
      },
    ];
  }
  const hop = await followTokenChain(pageUrl, referer);
  if (hop && hop.fileUrl) {
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
  const landing =
    (hop && hop.landing) || (await fetchHtml(pageUrl, pageHeaders));
  const m = FILE_LINK.exec(landing);
  const fileUrl = abs(m && m[1], pageUrl);
  if (!isPublicHttp(fileUrl)) return [];
  return [
    {
      url: fileUrl,
      quality: /\.m3u8/i.test(fileUrl) ? "Auto" : parseQuality(fileUrl) || "HD",
      size: parseSize(pageTitle(landing)),
      headers: pageHeaders,
    },
  ];
}
