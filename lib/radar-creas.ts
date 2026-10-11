/**
 * Créas d'un produit : les vidéos que la boutique affiche sur sa fiche.
 *
 * Principe : une boutique qui lance un produit avec des vidéos de créatrices
 * les remet presque toujours sur la fiche (carrousel « shoppable videos »,
 * galerie produit). Les lire dit avec quel contenu elle vend — sans certitude
 * que ce soit celui de sa campagne, d'où les liens de recherche TikTok fournis
 * à côté pour recouper.
 *
 * Tout passe par le HTML public de la fiche : pas de navigateur, donc
 * utilisable depuis le serveur comme le reste du radar.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT_MS = 8_000;

export type CreaVideo = {
  /** Fichier vidéo lisible directement dans le navigateur. */
  src: string;
  /** Vignette, quand la fiche en fournit une. */
  poster: string | null;
};

export type Creas = {
  /** Vidéos propres à ce produit. */
  videos: CreaVideo[];
  /** Vidéos écartées parce qu'affichées sur toutes les fiches de la boutique
   *  (carrousel de marque) : elles ne disent rien de ce produit-ci. */
  shared: number;
  /** Faux si les fiches témoins n'ont pas pu être lues : le tri entre vidéos
   *  du produit et vidéos de la boutique n'a alors pas été fait. */
  checked: boolean;
  /** Compte TikTok de la boutique, s'il est lié depuis la fiche. */
  tiktok: string | null;
  /** Renseigné quand la fiche n'a pas pu être lue. */
  error: string | null;
};

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/\\u0026/g, "&").replace(/\\\//g, "/");

/** "//cdn…" et "/cdn…" -> URL absolue ; rend null si ce n'est pas une URL web. */
function absolute(raw: string, origin: string): string | null {
  const u = decode(raw.trim());
  if (u.startsWith("//")) return `https:${u}`;
  if (u.startsWith("/")) return `${origin}${u}`;
  return /^https?:\/\//.test(u) ? u : null;
}

/**
 * Deux adresses de la même vidéo (qualités différentes, paramètres de cache)
 * doivent compter pour une. Shopify range ses vidéos sous un identifiant de
 * 32 caractères ; ailleurs, le chemin sans la qualité suffit.
 */
function videoKey(src: string): string {
  const id = src.match(/[0-9a-f]{32}/i);
  if (id) return id[0].toLowerCase();
  return src
    .split("?")[0]
    .replace(/\.(HD|SD)-\d+p[^/]*(?=\.\w+$)/i, "")
    .toLowerCase();
}

const VIDEO_URL = /(?:https?:)?\/\/[^"'\s<>\\)]+?\.(?:mp4|mov|webm)(?:\?[^"'\s<>\\)]*)?/gi;

/** Extrait les vidéos d'une fiche produit. Exporté pour être testé seul. */
export function extractVideos(html: string, origin: string): CreaVideo[] {
  const seen = new Map<string, CreaVideo>();
  const add = (raw: string, poster: string | null) => {
    const src = absolute(raw, origin);
    if (!src) return;
    const key = videoKey(src);
    const known = seen.get(key);
    if (!known) seen.set(key, { src, poster });
    else if (!known.poster && poster) known.poster = poster;
  };

  // Les balises <video> d'abord : ce sont elles qui portent la vignette.
  for (const m of html.matchAll(/<video\b[^>]*>[\s\S]*?<\/video>/gi)) {
    const block = m[0];
    const rawPoster = block.match(/\bposter="([^"]+)"/i)?.[1];
    const poster = rawPoster ? absolute(rawPoster, origin) : null;
    const first = block.match(VIDEO_URL)?.[0];
    if (first) add(first, poster);
  }
  // Puis les vidéos chargées à la demande, qui n'existent que dans les
  // données JSON de la page (galerie produit, applications de vidéos).
  for (const m of html.matchAll(VIDEO_URL)) add(m[0], null);

  return [...seen.values()];
}

/** Compte TikTok lié depuis la page : « https://www.tiktok.com/@marque ». */
export function extractTiktok(html: string): string | null {
  const m = html.match(/https?:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+/i);
  return m ? m[0] : null;
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const words = (s: string) =>
  new Set(s.toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter((w) => w.length > 3));

/**
 * Deux autres fiches de la même boutique, les moins proches possible de la
 * nôtre : la déclinaison bleu marine d'une doudoune partage légitimement ses
 * vidéos, une paire de bottes non. Exporté pour être testé seul.
 */
export function pickWitnesses(
  products: { handle: string; title: string }[],
  handle: string,
): string[] {
  const mine = words(handle.replace(/-/g, " "));
  const overlap = (p: { handle: string; title: string }) => {
    let n = 0;
    for (const w of words(`${p.title} ${p.handle.replace(/-/g, " ")}`))
      if (mine.has(w)) n++;
    return n;
  };
  return products
    .filter((p) => p.handle !== handle)
    .map((p) => ({ handle: p.handle, n: overlap(p) }))
    .sort((a, b) => a.n - b.n)
    .slice(0, 2)
    .map((p) => p.handle);
}

/** Identifiants des vidéos affichées sur deux fiches témoins à la fois. */
async function storeWideVideos(origin: string, handle: string): Promise<Set<string>> {
  const list = JSON.parse(await fetchPage(`${origin}/products.json?limit=30`)) as {
    products: { handle: string; title: string }[];
  };
  const witnesses = pickWitnesses(list.products, handle);
  if (witnesses.length < 2) throw new Error("pas assez de fiches témoins");
  const [a, b] = await Promise.all(
    witnesses.map(async (h) => {
      const html = await fetchPage(`${origin}/products/${h}`);
      return new Set(extractVideos(html, origin).map((v) => videoKey(v.src)));
    }),
  );
  return new Set([...a].filter((k) => b.has(k)));
}

/** Lit la fiche d'un produit et rend ses créas. Ne lève jamais : un Top 3 sans
 *  créas vaut mieux qu'une page de radar en erreur. */
export async function findCreas(productUrl: string): Promise<Creas> {
  try {
    const url = new URL(productUrl);
    const origin = url.origin;
    const handle = url.pathname.split("/products/")[1]?.split("/")[0] ?? "";
    const html = await fetchPage(productUrl);
    const all = extractVideos(html, origin);
    const tiktok = extractTiktok(html);
    if (all.length === 0)
      return { videos: [], shared: 0, checked: true, tiktok, error: null };
    try {
      const wide = await storeWideVideos(origin, handle);
      const videos = all.filter((v) => !wide.has(videoKey(v.src)));
      return {
        videos,
        shared: all.length - videos.length,
        checked: true,
        tiktok,
        error: null,
      };
    } catch {
      return { videos: all, shared: 0, checked: false, tiktok, error: null };
    }
  } catch (e) {
    return {
      videos: [],
      shared: 0,
      checked: false,
      tiktok: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Recherche TikTok des vidéos sur ce produit, pour recouper ce que montre la
 *  fiche — ou trouver des créas quand elle n'en montre aucune. */
export function tiktokSearchUrl(query: string): string {
  return `https://www.tiktok.com/search/video?q=${encodeURIComponent(query)}`;
}

/** Bibliothèque de publicités TikTok, filtrée sur le nom de l'annonceur : les
 *  annonces réellement diffusées en Europe, avec leurs dates et leur audience.
 *  Vide si la boutique annonce sous un autre nom de société. */
export function tiktokAdsUrl(advertiser: string): string {
  return `https://library.tiktok.com/ads?region=all&adv_name=${encodeURIComponent(advertiser)}&query_type=1&sort_type=last_shown_date,desc`;
}

/** Nom de marque lisible tiré du domaine : « fr.gianoria.com » -> « gianoria ». */
export function brandFromDomain(domain: string): string {
  const parts = domain.toLowerCase().split(".");
  const generic = new Set(["www", "fr", "en", "de", "shop", "store", "eu", "us"]);
  const kept = parts.slice(0, -1).filter((p) => !generic.has(p));
  return kept[kept.length - 1] ?? parts[0];
}
