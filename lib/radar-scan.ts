/**
 * Radar best-sellers Shopify — moteur de scan.
 *
 * Principe : Shopify trie `?sort_by=best-selling` par unités vendues sur une
 * fenêtre glissante d'environ 30 jours. Les produits à ZÉRO vente n'ont rien
 * pour être départagés et retombent en ordre de date de création décroissante.
 * On détecte cette rupture : tout ce qui est au-dessus a vendu au moins une
 * unité. Le classement reste ordinal — il dit qui vend, pas combien.
 *
 * Portage du scan Python (~/shopify-radar/scan.py) pour qu'un scan puisse être
 * lancé depuis l'application, à la demande, sans attendre le passage de 20h.
 */

/** Fenêtre « nouveauté », en jours. */
export const FRESH_DAYS = 7;
/** Plafond de nouveautés par site : une boutique neuve noierait la carte. */
const FRESH_MAX = 6;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/** Une page de catalogue est lente ; au-delà, le site ne répondra pas mieux. */
const TIMEOUT_MS = 12_000;
/** Pages maximum parcourues, catalogue comme classement. */
const MAX_PAGES = 20;

export type ProductInfo = {
  title: string;
  created_at: string;
  price: string | null;
};

export type Snapshot = {
  domain: string;
  scanned_at: string;
  n_products: number;
  order: string[];
  boundary: number;
  confidence: "fiable" | "faible";
  products: Record<string, ProductInfo>;
  collection: string;
  warning: string | null;
};

export type Move = {
  h: string;
  title: string;
  rank: number;
  from?: number;
  delta?: number;
};

export type Movements = {
  first_sale: Move[];
  climbing: Move[];
  /** Baisses de rang chez des produits qui vendent toujours. */
  falling: Move[];
  new_products: Move[];
  dropped_out: Move[];
};

export type Row = {
  handle: string;
  title: string;
  price: string | null;
  rank: number;
  age_days: number;
  url: string;
  selling?: boolean | null;
  /** Rang au scan précédent, `null` si le produit n'y figurait pas. */
  was?: number | null;
  /** Places gagnées depuis le scan précédent (négatif = perdues). `null` quand
   *  la comparaison est impossible : pas de scan précédent, ou produit absent
   *  de celui-ci — c'est alors `is_new` qui tranche entre les deux. */
  delta?: number | null;
  /** Vrai si le produit ne figurait pas au scan précédent. */
  is_new?: boolean;
};

export type SiteReport = {
  domain: string;
  error?: string;
  n_products?: number;
  boundary?: number;
  confidence?: "fiable" | "faible";
  warning?: string | null;
  compared_to?: string | null;
  top?: Row[];
  strong?: Row[];
  watch?: Row[];
  fresh?: Row[];
  movements?: Partial<Movements>;
};

export type Report = {
  date: string;
  generated_at: string;
  n_sites: number;
  n_strong: number;
  sites: SiteReport[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Accepte "https://Site.com/products/x", " site.com ", "SITE.COM" -> "site.com". */
export function normalizeDomain(line: string): string | null {
  const d = line
    .split("#")[0]
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")[0]
    .split("?")[0]
    .trim();
  return d || null;
}

/** Date du jour au format AAAA-MM-JJ, en heure locale (pas en UTC : un scan de
 *  22h à Paris doit être daté du jour où l'utilisateur l'a lancé). */
export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Horodatage local « 2026-09-10T14:32:07 », même forme que le scan Python. */
export function localTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${today()}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Âge d'un produit en jours, au jour du scan. */
function ageInDays(day: string, createdAt: string): number {
  const a = Date.parse(`${day}T00:00:00Z`);
  const b = Date.parse(`${createdAt.slice(0, 10)}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

async function fetchText(url: string, tries = 3): Promise<string> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      last = e;
      if (i === tries - 1) break;
      await sleep(1000 * (i + 1));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Catalogue complet via /products.json (paginé). */
async function getProducts(domain: string): Promise<Record<string, ProductInfo>> {
  const out: Record<string, ProductInfo> = {};
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await fetchText(
      `https://${domain}/products.json?limit=250&page=${page}`,
    );
    const products = (JSON.parse(body).products ?? []) as Array<{
      handle: string;
      title: string;
      created_at: string;
      variants?: Array<{ price: string }>;
    }>;
    if (products.length === 0) break;
    for (const p of products) {
      out[p.handle] = {
        title: p.title,
        created_at: p.created_at,
        price: p.variants?.[0]?.price ?? null,
      };
    }
    await sleep(300);
  }
  return out;
}

function decode(h: string): string {
  try {
    return decodeURIComponent(h);
  } catch {
    return h;
  }
}

/** Handles produits dans l'ordre du DOM, sans répétition consécutive. */
function handlesInOrder(html: string, known: Record<string, ProductInfo>): string[] {
  const seq: string[] = [];
  for (const m of html.matchAll(/\/products\/([^"'?#\s>]+)/g)) {
    const h = decode(m[1]);
    if (h in known && seq[seq.length - 1] !== h) seq.push(h);
  }
  return seq;
}

/** Plus longue fenêtre sans répétition : isole la grille des carrousels de reco. */
function longestDistinctRun(seq: string[]): string[] {
  let bestLen = 0;
  let bestStart = 0;
  let start = 0;
  const seen = new Map<string, number>();
  for (let i = 0; i < seq.length; i++) {
    const prev = seen.get(seq[i]);
    if (prev !== undefined && prev >= start) start = prev + 1;
    seen.set(seq[i], i);
    if (i - start + 1 > bestLen) {
      bestLen = i - start + 1;
      bestStart = start;
    }
  }
  return seq.slice(bestStart, bestStart + bestLen);
}

/** /collections/all n'existe pas partout : on retient la plus grosse collection. */
async function pickCollection(
  domain: string,
  nProducts: number,
): Promise<string | null> {
  let cols: Array<{ handle: string }>;
  try {
    cols = JSON.parse(
      await fetchText(`https://${domain}/collections.json?limit=250`),
    ).collections;
  } catch {
    return null;
  }
  const preferred = ["tous-les-produits", "all", "shop", "boutique"];
  // Les collections « fourre-tout » d'abord : elles ont le plus de chances de
  // contenir tout le catalogue, ce qui abrège la recherche.
  cols.sort(
    (a, b) =>
      Number(!preferred.includes(a.handle)) -
      Number(!preferred.includes(b.handle)),
  );
  let best: string | null = null;
  let bestN = 0;
  for (const c of cols) {
    let n = 0;
    try {
      n = JSON.parse(
        await fetchText(
          `https://${domain}/collections/${c.handle}/products.json?limit=250`,
        ),
      ).products.length;
    } catch {
      continue;
    }
    if (n > bestN) {
      best = c.handle;
      bestN = n;
    }
    if (bestN >= nProducts) break;
    await sleep(200);
  }
  return best;
}

async function getBestsellerOrder(
  domain: string,
  known: Record<string, ProductInfo>,
  coll: string,
): Promise<string[]> {
  const order: string[] = [];
  const inOrder = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchText(
      `https://${domain}/collections/${coll}?sort_by=best-selling&page=${page}`,
    );
    // 1) extraction structurée quand le thème numérote ses cellules
    let items: string[] = [];
    const parts = html.split(
      /product-grid__item product-grid__item--(\d+)/,
    );
    if (parts.length > 1) {
      const numbered: Array<[number, string]> = [];
      for (let i = 1; i < parts.length; i += 2) {
        const m = parts[i + 1]?.match(/\/products\/([^"'?#\s>]+)/);
        if (m) {
          const h = decode(m[1]);
          if (h in known) numbered.push([Number(parts[i]), h]);
        }
      }
      numbered.sort((a, b) => a[0] - b[0]);
      items = numbered.map(([, h]) => h);
    }
    // 2) sinon repli générique sur la plus longue grille sans doublon
    if (items.length === 0) {
      items = longestDistinctRun(handlesInOrder(html, known));
    }
    const fresh = items.filter((h) => !inOrder.has(h));
    if (fresh.length === 0) break;
    for (const h of fresh) {
      order.push(h);
      inOrder.add(h);
    }
    await sleep(300);
  }
  return order;
}

/**
 * Plus petit k tel que order[k:] suive exactement la date de création
 * décroissante. La queue triée par date est la zone sans vente ; k est donc le
 * nombre de produits qui ont vendu.
 */
export function salesBoundary(
  order: string[],
  products: Record<string, ProductInfo>,
): number {
  // L'ensemble des k qui conviennent est fermé vers le haut : on part donc de
  // la fin (une queue d'un seul élément est triée d'office) et on remonte tant
  // que la suite reste décroissante.
  if (order.length === 0) return 0;
  let k = order.length - 1;
  for (let i = order.length - 2; i >= 0; i--) {
    if (products[order[i]].created_at < products[order[i + 1]].created_at) break;
    k = i;
  }
  return k;
}

/**
 * La frontière n'est fiable que si la queue zéro-vente est assez longue ET
 * assez variée en dates : une queue courte ou à dates identiques passe le test
 * par hasard et ne prouve rien.
 */
export function boundaryConfidence(
  order: string[],
  products: Record<string, ProductInfo>,
  k: number,
): "fiable" | "faible" {
  const tail = order.slice(k);
  const dates = new Set(tail.map((h) => products[h].created_at.slice(0, 10)));
  return tail.length < 5 || dates.size < 3 ? "faible" : "fiable";
}

/** Scanne une boutique. Lève une erreur lisible si le site est inexploitable. */
export async function scanSite(domain: string): Promise<Snapshot> {
  const products = await getProducts(domain);
  if (Object.keys(products).length === 0) {
    throw new Error(
      "aucun produit (site non Shopify ou /products.json bloqué ?)",
    );
  }
  let coll = "all";
  let note: string | null = null;
  try {
    await fetchText(
      `https://${domain}/collections/all?sort_by=best-selling`,
      1,
    );
  } catch {
    const picked = await pickCollection(domain, Object.keys(products).length);
    if (!picked) {
      throw new Error("pas de collection exploitable pour le tri best-selling");
    }
    coll = picked;
    note = `/collections/all absent, classement lu sur /collections/${coll}`;
  }
  const order = await getBestsellerOrder(domain, products, coll);
  const missing = Object.keys(products).length - order.length;
  const boundary = salesBoundary(order, products);
  const warnings = [
    note,
    missing > 0 ? `${missing} produit(s) du catalogue absents du classement` : null,
  ].filter(Boolean);
  return {
    domain,
    scanned_at: localTimestamp(),
    n_products: Object.keys(products).length,
    order,
    boundary,
    confidence: boundaryConfidence(order, products, boundary),
    products,
    collection: coll,
    warning: warnings.length > 0 ? warnings.join("; ") : null,
  };
}

/** Mouvements d'un scan à l'autre. Rang 1 = meilleure vente. */
export function diff(now: Snapshot, prev: Snapshot | null): Movements | null {
  if (!prev) return null;
  const oldRank = new Map(prev.order.map((h, i) => [h, i]));
  const ev: Movements = {
    first_sale: [],
    climbing: [],
    falling: [],
    new_products: [],
    dropped_out: [],
  };
  now.order.forEach((h, r) => {
    const t = now.products[h].title;
    const was = oldRank.get(h);
    if (was === undefined) {
      ev.new_products.push({ h, title: t, rank: r + 1 });
      return;
    }
    const delta = was - r; // positif = remonte
    const wasSelling = was < prev.boundary;
    const isSelling = r < now.boundary;
    if (isSelling && !wasSelling) {
      ev.first_sale.push({ h, title: t, rank: r + 1, from: was + 1 });
    } else if (isSelling && delta > 0) {
      ev.climbing.push({ h, title: t, rank: r + 1, from: was + 1, delta });
    } else if (isSelling && delta < 0) {
      // Une baisse est une information au même titre qu'une hausse : elle dit
      // qu'un produit s'essouffle pendant que d'autres le dépassent.
      ev.falling.push({ h, title: t, rank: r + 1, from: was + 1, delta });
    } else if (wasSelling && !isSelling) {
      ev.dropped_out.push({ h, title: t, rank: r + 1, from: was + 1 });
    }
  });
  ev.climbing.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
  ev.falling.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));
  ev.first_sale.sort((a, b) => a.rank - b.rank);
  return ev;
}

/**
 * Croise rang et fraîcheur. Un produit récent bien classé vend VITE ; un
 * produit ancien bien classé a pu accumuler lentement.
 */
export function buildSignals(
  snap: Snapshot,
  ev: Movements | null,
  day: string,
  prev: Snapshot | null = null,
) {
  const { order, products, boundary } = snap;
  const reliable = snap.confidence === "fiable";
  const rankBefore = rankMap(prev);
  const strong: Row[] = [];
  const watch: Row[] = [];
  let fresh: Row[] = [];
  order.forEach((h, i) => {
    const p = products[h];
    const age = ageInDays(day, p.created_at);
    const row: Row = {
      handle: h,
      title: p.title,
      price: p.price,
      rank: i + 1,
      age_days: age,
      url: `https://${snap.domain}/products/${h}`,
      ...movementOf(h, i, rankBefore),
    };
    const selling = i < boundary && reliable;
    if (selling && age <= 14 && i < 10) strong.push(row);
    else if (selling && age <= 25 && i < Math.max(3, Math.floor(boundary / 2)))
      watch.push(row);
    // Les nouveautés listent TOUT ce qui est récent, qu'il vende ou non :
    // savoir qu'un produit de 3 jours est déjà classé est le vrai signal.
    if (age <= FRESH_DAYS) {
      fresh.push({ ...row, selling: reliable ? selling : null });
    }
  });
  // Ceux qui vendent déjà passent devant : c'est l'information utile.
  fresh.sort(
    (a, b) =>
      Number(a.selling !== true) - Number(b.selling !== true) ||
      (a.selling ? a.rank - b.rank : a.age_days - b.age_days),
  );
  fresh = fresh.slice(0, FRESH_MAX);
  return { strong, watch, fresh, movements: ev ?? {} };
}

/** Rang (0-indexé) de chaque produit au scan précédent, s'il y en a un. */
function rankMap(prev: Snapshot | null): Map<string, number> | null {
  return prev ? new Map(prev.order.map((h, i) => [h, i])) : null;
}

/**
 * Mouvement d'un produit depuis le scan précédent. C'est l'information que
 * l'on veut voir sur la ligne du produit lui-même : un produit qui gagne une
 * place ne doit pas obliger à aller la chercher dans une autre carte.
 */
function movementOf(
  handle: string,
  index: number,
  before: Map<string, number> | null,
): { was: number | null; delta: number | null; is_new: boolean } {
  // Sans scan précédent, rien à comparer — et surtout, ne pas faire passer
  // tout le catalogue pour des nouveautés.
  if (!before) return { was: null, delta: null, is_new: false };
  const was = before.get(handle);
  if (was === undefined) return { was: null, delta: null, is_new: true };
  return { was: was + 1, delta: was - index, is_new: false };
}

/** Fiche d'un site pour le tableau de bord, à partir de son snapshot. */
export function buildSiteReport(
  snap: Snapshot,
  prev: Snapshot | null,
  day: string,
): SiteReport {
  const ev = diff(snap, prev);
  const rankBefore = rankMap(prev);
  return {
    domain: snap.domain,
    n_products: snap.n_products,
    boundary: snap.boundary,
    confidence: snap.confidence,
    warning: snap.warning,
    compared_to: prev ? prev.scanned_at.slice(0, 10) : null,
    top: snap.order.slice(0, 15).map((h, i) => ({
      handle: h,
      title: snap.products[h].title,
      price: snap.products[h].price,
      rank: i + 1,
      age_days: ageInDays(day, snap.products[h].created_at),
      url: `https://${snap.domain}/products/${h}`,
      ...movementOf(h, i, rankBefore),
    })),
    ...buildSignals(snap, ev, day, prev),
  };
}

/** Message d'échec compréhensible plutôt que la trace technique. */
export function readableError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("403")) {
    return "bloqué par une protection anti-bot (Cloudflare) — scan automatique impossible";
  }
  if (/timed? ?out|TimeoutError|aborted/i.test(msg)) {
    return "le site n'a pas répondu à temps";
  }
  return msg;
}
