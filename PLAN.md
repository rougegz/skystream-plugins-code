# Plan: Dailymotion plugin v2 — all qualities, subs, precise search, rich home

Repo: /root/skystream-plugins-code (branch main). Plugin:
`dailymotion/plugin.js` + `plugin.json`. Test harness: `skystream-cli`
(`npm i -g skystream-cli`), run from repo root with `-p dailymotion`.

## Verified facts (live API probes, 2026-08-26)

- Player metadata:
  `https://www.dailymotion.com/player/metadata/video/<id>?embedder=https://www.dailymotion.com/us`
  - `qualities` = map; usually only
    `auto: [{type: application/x-mpegURL, url: master.m3u8}]`
  - Master M3U8 contains `#EXT-X-STREAM-INF` variants with
    `NAME="1080"/"720"/"480"/"380"...` → per-quality streams
  - `subtitles.data` is an OBJECT MAP
    `{ "en-auto": {label, urls:["....srt"]}, ... }` (old code assumed array →
    subs never showed)
- API `api.dailymotion.com`: videos search/list OK; `/user/<id>/videos` MUST use
  `sort=recent` (`trending` returns empty list)
- Channels taxonomy: shortfilms=Movies, tv=TV, fun=Comedy, videogames=Gaming,
  music, news, sport, kids...
- Verified curated channels (sort=recent): Rajshri xldsnb, Mundo Drama x1tk6u3,
  Pakistani Drama x2w7377, PJ KDrama x2mvsoe, TUS Series Turcas x2fxr8x
- CLI StreamResult keeps only url/source/headers/subtitles → quality label must
  ride in `source`

## Milestone 1: Core engine rewrite (http layer + helpers)

- [x] `httpGet(url, timeoutMs)` — race-timeout over http_get, JSON guard, status
      check
- [x] `fetchJson(url, timeoutMs, retries)` — exponential backoff 500ms→2s
- [x] `parallelJson(list, deadlineMs)` — ONE native `http_parallel` call for N
      requests, global deadline race, graceful per-item null on failure;
      fallback to Promise.all(httpGet) when bridge missing
- [x] guarded() wrappers with per-function budgets (keep existing pattern)
- Verify: `node --check dailymotion/plugin.js` parses

## Milestone 2: loadStreams — ALL qualities + subs

- [x] Fetch metadata → auto/master URL + subtitles map
- [x] Parse master M3U8: extract every `#EXT-X-STREAM-INF` variant (NAME attr or
      RESOLUTION height fallback) → one StreamResult per quality, sorted desc
      (1080p→144p)
- [x] Merge explicit `meta.qualities` entries if present (mp4 preferred per
      quality)
- [x] Always include Auto (master HLS)
- [x] Subtitles: iterate subtitles.data MAP → {url: urls[0], label, lang from
      key}; attach to every stream
- [x] Clean headers: UA + Referer only (drop junk headers)
- Verify: `skystream test -p dailymotion -f loadStreams -q dm|xaz901m` → ≥3
  quality streams + ≥1 sub

## Milestone 3: search — no dedupe, multi-page, URL-precise

- [x] Detect Dailymotion URLs/IDs in query (dailymotion.com/video/<id>,
      dai.ly/<id>, /video/<id>-title-slug, bare x-id, dm|ref) → resolve EXACT
      video via API as top result (+ same-channel extras), skip web search
- [x] Normal query: pages 1–3 fetched in PARALLEL via parallelJson, concatenated
      WITHOUT dedupe, cap 90
- Verify: `skystream test -f search -q "k drama"` → ~90 items incl. same-title
  uploads; `-q https://www.dailymotion.com/video/xaz901m` → exactly that video
  first

## Milestone 4: getHome — richer categories + best channels

- [x] Rows via ONE http_parallel batch (~14 requests): Trending(hero), New
      Releases, Movies(shortfilms ch), Full Hollywood Movies(search), Bollywood
      Movies(search), TV Series(tv ch), K-Drama(PJ KDrama ch), Drama
      Series(Mundo Drama ch), Pakistani Dramas(channel), Turkish Series(TUS ch),
      ShortDrama(search), Anime(search), Music(ch), Trailers(search)
- [x] Channel rows use sort=recent; category rows sort=trending; page param
      support
- Verify: `skystream test -f getHome` → ≥10 populated rows, fast (<15s)

## Milestone 5: load() polish + manifest bump

- [x] Parallel related+owner fetch, keep up-next dedupe there (it's a playlist,
      not search)
- [x] duration(minutes)/year fields, description, bannerUrl
- [x] plugin.json version 2, updated description
- Verify: `skystream test -f load -q dm|xaz901m` → details + episodes

## Milestone 6: Full CLI verification + commit

- [x] All four functions green via skystream CLI
- [x] Edge cases: bad id, dai.ly link, video without subs, single-quality video
- [x] git commit (local); push only if user confirms (token provided in chat —
      must be rotated!)

## Rules honored

- No comments in code. No dedupe in search. Quality labels in source strings.
