(function () {
	"use strict";

	// ═══════════════════════════════════════════════════
	//  CONFIGURABLE VALUES — source-annotation comments
	//  show where to find/replace each value
	// ═══════════════════════════════════════════════════

	var API_PATH = "/wefeed-h5api-bff";
	// └─ BFF prefix — captured from moviebox.ph Network tab
	//    Source (walterwhite-69/Moviebox-API):
	//      github.com/walterwhite-69/Moviebox-API/blob/main/api.py#L26
	//    Source (Simatwa/moviebox-api v2):
	//      github.com/Simatwa/moviebox-api/blob/main/src/moviebox_api/v2/core.py#L27

	var DEFAULT_HOST = "moviebox.ph";
	// └─ Frontend site param — tells BFF which site to serve
	//    Source (walterwhite-69):
	//      github.com/walterwhite-69/Moviebox-API/blob/main/api.py#L25
	//    Environment variable (Simatwa):
	//      github.com/Simatwa/moviebox-api/blob/main/src/moviebox_api/v2/constants.py#L14

	var BASE_HEADERS = {
		"User-Agent":
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		Accept: "application/json, text/plain, */*",
		"Accept-Language": "en-US,en;q=0.9",
		"X-Request-Lang": "en",
		Referer: "https://moviebox.ph/",
		Origin: "https://moviebox.ph",
		"sec-ch-ua":
			'"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
		"sec-ch-ua-mobile": "?0",
		"sec-ch-ua-platform": '"Windows"',
		"sec-fetch-dest": "empty",
		"sec-fetch-mode": "cors",
		"sec-fetch-site": "cross-site",
	};
	// └─ Browser headers — refresh from DevTools > Network on h5-api.aoneroom.com
	//    Source (walterwhite-69):
	//      github.com/walterwhite-69/Moviebox-API/blob/main/api.py#L28-L41
	//    Source (Simatwa v2):
	//      github.com/Simatwa/moviebox-api/blob/main/src/moviebox_api/v2/constants.py#L25-L34

	var INIT_DOMAIN_FALLBACK = "https://netfilm.world";
	// └─ Streaming domain — used when /media-player/get-domain returns empty
	//    Source: found in MovieBox web app's player frame network tab
	//    Source (walterwhite-69):
	//      github.com/walterwhite-69/Moviebox-API/blob/main/api.py#L169
	//    If streams stop, check the web app's Domain tab for current hostname

	// ═══════════════════════════════════════════════════
	//  HELPERS
	// ═══════════════════════════════════════════════════

	function parseJsonSafe(text, fallback) {
		try {
			return JSON.parse(text);
		} catch (_) {
			return fallback;
		}
	}

	function isSeriesType(subjectType) {
		var t = Number(subjectType);
		// └─ SubjectType enum (Simatwa):
		//    github.com/Simatwa/moviebox-api/blob/main/src/moviebox_api/v1/constants.py#L84-L113
		return t === 2 || t === 3 || t >= 7;
	}

	function cleanTitle(title) {
		return String(title || "")
			.split("[")[0]
			.trim();
	}

	function langFlag(code) {
		var map = {
			en: "🇬🇧",
			hi: "🇮🇳",
			ta: "🇮🇳",
			te: "🇮🇳",
			ml: "🇮🇳",
			kn: "🇮🇳",
			bn: "🇧🇩",
			mr: "🇮🇳",
			pa: "🇮🇳",
			gu: "🇮🇳",
			ja: "🇯🇵",
			ko: "🇰🇷",
			zh: "🇨🇳",
			th: "🇹🇭",
			ar: "🇸🇦",
			tr: "🇹🇷",
			ru: "🇷🇺",
			fr: "🇫🇷",
			de: "🇩🇪",
			es: "🇪🇸",
			pt: "🇵🇹",
			id: "🇮🇩",
			tl: "🇵🇭",
			fil: "🇵🇭",
			ptbr: "🇧🇷",
			vi: "🇻🇳",
			it: "🇮🇹",
			nl: "🇳🇱",
			pl: "🇵🇱",
			sv: "🇸🇪",
			da: "🇩🇰",
			no: "🇳🇴",
			fi: "🇫🇮",
			el: "🇬🇷",
			he: "🇮🇱",
			ms: "🇲🇾",
			ur: "🇵🇰",
		};
		return map[code] || "";
	}

	function qualityLabelSingle(res) {
		var r = String(res || "").trim();
		if (r.indexOf("2160") >= 0) return "2160p";
		if (r.indexOf("1440") >= 0) return "1440p";
		if (r.indexOf("1080") >= 0) return "1080p";
		if (r.indexOf("720") >= 0) return "720p";
		if (r.indexOf("480") >= 0) return "480p";
		if (r.indexOf("360") >= 0) return "360p";
		return r ? r + "p" : "Auto";
	}

	function qualityLabel(resolutionText) {
		var t = String(resolutionText || "");
		if (t.indexOf(",") >= 0) {
			var parts = t
				.split(",")
				.map(function (s) {
					return s.trim();
				})
				.filter(Boolean);
			// Show range: "1080p-480p" when multiple resolutions
			var labels = parts.map(qualityLabelSingle);
			if (labels.length > 1) {
				return labels[0] + "-" + labels[labels.length - 1];
			}
			return labels[0] || "Auto";
		}
		return qualityLabelSingle(t);
	}

	function formatSize(sizeBytes) {
		if (!sizeBytes) return "";
		var mb = Math.floor(Number(sizeBytes) / 1024 / 1024);
		if (mb > 1024) return (mb / 1024).toFixed(1) + "GB";
		return mb + "MB";
	}

	function getResolutions(stream) {
		return stream.resolutions || stream.resolution || "";
	}

	// ═══════════════════════════════════════════════════
	//  TOKEN — from x-user response header
	//  Token source (walterwhite-69):
	//    github.com/walterwhite-69/Moviebox-API/blob/main/api.py#L52-L67
	//  Token source (Simatwa v1):
	//    github.com/Simatwa/moviebox-api/blob/main/src/moviebox_api/v1/requests.py#L130-L152
	//  Token source (Simatwa v2):
	//    github.com/Simatwa/moviebox-api/blob/main/src/moviebox_api/v2/core.py#L27
	// ═══════════════════════════════════════════════════

	var bearerToken = null;

	function getAuthHeaders() {
		if (bearerToken) {
			return { Authorization: "Bearer " + bearerToken };
		}
		return {};
	}

	function extractToken(res) {
		var headers = res.headers || {};
		// x-user header returns JSON: { "token": "...", "uid": "..." }
		// Source: response header observed on any BFF request
		var xUser = headers["x-user"] || headers["X-User"];
		if (xUser) {
			var parsed = parseJsonSafe(xUser, null);
			if (parsed && parsed.token) {
				bearerToken = parsed.token;
				return;
			}
		}
		// Fallback: set-cookie header also contains token
		var setCookie = headers["set-cookie"] || "";
		if (!bearerToken && setCookie) {
			var match = setCookie.match(/token=([^;]+)/);
			if (match) bearerToken = match[1];
		}
	}

	async function ensureToken() {
		if (bearerToken) return;
		try {
			var res = await http_get(
				manifest.baseUrl + API_PATH + "/home?host=" + DEFAULT_HOST,
				buildHeaders(),
			);
			extractToken(res);
		} catch (_) {}
	}

	// ═══════════════════════════════════════════════════
	//  HTTP
	// ═══════════════════════════════════════════════════

	function buildHeaders(extra) {
		var h = {};
		Object.keys(BASE_HEADERS).forEach(function (k) {
			h[k] = BASE_HEADERS[k];
		});
		var auth = getAuthHeaders();
		Object.keys(auth).forEach(function (k) {
			h[k] = auth[k];
		});
		if (extra) {
			Object.keys(extra).forEach(function (k) {
				h[k] = extra[k];
			});
		}
		return h;
	}

	async function apiGet(endpoint) {
		await ensureToken();
		return await http_get(
			manifest.baseUrl + API_PATH + endpoint,
			buildHeaders(),
		);
	}

	async function apiPost(endpoint, payload) {
		await ensureToken();
		return await http_post(
			manifest.baseUrl + API_PATH + endpoint,
			buildHeaders({ "Content-Type": "application/json" }),
			JSON.stringify(payload),
		);
	}

	// ═══════════════════════════════════════════════════
	//  GET HOME
	//  Calls TWO endpoints in parallel:
	//    GET /home?host=moviebox.ph         — general sections (series, anime)
	//    GET /tab-operating?tabId=ONEROOM_MOVIE  — movie genre sections
	//  Source (walterwhite-69):
	//    github.com/walterwhite-69/Moviebox-API/blob/main/api.py#L101-L139
	//  Source (Simatwa v2):
	//    github.com/Simatwa/moviebox-api/blob/main/src/moviebox_api/v2/core.py#L26-L29
	//  (NivinCNC):
	//    github.com/NivinCNC/MovieBox-Plugin-Jarvis/blob/main/moviebox-plugin/plugin.js#L305-L369
	// ═══════════════════════════════════════════════════

	async function getHome(cb) {
		try {
			// Try both endpoints; if one fails, still use the other.
			var safeGet = async function (ep) {
				try {
					return await apiGet(ep);
				} catch (_) {
					return null;
				}
			};

			var results = await Promise.all([
				safeGet("/home?host=" + DEFAULT_HOST),
				safeGet("/tab-operating?tabId=ONEROOM_MOVIE&host=h5.aoneroom.com"),
			]);

			var homeRoot = parseJsonSafe(results[0] && results[0].body, {});
			var tabRoot = parseJsonSafe(results[1] && results[1].body, {});

			var operatingList = (homeRoot.data && homeRoot.data.operatingList) || [];
			var tabList = (tabRoot.data && tabRoot.data.operatingList) || [];

			if (!operatingList.length && !tabList.length)
				return cb({
					success: false,
					errorCode: "NO_CONTENT",
					message: "Empty home page",
				});

			// Merge tab sections first, then home sections.
			// Deduplicate by exact section title.
			var seen = {};
			var merged = [];

			var dedupAppend = function (list) {
				list.forEach(function (op) {
					// Skip FILTER / CUSTOM / SPORT_LIVE with no items
					if (
						(op.type === "FILTER" ||
							op.type === "CUSTOM" ||
							op.type === "SPORT_LIVE" ||
							op.type === "APPOINTMENT_LIST") &&
						(!op.subjects || !op.subjects.length)
					)
						return;
					var title = op.title || "Featured";
					if (seen[title]) return;
					seen[title] = true;
					merged.push(op);
				});
			};

			dedupAppend(tabList);
			dedupAppend(operatingList);

			var sections = {};
			merged.forEach(function (op) {
				var items = [];
				if (op.type === "BANNER" && op.banner && op.banner.items) {
					op.banner.items.forEach(function (item) {
						if (!item || !item.subject) return;
						items.push(item.subject);
					});
				} else if (op.subjects) {
					items = op.subjects;
				}
				if (items.length === 0) return;
				var secName = op.title || "Featured";
				if (secName.toLowerCase().indexOf("trend") >= 0) secName = "Trending";
				if (!sections[secName]) sections[secName] = [];
				items.forEach(function (s) {
					if (!s || !s.subjectId) return;
					sections[secName].push(
						new MultimediaItem({
							title: cleanTitle(s.title || ""),
							url: s.detailPath || String(s.subjectId),
							posterUrl: s.cover && s.cover.url ? s.cover.url : "",
							type: isSeriesType(s.subjectType) ? "series" : "movie",
							score: s.imdbRatingValue ? Number(s.imdbRatingValue) : undefined,
							year: s.releaseDate
								? Number(String(s.releaseDate).slice(0, 4)) || undefined
								: undefined,
						}),
					);
				});
			});

			if (!Object.keys(sections).length)
				return cb({
					success: false,
					errorCode: "NO_CONTENT",
					message: "No items",
				});
			cb({ success: true, data: sections });
		} catch (e) {
			cb({
				success: false,
				errorCode: "HOME_ERROR",
				message: String(e && e.message ? e.message : e),
			});
		}
	}

	// ═══════════════════════════════════════════════════
	//  SEARCH
	//  Endpoint: POST /subject/search { keyword, page, perPage }
	//  Source (walterwhite-69):
	//    github.com/walterwhite-69/Moviebox-API/blob/main/api.py#L147-L165
	//  Source (Simatwa v2):
	//    github.com/Simatwa/moviebox-api/blob/main/src/moviebox_api/v2/core.py#L155-L161
	// ═══════════════════════════════════════════════════

	async function search(query, cb) {
		try {
			var res = await apiPost("/subject/search", {
				keyword: String(query || ""),
				page: 1,
				perPage: 20,
			});
			var root = parseJsonSafe(res.body, {});
			var items = (root.data && (root.data.items || root.data.list)) || [];
			var results = items
				.map(function (item) {
					var s = item.subject || item;
					if (!s || !s.subjectId) return null;
					return new MultimediaItem({
						title: cleanTitle(s.title || ""),
						url: s.detailPath || String(s.subjectId),
						posterUrl: s.cover && s.cover.url ? s.cover.url : "",
						type: isSeriesType(s.subjectType) ? "series" : "movie",
						score: s.imdbRatingValue ? Number(s.imdbRatingValue) : undefined,
						year: s.releaseDate
							? Number(String(s.releaseDate).slice(0, 4)) || undefined
							: undefined,
					});
				})
				.filter(Boolean);
			cb({ success: true, data: results });
		} catch (e) {
			cb({
				success: false,
				errorCode: "SEARCH_ERROR",
				message: String(e && e.message ? e.message : e),
			});
		}
	}

	// ═══════════════════════════════════════════════════
	//  LOAD — single episode per (season, episode)
	//
	//  Audio tracks (dubs) are NOT separate episodes;
	//  they are returned as separate stream sources in
	//  loadStreams. Each dub has its own subjectId AND
	//  detailPath — both are needed in loadStreams to
	//  fetch the correct language-specific stream.
	//
	//  Dubs array lives at data.subject.dubs or data.dubs:
	//    each dub has { subjectId, detailPath, lanName, lanCode }
	//
	//  Detail endpoint:
	//    GET /detail?detailPath=<slug>
	//  Source (walterwhite-69):
	//    github.com/walterwhite-69/Moviebox-API/blob/main/api.py#L167-L170
	//  Source (Simatwa v2):
	//    github.com/Simatwa/moviebox-api/blob/main/src/moviebox_api/v2/core.py#L206-L211
	// ═══════════════════════════════════════════════════

	async function load(url, cb) {
		try {
			var slug = String(url || "");
			if (!slug) return cb({ success: false, errorCode: "INVALID_ID" });

			var res = await apiGet("/detail?detailPath=" + encodeURIComponent(slug));
			var root = parseJsonSafe(res.body, {});
			var data = root.data || {};
			var subj = data.subject || {};

			if (!subj.subjectId)
				return cb({ success: false, errorCode: "NOT_FOUND" });

			var title = cleanTitle(subj.title || "");
			var poster = subj.cover && subj.cover.url ? subj.cover.url : "";
			var description = subj.description || "";
			var year = subj.releaseDate
				? Number(String(subj.releaseDate).slice(0, 4)) || undefined
				: undefined;
			var subjectId = String(subj.subjectId);
			var genre = subj.genre || "";
			var score = subj.imdbRatingValue
				? Number(subj.imdbRatingValue)
				: undefined;
			var isSeries = isSeriesType(subj.subjectType);
			var seasons = (data.resource && data.resource.seasons) || [];

			// Cast from data.stars array
			var cast = [];
			if (Array.isArray(data.stars)) {
				cast = data.stars
					.map(function (s) {
						if (!s || !s.name) return null;
						return new Actor({
							name: String(s.name),
							image: s.image || undefined,
							role: s.character || undefined,
						});
					})
					.filter(Boolean);
			}

			// Recommendations from data.recommendList
			var recommendations = [];
			if (Array.isArray(data.recommendList)) {
				recommendations = data.recommendList
					.map(function (r) {
						if (!r || !r.subjectId) return null;
						return new MultimediaItem({
							title: cleanTitle(r.title || ""),
							url: r.detailPath || String(r.subjectId),
							posterUrl: r.cover && r.cover.url ? r.cover.url : "",
							type: isSeriesType(r.subjectType) ? "series" : "movie",
							score: r.imdbRatingValue ? Number(r.imdbRatingValue) : undefined,
						});
					})
					.filter(Boolean);
			}

			function makeEpUrl(sid, s, e) {
				return JSON.stringify({
					subjectId: String(sid),
					detailPath: slug,
					se: s,
					ep: e,
				});
			}

			if (!isSeries) {
				// Movie — single episode
				return cb({
					success: true,
					data: new MultimediaItem({
						title: title,
						url: makeEpUrl(subjectId, 0, 0),
						posterUrl: poster,
						description: description,
						type: "movie",
						year: year,
						score: score,
						genres: genre
							? genre
									.split(",")
									.map(function (g) {
										return g.trim();
									})
									.filter(Boolean)
							: undefined,
						cast: cast,
						recommendations: recommendations,
						episodes: [
							new Episode({
								name: "Full Movie",
								season: 1,
								episode: 1,
								url: makeEpUrl(subjectId, 0, 0),
								posterUrl: poster,
							}),
						],
					}),
				});
			}

			// Series — one episode per (season, episode), no audio duplication
			// Audio tracks are served as separate stream sources in loadStreams
			var episodes = [];
			if (Array.isArray(seasons) && seasons.length > 0) {
				seasons.forEach(function (season) {
					var sn = Number(season.se || 1) || 1;
					var maxEp = Number(season.maxEp || 1) || 1;
					for (var e = 1; e <= maxEp; e++) {
						episodes.push(
							new Episode({
								name:
									"S" +
									String(sn).padStart(2, "0") +
									"E" +
									String(e).padStart(2, "0"),
								season: sn,
								episode: e,
								url: makeEpUrl(subjectId, sn, e),
								posterUrl: poster,
							}),
						);
					}
				});
			}
			if (!episodes.length) {
				episodes.push(
					new Episode({
						name: "Episode 1",
						season: 1,
						episode: 1,
						url: makeEpUrl(subjectId, 1, 1),
						posterUrl: poster,
					}),
				);
			}

			cb({
				success: true,
				data: new MultimediaItem({
					title: title,
					url: slug,
					posterUrl: poster,
					description: description,
					type: "series",
					year: year,
					score: score,
					genres: genre
						? genre
								.split(",")
								.map(function (g) {
									return g.trim();
								})
								.filter(Boolean)
						: undefined,
					cast: cast,
					recommendations: recommendations,
					episodes: episodes,
				}),
			});
		} catch (e) {
			cb({
				success: false,
				errorCode: "LOAD_ERROR",
				message: String(e && e.message ? e.message : e),
			});
		}
	}

	// ═══════════════════════════════════════════════════
	//  LOAD STREAMS — one stream source per audio track
	//
	//  For each language track (dub) we fetch play-info
	//  using the DUB'S OWN subjectId AND detailPath.
	//  The key insight: each dub has a unique detailPath
	//  that returns language-specific stream URLs.
	//
	//  Play URL (on streaming domain):
	//    {domain}/wefeed-h5api-bff/subject/play
	//      ?subjectId={dub.subjectId}
	//      &se=&ep=
	//      &detailPath={dub.detailPath}   ← CRITICAL: dub's own detailPath
	//
	//  Source (walterwhite-69):
	//    github.com/walterwhite-69/Moviebox-API/blob/main/api.py#L173-L188
	//  Source (NivinCNC):
	//    github.com/NivinCNC/CNCVerse-Cloud-Stream-Extension/blob/main/
	//      MovieBoxProvider/src/main/kotlin/com/cncverse/MovieBoxProvider.kt#L605-L741
	// ═══════════════════════════════════════════════════

	async function loadStreams(url, cb) {
		try {
			var p = parseJsonSafe(url, {});
			var subjectId = p.subjectId ? String(p.subjectId) : "";
			var detailPath = p.detailPath ? String(p.detailPath) : "";
			var se = Number(p.se || 0) || 0;
			var ep = Number(p.ep || 0) || 0;

			if (!subjectId) return cb({ success: false, errorCode: "INVALID_ID" });

			// 1. Get streaming domain
			var domainRes = await apiGet("/media-player/get-domain");
			var domainRoot = parseJsonSafe(domainRes.body, {});
			var domain = (domainRoot && domainRoot.data) || INIT_DOMAIN_FALLBACK;
			domain = String(domain).replace(/\/$/, "");

			// 2. Re-fetch subject detail to get dubs array
			//    Each dub has its own subjectId AND detailPath.
			var detailRes = await apiGet(
				"/detail?detailPath=" + encodeURIComponent(detailPath || ""),
			);
			var detailRoot = parseJsonSafe(detailRes.body, {});
			var detailData = detailRoot.data || {};
			var subj = detailData.subject || {};
			var dubs = subj.dubs || detailData.dubs || [];

			// 3. Build source list: each audio track (skip subtitle-only)
			var sources = [];
			if (Array.isArray(dubs) && dubs.length > 0) {
				dubs.forEach(function (d) {
					if (!d || !d.subjectId) return;
					var name = (d.lanName || "").toLowerCase();
					// "sub" entries are subtitle tracks — skip them
					if (name.indexOf("sub") >= 0 && name.indexOf("dub") < 0) return;
					var sid = String(d.subjectId);
					// ★ KEY FIX: use dub's own detailPath, not the main one
					var dp = d.detailPath || detailPath;
					var flag = langFlag(d.lanCode);
					var label = (flag ? flag + " " : "") + (d.lanName || "Audio");
					sources.push([sid, dp, label]);
				});
			}
			if (!sources.length) {
				sources.push([subjectId, detailPath, "Original"]);
			}

			var results = [];

			// 4. Fetch play-info for each source IN PARALLEL
			//    Each uses its own subjectId + detailPath
			var playPromises = sources.map(function (src) {
				var sid = src[0];
				var dp = src[1];
				var langLabel = src[2];

				var playerReferer =
					domain +
					"/spa/videoPlayPage/movies/" +
					encodeURIComponent(dp) +
					"?id=" +
					encodeURIComponent(sid) +
					"&type=/movie/detail&detailSe=" +
					se +
					"&detailEp=" +
					ep +
					"&lang=en";

				var playUrl =
					domain +
					API_PATH +
					"/subject/play" +
					"?subjectId=" +
					encodeURIComponent(sid) +
					"&se=" +
					se +
					"&ep=" +
					ep +
					"&detailPath=" +
					encodeURIComponent(dp);

				return http_get(playUrl, buildHeaders({ Referer: playerReferer }))
					.then(function (playRes) {
						var playRoot = parseJsonSafe(playRes.body, {});
						var streamData = playRoot.data || playRoot;
						var langResults = [];

						// MP4 streams
						var streams = streamData.streams || [];
						if (Array.isArray(streams)) {
							streams.forEach(function (stream) {
								if (!stream || !stream.url) return;
								var q = qualityLabel(getResolutions(stream));
								var sz = formatSize(stream.size);
								langResults.push(
									new StreamResult({
										url: String(stream.url),
										source:
											langLabel + " \u2022 " + q + (sz ? " \u2022 " + sz : ""),
										quality: q,
										headers: { Referer: domain },
									}),
								);
							});
						}

						// HLS
						var hlsList = streamData.hls || [];
						if (Array.isArray(hlsList)) {
							hlsList.forEach(function (s) {
								if (!s || !s.url) return;
								var q = qualityLabel(getResolutions(s));
								langResults.push(
									new StreamResult({
										url: String(s.url),
										source: langLabel + " \u2022 " + q + " \u2022 HLS",
										quality: q,
										headers: { Referer: domain },
									}),
								);
							});
						}

						// DASH
						var dashList = streamData.dash || [];
						if (Array.isArray(dashList)) {
							dashList.forEach(function (s) {
								if (!s || !s.url) return;
								var q = qualityLabel(getResolutions(s));
								langResults.push(
									new StreamResult({
										url: String(s.url),
										source: langLabel + " \u2022 " + q + " \u2022 DASH",
										quality: q,
										headers: { Referer: domain },
									}),
								);
							});
						}

						return langResults;
					})
					.catch(function () {
						return [];
					});
			});

			var allResults = await Promise.all(playPromises);
			allResults.forEach(function (r) {
				results = results.concat(r);
			});

			if (!results.length)
				return cb({ success: false, errorCode: "NO_STREAMS" });
			cb({ success: true, data: results });
		} catch (e) {
			cb({
				success: false,
				errorCode: "STREAM_ERROR",
				message: String(e && e.message ? e.message : e),
			});
		}
	}

	// ═══════════════════════════════════════════════════
	//  EXPORT
	// ═══════════════════════════════════════════════════

	globalThis.getHome = getHome;
	globalThis.search = search;
	globalThis.load = load;
	globalThis.loadStreams = loadStreams;
})();
