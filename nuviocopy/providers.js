
var AIO =
  "https://raw.githubusercontent.com/D3adlyRocket/All-in-One-Nuvio/main/providers/";
var RAY =
  "https://raw.githubusercontent.com/hihihihihiiray/plugins/main/providers/";
var ECLIPSIA =
  "https://raw.githubusercontent.com/Eclipsia-Vault/eclipsia-nuvio/main/providers/";
var ASURA =
  "https://raw.githubusercontent.com/PirateZoro9/asura-providers/main/providers/";

var PROVIDERS = [
  { base: AIO + "videasy.js", enabled: false, providerTitle: "[VidEasy][AIO]" },
  {
    base: AIO + "peachify.js",
    enabled: true,
    providerTitle: "[Peachify][AIO]",
  },
  { base: AIO + "castle.js", enabled: false, providerTitle: "[Castle][AIO]" },
  {
    base: AIO + "4khdhubnew.js",
    enabled: true,
    providerTitle: "[4KHDHub-NEW][AIO]",
  },
  { base: AIO + "vidsrc.js", enabled: true, providerTitle: "[VidSrc][AIO]" },
  { base: AIO + "vixsrc.js", enabled: true, providerTitle: "[VixSrc][AIO]" },
  {
    base: AIO + "allanime.js",
    enabled: true,
    providerTitle: "[AllAnime][AIO]",
  },
  {
    base: AIO + "allmovieland.js",
    enabled: true,
    providerTitle: "[AllMovieLand][AIO]",
  },
  { base: AIO + "allwish.js", enabled: true, providerTitle: "[AllWish][AIO]" },
  { base: AIO + "anidb.js", enabled: true, providerTitle: "[AniDB][AIO]" },
  {
    base: AIO + "anikototv.js",
    enabled: true,
    providerTitle: "[AnikotoTV][AIO]",
  },
  {
    base: AIO + "anime-sama.js",
    enabled: true,
    providerTitle: "[AnimeSama][AIO]",
  },
  {
    base: AIO + "animekai.js",
    enabled: true,
    providerTitle: "[AnimeKai][AIO]",
  },
  {
    base: AIO + "animepahe.js",
    enabled: true,
    providerTitle: "[AnimePahe][AIO]",
  },
  {
    base: AIO + "animesalt.js",
    enabled: true,
    providerTitle: "[AnimeSalt][AIO]",
  },
  {
    base: AIO + "animetsu.js",
    enabled: true,
    providerTitle: "[AnimeTsu][AIO]",
  },
  {
    base: AIO + "animeworld.js",
    enabled: true,
    providerTitle: "[AnimeWorld][AIO]",
  },
  { base: AIO + "cineby.js", enabled: true, providerTitle: "[Cineby][AIO]" },
  {
    base: AIO + "cinefreak.js",
    enabled: true,
    providerTitle: "[CineFreak][AIO]",
  },
  {
    base: AIO + "cinemacity.js",
    enabled: true,
    providerTitle: "[CinemaCity][AIO]",
  },
  { base: AIO + "cinemm.js", enabled: true, providerTitle: "[CineMM][AIO]" },
  {
    base: AIO + "ctgmovies.js",
    enabled: true,
    providerTitle: "[CTG Movies][AIO]",
  },
  {
    base: AIO + "dahmermovies.js",
    enabled: true,
    providerTitle: "[DahmerMovies][AIO]",
  },
  {
    base: AIO + "dahmermovies-4k.js",
    enabled: true,
    providerTitle: "[DahmerMovies-4K][AIO]",
  },
  { base: AIO + "dooflix.js", enabled: true, providerTitle: "[DooFlix][AIO]" },
  {
    base: AIO + "einthusan.js",
    enabled: true,
    providerTitle: "[Einthusan][AIO]",
  },
  {
    base: AIO + "fibwatch.js",
    enabled: true,
    providerTitle: "[FibWatch][AIO]",
  },
  { base: AIO + "goatapi.js", enabled: true, providerTitle: "[GoatAPI][AIO]" },
  {
    base: AIO + "gramcinema.js",
    enabled: false,
    providerTitle: "[GramCinema][AIO]",
  },
  { base: AIO + "hdhub4u.js", enabled: false, providerTitle: "[HDHub4U][AIO]" },
  {
    base: AIO + "hdmovie2.js",
    enabled: true,
    providerTitle: "[HDMovie2][AIO]",
  },
  { base: AIO + "hianime.js", enabled: true, providerTitle: "[HiAnime][AIO]" },
  {
    base: AIO + "hindmoviez.js",
    enabled: true,
    providerTitle: "[HindMoviez][AIO]",
  },
  { base: AIO + "kisskh.js", enabled: false, providerTitle: "[KissKH][AIO]" },
  { base: AIO + "kurage.js", enabled: true, providerTitle: "[Kurage][AIO]" },
  {
    base: AIO + "lordflix.js",
    enabled: true,
    providerTitle: "[LordFlix][AIO]",
  },
  {
    base: AIO + "movieblast.js",
    enabled: true,
    providerTitle: "[MovieBlast][AIO]",
  },
  {
    base: AIO + "moviebox.js",
    enabled: true,
    providerTitle: "[MovieBox][AIO]",
  },
  {
    base: AIO + "movies4u.js",
    enabled: true,
    providerTitle: "[Movies4U][AIO]",
  },
  {
    base: AIO + "moviesdrive.js",
    enabled: true,
    providerTitle: "[MoviesDrive][AIO]",
  },
  {
    base: AIO + "moviesmod.js",
    enabled: true,
    providerTitle: "[MoviesMod][AIO]",
  },
  { base: AIO + "movix.js", enabled: true, providerTitle: "[Movix][AIO]" },
  { base: AIO + "nakios.js", enabled: true, providerTitle: "[Nakios][AIO]" },
  {
    base: AIO + "netmirror.js",
    enabled: true,
    providerTitle: "[NetMirror][AIO]",
  },
  {
    base: AIO + "notorrent.js",
    enabled: true,
    providerTitle: "[NoTorrent][AIO]",
  },
  {
    base: AIO + "onetouchtv.js",
    enabled: true,
    providerTitle: "[OneTouchTV][AIO]",
  },
  {
    base: AIO + "onlykdrama.js",
    enabled: true,
    providerTitle: "[OnlyKDrama][AIO]",
  },
  {
    base: AIO + "purstream.js",
    enabled: true,
    providerTitle: "[PurStream][AIO]",
  },
  { base: AIO + "showbox.js", enabled: false, providerTitle: "[ShowBox][AIO]" },
  { base: AIO + "toflix.js", enabled: true, providerTitle: "[ToFlix][AIO]" },
  {
    base: AIO + "topcartoons.js",
    enabled: true,
    providerTitle: "[TopCartoons][AIO]",
  },
  {
    base: AIO + "torrentio.js",
    enabled: true,
    providerTitle: "[Torrentio][AIO]",
  },
  {
    base: AIO + "uhdmovies.js",
    enabled: true,
    providerTitle: "[UHDMovies][AIO]",
  },
  {
    base: AIO + "vegamovies.js",
    enabled: true,
    providerTitle: "[VegaMovies][AIO]",
  },
  { base: AIO + "vidfast.js", enabled: false, providerTitle: "[VidFast][AIO]" },
  { base: AIO + "vidlink.js", enabled: false, providerTitle: "[VidLink][AIO]" },
  { base: AIO + "vidrock.js", enabled: true, providerTitle: "[VidRock][AIO]" },
  { base: AIO + "xpass.js", enabled: true, providerTitle: "[XPass][AIO]" },
  {
    base: AIO + "zinkmovies.js",
    enabled: true,
    providerTitle: "[ZinkMovies][AIO]",
  },

  { base: RAY + "videasy.js", enabled: true, providerTitle: "[VidEasy][Ray]" },
  { base: RAY + "vidfast.js", enabled: true, providerTitle: "[VidFast][Ray]" },
  { base: RAY + "vidlink.js", enabled: true, providerTitle: "[VidLink][Ray]" },
  { base: RAY + "4khdhub.js", enabled: true, providerTitle: "[4KHDHub][Ray]" },
  {
    base: RAY + "animepahe.js",
    enabled: true,
    providerTitle: "[AnimePahe][Ray]",
  },
  { base: RAY + "anineko.js", enabled: true, providerTitle: "[AniNeko][Ray]" },
  {
    base: RAY + "bollyflix.js",
    enabled: true,
    providerTitle: "[BollyFlix][Ray]",
  },
  {
    base: RAY + "dahmermovies.js",
    enabled: true,
    providerTitle: "[DahmerMovies][Ray]",
  },
  { base: RAY + "embed69.js", enabled: true, providerTitle: "[Embed69][Ray]" },
  { base: RAY + "faselhd.js", enabled: true, providerTitle: "[FaselHD][Ray]" },
  {
    base: RAY + "filmmodu.js",
    enabled: true,
    providerTitle: "[FilmModu][Ray]",
  },
  { base: RAY + "hdhub4u.js", enabled: true, providerTitle: "[HDHub4U][Ray]" },
  { base: RAY + "kisskh.js", enabled: false, providerTitle: "[KissKH][Ray]" },
  {
    base: RAY + "movieblast.js",
    enabled: true,
    providerTitle: "[MovieBlast][Ray]",
  },
  { base: RAY + "movix.js", enabled: true, providerTitle: "[Movix][Ray]" },
  { base: RAY + "showbox.js", enabled: false, providerTitle: "[ShowBox][Ray]" },
  {
    base: RAY + "tokyoinsider.js",
    enabled: true,
    providerTitle: "[TokyoInsider][Ray]",
  },
  {
    base: RAY + "uhdmovies.js",
    enabled: true,
    providerTitle: "[UHDMovies][Ray]",
  },

  {
    base: ECLIPSIA + "soryn.js",
    enabled: true,
    providerTitle: "[Soryn][Eclipsia]",
  },
  {
    base: ECLIPSIA + "vornix.js",
    enabled: true,
    providerTitle: "[Vornix][Eclipsia]",
  },
  {
    base: ECLIPSIA + "onyxia.js",
    enabled: true,
    providerTitle: "[Onyxia][Eclipsia]",
  },
  {
    base: ECLIPSIA + "pynvix.js",
    enabled: true,
    providerTitle: "[Pynvix][Eclipsia]",
  },
  {
    base: ECLIPSIA + "hexion.js",
    enabled: true,
    providerTitle: "[Hexion][Eclipsia]",
  },
  {
    base: ECLIPSIA + "mavonyx.js",
    enabled: true,
    providerTitle: "[Mavonyx][Eclipsia]",
  },
  {
    base: ECLIPSIA + "novus.js",
    enabled: true,
    providerTitle: "[Novus][Eclipsia]",
  },
  {
    base: ECLIPSIA + "durnel.js",
    enabled: true,
    providerTitle: "[Durnel][Eclipsia]",
  },
  {
    base: ECLIPSIA + "solunix.js",
    enabled: true,
    providerTitle: "[Solunix][Eclipsia]",
  },
  {
    base: ECLIPSIA + "fastrion.js",
    enabled: true,
    providerTitle: "[Fastrion][Eclipsia]",
  },
  {
    base: ECLIPSIA + "nyxora.js",
    enabled: true,
    providerTitle: "[Nyxora][Eclipsia]",
  },
  {
    base: ECLIPSIA + "karnis.js",
    enabled: true,
    providerTitle: "[Karnis][Eclipsia]",
  },
  {
    base: ECLIPSIA + "kryxalia.js",
    enabled: true,
    providerTitle: "[Kryxalia][Eclipsia]",
  },
  {
    base: ECLIPSIA + "eclipsianouveau.js",
    enabled: true,
    providerTitle: "[EclipsiaNouveau][Eclipsia]",
  },

  {
    base: ASURA + "peachify.js",
    enabled: true,
    providerTitle: "[Peachify][Asura]",
  },
  {
    base: ASURA + "playimdb.js",
    enabled: true,
    providerTitle: "[PlayIMDb][Asura]",
  },
  {
    base: ASURA + "4khdhub.js",
    enabled: false,
    providerTitle: "[4KHDHub][Asura]",
  },
  {
    base: ASURA + "anikototv.js",
    enabled: true,
    providerTitle: "[AnikotoTV][Asura]",
  },
  {
    base: ASURA + "animetsu.js",
    enabled: true,
    providerTitle: "[AnimeTsu][Asura]",
  },
  {
    base: ASURA + "biavox.js",
    enabled: true,
    providerTitle: "[BiaVox][Asura]",
  },
  {
    base: ASURA + "cinefreak.js",
    enabled: true,
    providerTitle: "[CineFreak][Asura]",
  },
  {
    base: ASURA + "cinemm.js",
    enabled: true,
    providerTitle: "[CineMM][Asura]",
  },
  {
    base: ASURA + "hdfilme.js",
    enabled: true,
    providerTitle: "[HDFilme][Asura]",
  },
  {
    base: ASURA + "hdhub4u.js",
    enabled: false,
    providerTitle: "[HDHub4U][Asura]",
  },
  {
    base: ASURA + "hindmovie.js",
    enabled: true,
    providerTitle: "[HindMovie][Asura]",
  },
  {
    base: ASURA + "kisskh.js",
    enabled: true,
    providerTitle: "[KissKH][Asura]",
  },
  {
    base: ASURA + "moviesdrive.js",
    enabled: false,
    providerTitle: "[MoviesDrive][Asura]",
  },
  {
    base: ASURA + "movieshunt.js",
    enabled: true,
    providerTitle: "[MoviesHunt][Asura]",
  },
  {
    base: ASURA + "uhdmovies.js",
    enabled: true,
    providerTitle: "[UHDMovies][Asura]",
  },
  {
    base: ASURA + "vegamovies.js",
    enabled: true,
    providerTitle: "[VegaMovies][Asura]",
  },
  {
    base: ASURA + "zinkmovies.js",
    enabled: true,
    providerTitle: "[ZinkMovies][Asura]",
  },
];

for (var pi = 0; pi < PROVIDERS.length; pi++) {
  var pv = PROVIDERS[pi];
  var m1 = pv.providerTitle.match(/^\[([^\]]+)\]/);
  pv.name = m1 ? m1[1] : pv.providerTitle;
  var m2 = pv.providerTitle.match(/^\[[^\]]*\]\[([^\]]+)\]/);
  pv.plugin = m2 ? m2[1] : "";
  pv.types = pv.types || ["movie", "tv"];
  pv.id = pv.providerTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

module.exports = PROVIDERS;
