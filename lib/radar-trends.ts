import { prisma } from "./prisma";
import type { Snapshot } from "./radar-scan";

/**
 * Lecture de l'historique des scans : qui grimpe vraiment, et quels produits
 * mériteraient d'être essayés.
 *
 * Un seul scan ne dit que « qui vend » ; c'est la succession des scans qui dit
 * « qui se met à vendre ». Un produit ne remonte le tri best-selling de Shopify
 * que s'il vend plus que ceux qu'il dépasse — une montée franche est donc une
 * preuve de ventes, là où un produit immobile en 99e position ne dit rien.
 */

/** Profondeur d'historique lue, en jours. */
export const HISTORY_DAYS = 7;

/** Montée retenue : au moins 3 places ET un rang amélioré d'au moins 40 %.
 *  « 99e → 94e » ne passe pas (5 %), « 9e → 3e » passe (3×). */
const MIN_GAIN = 3;
const MIN_RATIO = 1.4;

/** Sur une boutique à frontière incertaine, on ne sait pas où s'arrêtent les
 *  ventes : on ne croit que le haut du classement. */
const RAW_TOP = 10;

/** Pour le Top 3, un bon rang au sein de la zone de vente, pas le 250e d'une
 *  boutique où 300 produits vendent. */
const PICK_MAX_RANK = 30;

/** Lignes de catalogue qui vendent toujours sans être des articles : assurance
 *  colis, carte cadeau… Les recommander n'aurait aucun sens. */
const NOT_A_PRODUCT =
  /protection|assurance|insurance|carte[- ]?cadeau|gift[- ]?card|shipping|livraison|garantie|warranty|pourboire|emballage/i;

export type Step = { date: string; rank: number | null };

export type Trend = {
  domain: string;
  handle: string;
  title: string;
  price: string | null;
  url: string;
  age_days: number;
  rank: number;
  /** Rang à chaque scan de l'historique, du plus ancien au plus récent. */
  path: Step[];
  /** Rang au scan précédent, null si le produit n'y figurait pas. */
  prev: number | null;
  /** Places gagnées depuis le scan précédent. */
  gain: number | null;
  /** Frontière de vente fiable sur cette boutique. */
  reliable: boolean;
};

export type Pick = Trend & {
  score: number;
  /** Explication courte, une phrase. */
  why: string;
  /** Réserve éventuelle : signal d'un seul scan, classement brut… */
  caution: string | null;
};

export type Trends = {
  /** Dates des scans lus, du plus ancien au plus récent. */
  dates: string[];
  /** Montées franches depuis le scan précédent, les plus nettes d'abord. */
  climbers: Trend[];
  picks: Pick[];
};

type Dated = { date: string; snap: Snapshot };

const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** « 1re place », « 2e place ». */
const place = (n: number) => `${n}${n === 1 ? "re" : "e"}`;
/** « 1er des ventes », « 2e des ventes ». */
const nth = (n: number) => `${n}${n === 1 ? "er" : "e"}`;

/** Le produit est-il dans la partie du classement qui vend ? */
function inZone(rank: number, snap: Snapshot): boolean {
  return snap.confidence === "fiable" ? rank <= snap.boundary : rank <= RAW_TOP;
}

/** Montée assez nette pour être un signal de ventes. */
export function isRealClimb(from: number, to: number): boolean {
  return from - to >= MIN_GAIN && from / to >= MIN_RATIO;
}

/** Tendances d'une boutique, à partir de ses snapshots datés (ordre libre). */
function siteTrends(history: Dated[], day: string): Trend[] {
  const scans = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const last = scans.at(-1);
  if (!last) return [];
  const { snap } = last;
  const ranks = scans.map(({ snap: s }) => new Map(s.order.map((h, i) => [h, i + 1])));
  const before = ranks.length > 1 ? ranks[ranks.length - 2] : null;
  return snap.order.map((h, i) => {
    const p = snap.products[h];
    const rank = i + 1;
    const prev = before?.get(h) ?? null;
    return {
      domain: snap.domain,
      handle: h,
      title: p.title,
      price: p.price,
      url: `https://${snap.domain}/products/${h}`,
      age_days: days(p.created_at.slice(0, 10), day),
      rank,
      path: scans.map(({ date }, k) => ({ date, rank: ranks[k].get(h) ?? null })),
      prev,
      gain: prev == null ? null : prev - rank,
      reliable: snap.confidence === "fiable",
    };
  });
}

/**
 * Note d'un candidat. Quatre ingrédients, chacun lisible :
 * - la montée (en rapport de rangs, pour que 10 → 5 pèse autant que 40 → 20) ;
 * - le rang atteint ;
 * - la fraîcheur : un produit récent déjà haut vend VITE ;
 * - la tenue : plusieurs scans dans le top 10 écartent le coup de chance.
 */
function score(t: Trend) {
  const earlier = t.path.slice(0, -1).filter((s) => s.rank != null) as { date: string; rank: number }[];
  // Référence de la montée : le plus mauvais rang connu avant aujourd'hui.
  const worst = earlier.reduce<{ date: string; rank: number } | null>(
    (w, s) => (w == null || s.rank > w.rank ? s : w),
    null,
  );
  let momentum = worst && worst.rank > t.rank ? Math.min(5, Math.log2(worst.rank / t.rank)) : 0;
  // Un produit qui retombe depuis le scan précédent perd une partie du crédit.
  if (t.prev != null && t.prev < t.rank) momentum = Math.max(0, momentum - Math.log2(t.rank / t.prev));
  const rankPts = Math.max(0, 3 * (1 - Math.log10(t.rank) / Math.log10(PICK_MAX_RANK)));
  const fresh = t.age_days <= 7 ? 2 : t.age_days <= 14 ? 1.5 : t.age_days <= 30 ? 0.75 : 0;
  const held = t.path.filter((s) => s.rank != null && s.rank <= RAW_TOP).length;
  const holding = held >= 3 ? 1 : held === 2 ? 0.5 : 0;
  const total = (momentum + rankPts + fresh + holding) * (t.reliable ? 1 : 0.85);
  return { total, worst, momentum, held };
}

function explain(t: Trend, s: ReturnType<typeof score>): { why: string; caution: string | null } {
  const parts: string[] = [];
  const climbed = s.worst != null && isRealClimb(s.worst.rank, t.rank);
  if (climbed && s.worst) {
    const span = days(s.worst.date, t.path.at(-1)!.date);
    parts.push(
      `passé de la ${place(s.worst.rank)} à la ${place(t.rank)} place des ventes ${
        span <= 1 ? "en un scan" : `en ${span} jours`
      }`,
    );
  } else {
    parts.push(`${nth(t.rank)} des ventes`);
  }
  if (t.age_days <= 14) {
    parts.push(
      t.age_days <= 1
        ? "alors qu'il vient d'être mis en ligne"
        : `alors qu'il n'est en ligne que depuis ${t.age_days} jours`,
    );
  } else if (climbed && t.age_days > 60) {
    parts.push("un produit ancien qui redémarre");
  }
  if (s.held >= 3) parts.push(`dans le top 10 sur ${s.held} scans`);
  const why = parts.join(", ");

  let caution: string | null = null;
  const seen = t.path.filter((p) => p.rank != null).length;
  if (!t.reliable) {
    caution = "Classement brut : la frontière des ventes est incertaine sur cette boutique.";
  } else if (t.path.length > 1 && (t.prev == null || isRealClimb(t.prev, t.rank)) && s.held <= 1) {
    // Tout le mouvement tient dans le dernier scan : peut-être un pic d'un jour.
    caution = seen <= 1 ? "Apparu à ce scan, à confirmer demain." : "Montée d'un seul scan, à confirmer demain.";
  }
  return { why: why.charAt(0).toUpperCase() + why.slice(1) + ".", caution };
}

/**
 * Tendances de toutes les boutiques. `histories` : pour chaque domaine, ses
 * snapshots des derniers jours. Au plus un produit par boutique dans le Top 3 :
 * trois idées différentes valent mieux que trois robes du même concurrent.
 */
export function buildTrends(histories: Map<string, Dated[]>, day: string): Trends {
  const dates = new Set<string>();
  const climbers: Trend[] = [];
  const candidates: Pick[] = [];
  for (const history of histories.values()) {
    const last = [...history].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    if (!last) continue;
    history.forEach((h) => dates.add(h.date));
    for (const t of siteTrends(history, day)) {
      if (!inZone(t.rank, last.snap) || NOT_A_PRODUCT.test(`${t.title} ${t.handle}`)) continue;
      if (t.prev != null && isRealClimb(t.prev, t.rank)) climbers.push(t);
      if (t.rank > (t.reliable ? PICK_MAX_RANK : RAW_TOP)) continue;
      const s = score(t);
      candidates.push({ ...t, score: s.total, ...explain(t, s) });
    }
  }
  climbers.sort(
    (a, b) => a.rank / a.prev! - b.rank / b.prev! || (b.gain ?? 0) - (a.gain ?? 0),
  );
  candidates.sort((a, b) => b.score - a.score || a.rank - b.rank);
  const picks: Pick[] = [];
  for (const c of candidates) {
    // En dessous de 4 points, le produit est juste « bien classé » : ce n'est
    // pas une recommandation, mieux vaut un Top 2 qu'un Top 3 forcé.
    if (picks.length === 3 || c.score < 4) break;
    if (!picks.some((p) => p.domain === c.domain)) picks.push(c);
  }
  return { dates: [...dates].sort(), climbers: climbers.slice(0, 30), picks };
}

/** Lit l'historique en base et calcule les tendances des boutiques données. */
export async function loadTrends(domains: string[], day: string): Promise<Trends | null> {
  if (domains.length === 0) return null;
  const since = new Date(Date.parse(`${day}T00:00:00Z`) - HISTORY_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const rows = await prisma.radarSnapshot
    .findMany({ where: { domain: { in: domains }, date: { gte: since, lte: day } } })
    .catch(() => []);
  const histories = new Map<string, Dated[]>();
  for (const r of rows) {
    try {
      const snap = JSON.parse(r.payload) as Snapshot;
      histories.set(r.domain, [...(histories.get(r.domain) ?? []), { date: r.date, snap }]);
    } catch {
      // Un snapshot illisible ne doit pas priver les autres boutiques d'analyse.
    }
  }
  return histories.size > 0 ? buildTrends(histories, day) : null;
}
