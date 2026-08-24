#!/usr/bin/env node
/*
 * Stremio Addon Sandbox Validator
 * Usage: node tools/validate.js <manifest-url> [search-query]
 *
 * Pre-flight checks any Stremio addon BEFORE adding it to a plugin.json:
 *   manifest → catalogs → feed → search → meta → stream
 * Reports latency, HTTP status, spec compliance and a verdict.
 * Exit 0 = safe to ship, 1 = problems found.
 */
"use strict";

const https = require("https");
const http = require("http");
const zlib = require("zlib");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = parseInt(process.env.TIMEOUT_MS || "15000", 10);

function get(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.request(
      url,
      {
        method: "GET",
        headers: { "User-Agent": UA, Accept: "application/json" },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          let buf = Buffer.concat(chunks);
          try {
            const enc = (res.headers["content-encoding"] || "").toLowerCase();
            if (enc.includes("gzip")) buf = zlib.gunzipSync(buf);
            else if (enc.includes("br")) buf = zlib.brotliDecompressSync(buf);
            else if (enc.includes("deflate")) buf = zlib.inflateSync(buf);
          } catch (e) {}
          resolve({ status: res.statusCode, body: buf.toString("utf8") });
        });
      },
    );
    req.on("error", (e) => resolve({ status: 0, body: String(e.message) }));
    req.setTimeout(TIMEOUT, () => {
      req.destroy();
      resolve({ status: 0, body: "timeout" });
    });
    req.end();
  });
}

async function timedGet(url) {
  const t0 = Date.now();
  const r = await get(url);
  return { ...r, ms: Date.now() - t0 };
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch (e) {
    return null;
  }
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(
    (ok ? "  ✓ " : ok === null ? "  ⚠ " : "  ✗ ") + name.padEnd(34) + detail,
  );
}

async function main() {
  const manifestUrl = process.argv[2];
  const query = process.argv[3] || "test";
  if (!manifestUrl) {
    console.log("Usage: node tools/validate.js <manifest-url> [search-query]");
    process.exit(1);
  }

  console.log("\n═══ Stremio Addon Sandbox ═══");
  console.log("manifest:", manifestUrl, "\n");

  // 1. Manifest
  const m = await timedGet(manifestUrl);
  const mf = m.status === 200 ? parseJson(m.body) : null;
  record(
    "manifest",
    m.status === 200 && mf && mf.id ? true : false,
    `${m.status} ${m.ms}ms ${mf ? `id=${mf.id} v${mf.version}` : m.body.slice(0, 60)}`,
  );
  if (!mf || !mf.id) {
    record("verdict", false, "UNREACHABLE — do not ship");
    process.exit(1);
  }

  const qIdx = manifestUrl.indexOf("?");
  const base = manifestUrl
    .replace(/\?.*$/, "")
    .replace(/\/manifest\.json.*$/, "")
    .replace(/\/$/, "");
  const queryStr = qIdx !== -1 ? manifestUrl.substring(qIdx) : "";
  const withQuery = (u) =>
    queryStr
      ? u + (u.includes("?") ? "&" : "?") + queryStr.replace(/^\?/, "")
      : u;
  const latencyNote =
    m.ms > 5000 ? " (SLOW addon — needs raised timeouts)" : "";

  // 2. Resources & catalogs
  const resList = Array.isArray(mf.resources)
    ? mf.resources.map((r) => (typeof r === "string" ? r : r.name))
    : [];
  const has = (n) => resList.includes(n);
  const catalogs = (Array.isArray(mf.catalogs) ? mf.catalogs : []).filter(
    (c) => c && c.id && c.type,
  );
  record(
    "resources",
    true,
    resList.join(",") +
      ` | types=${(mf.types || []).join(",")} | prefixes=${JSON.stringify(mf.idPrefixes || [])}`,
  );
  record("catalogs", catalogs.length > 0, `${catalogs.length} declared`);
  if (latencyNote) record("latency", null, latencyNote.trim());

  // 3. Feed per catalog (max 4 sampled)
  let feedOk = 0,
    feedEmpty = 0,
    feedFail = 0;
  for (const c of catalogs.slice(0, 4)) {
    const r = await timedGet(
      withQuery(`${base}/catalog/${c.type}/${c.id}.json`),
    );
    const j = r.status === 200 ? parseJson(r.body) : null;
    const n = j && Array.isArray(j.metas) ? j.metas.length : -1;
    if (n > 0) feedOk++;
    else if (n === 0) feedEmpty++;
    else feedFail++;
    record(
      `feed ${c.type}/${c.id}`.substring(0, 34),
      n > 0 ? true : n === 0 ? null : false,
      `${r.status} ${r.ms}ms metas=${n}`,
    );
  }

  // 4. Search per searchable catalog (max 3 sampled)
  const searchable = catalogs.filter((c) =>
    (Array.isArray(c.extra) ? c.extra : []).some(
      (x) => x && x.name.toLowerCase() === "search",
    ),
  );
  if (searchable.length) {
    for (const c of searchable.slice(0, 3)) {
      const r = await timedGet(
        withQuery(
          `${base}/catalog/${c.type}/${c.id}/search=${encodeURIComponent(query)}.json`,
        ),
      );
      const j = r.status === 200 ? parseJson(r.body) : null;
      const n = j && Array.isArray(j.metas) ? j.metas.length : -1;
      record(
        `search ${c.type}/${c.id}`.substring(0, 34),
        n > 0 ? true : n === 0 ? null : false,
        `${r.status} ${r.ms}ms metas=${n} q="${query}"`,
      );
    }
  } else {
    record(
      "search",
      null,
      "no catalog declares search extra — client-filter only",
    );
  }

  // 5. Meta on first feed item
  let metaItem = null;
  for (const c of catalogs.slice(0, 4)) {
    const r = await timedGet(
      withQuery(`${base}/catalog/${c.type}/${c.id}.json`),
    );
    const j = r.status === 200 ? parseJson(r.body) : null;
    if (j && Array.isArray(j.metas) && j.metas.length) {
      metaItem = { cat: c, meta: j.metas[0] };
      break;
    }
  }
  if (metaItem && has("meta")) {
    const id = encodeURIComponent(metaItem.meta.id);
    const r = await timedGet(
      withQuery(`${base}/meta/${metaItem.cat.type}/${id}.json`),
    );
    const j = r.status === 200 ? parseJson(r.body) : null;
    const meta = j && j.meta;
    const good = meta && meta.name;
    const episodes =
      good && Array.isArray(meta.videos) ? meta.videos.length : 0;
    record(
      "meta",
      good ? true : false,
      `${r.status} ${r.ms}ms ${good ? `"${meta.name}" videos=${episodes} poster=${meta.poster ? "yes" : "NO"}` : "empty/hang"}`,
    );

    // 6. Stream on episode (series) or movie id
    if (has("stream")) {
      const vid =
        good && episodes > 0 && meta.videos[0].id
          ? meta.videos[0].id
          : metaItem.meta.id;
      const type = episodes > 0 ? "series" : metaItem.cat.type;
      const sr = await timedGet(
        withQuery(`${base}/stream/${type}/${encodeURIComponent(vid)}.json`),
      );
      const sj = sr.status === 200 ? parseJson(sr.body) : null;
      const streams = sj && Array.isArray(sj.streams) ? sj.streams : [];
      const playable = streams.filter(
        (s) =>
          /^https?:/.test(s.url || "") ||
          s.infoHash ||
          /^magnet:/.test(s.url || ""),
      ).length;
      record(
        "stream",
        playable > 0 ? true : streams.length ? null : false,
        `${sr.status} ${sr.ms}ms total=${streams.length} playable=${playable}`,
      );
    }
  } else if (!has("meta")) {
    record("meta", null, "addon does not declare meta resource");
  } else {
    record("meta", false, "no feed item available to test against");
  }

  // Verdict
  const failed = results.filter((r) => r.ok === false).length;
  const warns = results.filter((r) => r.ok === null).length;
  console.log("\n═══ VERDICT ═══");
  if (failed === 0) {
    console.log(
      `SHIP IT ✓ (${warns} warning(s)) — add to plugin.json addons[]`,
    );
    process.exit(0);
  } else {
    console.log(`DO NOT SHIP ✗ — ${failed} failure(s), ${warns} warning(s)`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("validator error:", e.message);
  process.exit(1);
});
