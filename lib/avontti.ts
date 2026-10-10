/**
 * Scan exclusif d'Avontti (boutique SHOPLINE, pas Shopify).
 *
 * Le radar générique ne s'applique pas ici : SHOPLINE ne trie pas par ventes
 * sur une fenêtre lisible, mais la boutique vend en `inventory_policy:
 * continue`. Le stock passe en négatif une fois à zéro, et ce négatif est un
 * compteur de ventes par variante. Deux relevés successifs donnent donc les
 * unités réellement écoulées entre les deux, sans estimation.
 *
 * avontti.com est derrière un challenge Cloudflare JavaScript : aucune requête
 * serveur (Vercel, curl, fetch Node) ne passe. Le relevé est donc fait par le
 * navigateur de l'utilisateur, sur le site, puis envoyé ici — voir
 * lib/avontti-collector.ts.
 */

import baseline from "@/data/avontti-baseline.json";
import { prisma } from "./prisma";

/** Une variante telle que lue sur la fiche : `q` est la quantité en stock,
 *  négative quand la boutique a vendu au-delà du stock. */
export type RawVariant = { k: string; sku?: string | null; q: number };

export type RawProduct = {
  h: string;
  t: string;
  price: number | null;
  cap?: number | null;
  pub?: string | null;
  pol?: string | null;
  variants: RawVariant[];
  err?: string | null;
};

/** Ce que le collecteur envoie. */
export type RawScan = {
  v: 1;
  scanned_at: string;
  products: RawProduct[];
  /** Handles dans l'ordre du tri natif « Meilleurs vendeurs » (?sort_type=2),
   *  absent des relevés faits avant que le collecteur ne le lise. */
  best?: string[];
};

/** Produit prêt à afficher, relevé réel ou référence du 15 septembre. */
export type ProductView = {
  t: string;
  h: string;
  price: number;
  cap: number;
  disc: number;
  nv: number;
  oos: number;
  /** Unités écoulées au-delà du stock : un plancher, pas un total. */
  sold: number;
  ca: number;
  pub: string | null;
  col: string;
  pol: string;
  curve: [string, number][] | null;
  /** Quantités par variante, absentes de la référence du 15 septembre. */
  qty: Record<string, number> | null;
  /** Ligne de catalogue qui n'est pas un article (assurance colis…) : elle
   *  vend à chaque commande et écraserait tous les classements. */
  aux: boolean;
};

export type ScanView = {
  id: string;
  /** "AAAA-MM-JJTHH:MM", heure de Paris. */
  at: string;
  products: ProductView[];
  isBaseline: boolean;
  /** Ordre du tri natif « Meilleurs vendeurs », null si non relevé. */
  best: string[] | null;
  /** Fiches en 404 : retirées du site depuis qu'on les connaît. */
  gone: string[];
};

export type FeedItem = { t: string; p: string; c: string };

type Baseline = {
  date: string;
  scanned_at: string;
  products: (Omit<ProductView, "qty" | "pub"> & { pub: string; sku: string })[];
  feed: FeedItem[];
};

const base = baseline as unknown as Baseline;
const baseByHandle = new Map(base.products.map((p) => [p.h, p]));

export const BASELINE_FEED = base.feed;
export const BASELINE_AT = base.scanned_at;

const NOT_A_PRODUCT =
  /protection|assurance|insurance|carte[- ]?cadeau|gift[- ]?card|pourboire|tip\b/i;
const isAux = (t: string, h: string) => NOT_A_PRODUCT.test(`${t} ${h}`);

/** Handles connus, transmis au collecteur pour ne rien rater si la page
 *  collection pagine mal. Une fiche en 404 au dernier relevé n'est plus
 *  redemandée : elle a été retirée du site. */
export function knownHandles(scans: ScanView[]): string[] {
  const set = new Set(base.products.map((p) => p.h));
  for (const s of scans) for (const p of s.products) set.add(p.h);
  for (const h of scans[0]?.gone ?? []) set.delete(h);
  return [...set];
}

function baselineView(): ScanView {
  return {
    id: "baseline",
    at: base.scanned_at,
    isBaseline: true,
    best: null,
    gone: [],
    products: base.products.map((p) => ({ ...p, qty: null, aux: isAux(p.t, p.h) })),
  };
}

/** SHOPLINE donne parfois ses prix en centimes (3595 pour 35,95 €) et le
 *  collecteur les relève tels quels. Un prix entier d'au moins 100 sans
 *  décimale est lu comme des centimes : aucun article Avontti ne coûte 100 €
 *  tout rond, alors que tous leurs prix finissent en ,95. */
const fromCents = (n: number | null | undefined): number | null =>
  n == null ? null : Number.isInteger(n) && n >= 100 ? n / 100 : n;

/** Heure de Paris au format "AAAA-MM-JJTHH:MM". */
export function parisStamp(iso: string): string {
  const d = new Date(iso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Clé d'une variante d'un relevé à l'autre : son SKU s'il lui est propre.
 *  Certaines fiches répètent le même SKU sur toutes leurs variantes (les 98
 *  tranches de l'assurance colis) : la clé y ajoute alors le libellé, sinon
 *  les variantes s'écraseraient et leurs ventes disparaîtraient du diff. */
function variantKey(all: RawVariant[], v: RawVariant): string {
  if (!v.sku) return v.k;
  const shared = all.some((o) => o !== v && o.sku === v.sku);
  return shared ? `${v.sku}/${v.k}` : v.sku;
}

/** Transforme un relevé brut en vue produit. Ce que la fiche ne donne pas
 *  (rayon, date de mise en ligne, prix barré) est repris de la référence. */
export function toView(id: string, raw: RawScan): ScanView {
  const products: ProductView[] = raw.products
    .filter((p) => p.variants.length > 0)
    .map((p) => {
      const ref = baseByHandle.get(p.h);
      const price = fromCents(p.price) ?? ref?.price ?? 0;
      const cap = fromCents(p.cap) ?? ref?.cap ?? 0;
      const sold = p.variants.reduce((n, v) => n + Math.max(0, -v.q), 0);
      const pol = p.pol ?? ref?.pol ?? "continue";
      return {
        t: p.t || ref?.t || p.h,
        h: p.h,
        price,
        cap,
        disc: cap > price ? Math.round((1 - price / cap) * 100) : 0,
        nv: p.variants.length,
        oos: p.variants.filter((v) => v.q <= 0 && pol === "deny").length,
        sold,
        ca: Math.round(sold * price),
        pub: p.pub ?? ref?.pub ?? null,
        col: ref?.col ?? "—",
        pol,
        curve: p.variants.map((v) => [v.k, Math.max(0, -v.q)] as [string, number]),
        qty: Object.fromEntries(p.variants.map((v) => [variantKey(p.variants, v), v.q])),
        aux: isAux(p.t || ref?.t || "", p.h),
      };
    })
    .sort((a, b) => b.sold - a.sold);
  return {
    id,
    at: parisStamp(raw.scanned_at),
    isBaseline: false,
    products,
    best: Array.isArray(raw.best) && raw.best.length > 0 ? raw.best : null,
    gone: raw.products.filter((p) => /404/.test(p.err ?? "")).map((p) => p.h),
  };
}

/* ── Stockage ─────────────────────────────────────────────────────────────
 * Table créée à la volée : les tables du radar ont été créées à la main sur
 * Turso, celle-ci s'installe seule au premier relevé. */

let ready: Promise<unknown> | null = null;
function ensureTable() {
  ready ??= prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "AvonttiScan" (
       "id" TEXT PRIMARY KEY,
       "scannedAt" TEXT NOT NULL,
       "payload" TEXT NOT NULL,
       "createdAt" TEXT NOT NULL
     )`,
  );
  return ready;
}

/** Valide un relevé reçu du navigateur. Renvoie un message d'erreur lisible,
 *  ou null si le relevé est exploitable. */
export function checkScan(raw: unknown): string | null {
  const s = raw as RawScan;
  if (!s || s.v !== 1 || !Array.isArray(s.products)) {
    return "Ce n'est pas un relevé Avontti.";
  }
  if (Number.isNaN(Date.parse(s.scanned_at))) return "Relevé sans date.";
  const read = s.products.filter(
    (p) => typeof p?.h === "string" && Array.isArray(p.variants) && p.variants.length > 0,
  );
  if (read.length === 0) {
    return `Aucune variante lue sur ${s.products.length} fiche(s) : la structure du site a changé, le collecteur doit être adapté.`;
  }
  for (const p of read) {
    for (const v of p.variants) {
      if (typeof v.q !== "number" || !Number.isFinite(v.q)) {
        return `Quantité illisible sur ${p.h}.`;
      }
    }
  }
  return null;
}

export async function insertScan(raw: RawScan): Promise<string> {
  await ensureTable();
  // Le collecteur renvoie son relevé jusqu'à l'accusé de réception, et la page
  // peut être ouverte deux fois : un même relevé ne doit compter qu'une fois,
  // sinon le dernier relevé se compare à lui-même et la période affiche zéro.
  const same = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "AvonttiScan" WHERE "scannedAt" = ? LIMIT 1`,
    raw.scanned_at,
  );
  if (same[0]) return same[0].id;
  const id = `av_${Date.now().toString(36)}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AvonttiScan" ("id","scannedAt","payload","createdAt") VALUES (?,?,?,?)`,
    id,
    raw.scanned_at,
    JSON.stringify(raw),
    new Date().toISOString(),
  );
  return id;
}

/** Tous les relevés, du plus récent au plus ancien, la référence du 15
 *  septembre en dernier. */
export async function loadScans(): Promise<ScanView[]> {
  const rows = await ensureTable()
    .then(() =>
      prisma.$queryRawUnsafe<{ id: string; payload: string }[]>(
        `SELECT "id","payload" FROM "AvonttiScan" ORDER BY "scannedAt" DESC LIMIT 60`,
      ),
    )
    .catch(() => [] as { id: string; payload: string }[]);
  const scans: ScanView[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    try {
      const raw = JSON.parse(r.payload) as RawScan;
      // Doublons enregistrés avant le garde-fou d'insertScan.
      if (seen.has(raw.scanned_at)) continue;
      seen.add(raw.scanned_at);
      scans.push(toView(r.id, raw));
    } catch {
      // Un relevé corrompu ne doit pas faire tomber la page.
    }
  }
  scans.push(baselineView());
  return scans;
}

/* ── Comparaison de deux relevés ───────────────────────────────────────── */

export type Movement = {
  h: string;
  t: string;
  price: number;
  /** Unités écoulées entre les deux relevés. */
  units: number;
  perDay: number;
  /** Du stock a été ajouté sur au moins une variante : le chiffre est un
   *  plancher, les ventes couvertes par le réassort ne se voient pas. */
  restock: boolean;
  isNew: boolean;
  aux: boolean;
};

export type Diff = {
  from: ScanView;
  to: ScanView;
  days: number;
  units: number;
  ca: number;
  /** Articles uniquement : l'assurance colis est comptée à part. */
  movements: Movement[];
  /** Unités d'assurance colis vendues : à peu près une par commande qui la
   *  prend, donc un plancher du nombre de commandes. */
  orders: number;
  /** Fiches présentes au relevé de départ et retirées depuis (404). */
  removed: string[];
  /** Comparaison variante par variante (deux vrais relevés), ou produit par
   *  produit sur le cumul (contre la référence du 15 septembre). */
  exact: boolean;
};

export function diffScans(to: ScanView, from: ScanView): Diff {
  const days = Math.max(
    (Date.parse(to.at) - Date.parse(from.at)) / 864e5,
    1 / 24,
  );
  const before = new Map(from.products.map((p) => [p.h, p]));
  const exact = !to.isBaseline && !from.isBaseline;
  const movements: Movement[] = [];
  for (const p of to.products) {
    const old = before.get(p.h);
    let units = 0;
    let restock = false;
    if (!old) {
      units = p.sold;
    } else if (p.qty && old.qty) {
      for (const [k, q] of Object.entries(p.qty)) {
        const prev = old.qty[k];
        if (prev === undefined) continue;
        if (prev > q) units += prev - q;
        else if (q > prev) restock = true;
      }
    } else {
      units = p.sold - old.sold;
      if (units < 0) {
        restock = true;
        units = 0;
      }
    }
    if (units > 0 || restock) {
      movements.push({
        h: p.h,
        t: p.t,
        price: p.price,
        units,
        perDay: units / days,
        restock,
        isNew: !old,
        aux: p.aux,
      });
    }
  }
  movements.sort((a, b) => b.units - a.units);
  const items = movements.filter((m) => !m.aux);
  const gone = new Set(to.gone);
  return {
    from,
    to,
    days,
    units: items.reduce((n, m) => n + m.units, 0),
    ca: Math.round(items.reduce((n, m) => n + m.units * m.price, 0)),
    movements: items,
    orders: movements.filter((m) => m.aux).reduce((n, m) => n + m.units, 0),
    removed: from.products.filter((p) => gone.has(p.h)).map((p) => p.t),
    exact,
  };
}

/* ── Le moment présent ─────────────────────────────────────────────────── */

/** Largeur visée de la fenêtre « en ce moment ». Une semaine lisse les jours
 *  creux et les week-ends sans noyer une accélération récente. */
const WINDOW_DAYS = 7;

/** Le relevé le plus récent pris au moins `WINDOW_DAYS` (à un jour près)
 *  avant `to`, sinon le plus ancien des vrais relevés. */
function windowStart(scans: ScanView[], to: ScanView): ScanView | null {
  const real = scans.filter((s) => !s.isBaseline && s !== to && s.at < to.at);
  const limit = Date.parse(to.at) - (WINDOW_DAYS - 1) * 864e5;
  return real.find((s) => Date.parse(s.at) <= limit) ?? real.at(-1) ?? null;
}

export type PaceItem = Movement & {
  /** Rythme sur la fenêtre précédente, null si le produit n'y vendait pas
   *  ou s'il n'y a pas de fenêtre précédente. */
  before: number | null;
  trend: "up" | "down" | "flat" | "new";
};

export type Pace = {
  window: Diff;
  previous: Diff | null;
  items: PaceItem[];
};

/**
 * Ce qui se vend en ce moment : les ventes de la dernière fenêtre d'environ
 * une semaine, comparées à la fenêtre d'avant. C'est la version mesurée de ce
 * que le teardown du 15/09 devinait à partir du pop-up et du tri natif.
 */
export function currentPace(scans: ScanView[]): Pace | null {
  const to = scans[0];
  if (!to || to.isBaseline) return null;
  const from = windowStart(scans, to);
  if (!from) return null;
  const window = diffScans(to, from);
  const start = windowStart(scans, from);
  const previous = start ? diffScans(from, start) : null;
  const was = new Map(previous?.movements.map((m) => [m.h, m.perDay]) ?? []);
  const items = window.movements
    .filter((m) => m.units > 0)
    .map((m): PaceItem => {
      const before = was.get(m.h) ?? null;
      let trend: PaceItem["trend"] = "flat";
      if (!previous) trend = "flat";
      else if (before == null) trend = "new";
      // ±25 % et au moins une demi-unité par jour d'écart : en dessous, c'est
      // du bruit sur des produits qui vendent une pièce tous les deux jours.
      else if (m.perDay >= before * 1.25 && m.perDay - before >= 0.5) trend = "up";
      else if (m.perDay <= before * 0.75 && before - m.perDay >= 0.5) trend = "down";
      return { ...m, before, trend };
    });
  return { window, previous, items };
}
