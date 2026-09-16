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
};

export type ScanView = {
  id: string;
  /** "AAAA-MM-JJTHH:MM", heure de Paris. */
  at: string;
  products: ProductView[];
  isBaseline: boolean;
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

/** Handles connus, transmis au collecteur pour ne rien rater si la page
 *  collection pagine mal. */
export function knownHandles(scans: ScanView[]): string[] {
  const set = new Set(base.products.map((p) => p.h));
  for (const s of scans) for (const p of s.products) set.add(p.h);
  return [...set];
}

function baselineView(): ScanView {
  return {
    id: "baseline",
    at: base.scanned_at,
    isBaseline: true,
    products: base.products.map((p) => ({ ...p, qty: null })),
  };
}

/** Heure de Paris au format "AAAA-MM-JJTHH:MM". */
function parisStamp(iso: string): string {
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

/** Transforme un relevé brut en vue produit. Ce que la fiche ne donne pas
 *  (rayon, date de mise en ligne, prix barré) est repris de la référence. */
export function toView(id: string, raw: RawScan): ScanView {
  const products: ProductView[] = raw.products
    .filter((p) => p.variants.length > 0)
    .map((p) => {
      const ref = baseByHandle.get(p.h);
      const price = p.price ?? ref?.price ?? 0;
      const cap = p.cap ?? ref?.cap ?? 0;
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
        qty: Object.fromEntries(p.variants.map((v) => [v.sku || v.k, v.q])),
      };
    })
    .sort((a, b) => b.sold - a.sold);
  return { id, at: parisStamp(raw.scanned_at), isBaseline: false, products };
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
  for (const r of rows) {
    try {
      scans.push(toView(r.id, JSON.parse(r.payload) as RawScan));
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
};

export type Diff = {
  from: ScanView;
  to: ScanView;
  days: number;
  units: number;
  ca: number;
  movements: Movement[];
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
      });
    }
  }
  movements.sort((a, b) => b.units - a.units);
  return {
    from,
    to,
    days,
    units: movements.reduce((n, m) => n + m.units, 0),
    ca: Math.round(movements.reduce((n, m) => n + m.units * m.price, 0)),
    movements,
    exact,
  };
}
