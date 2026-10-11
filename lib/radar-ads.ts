import { prisma } from "./prisma";

/**
 * Veille des pubs TikTok : les publicités de boutiques de mode femme croisées
 * dans le fil « Pour toi » du compte TikTok de l'utilisateur.
 *
 * Comme la recherche approfondie, elle ne peut pas tourner depuis le serveur :
 * il faut un navigateur connecté au compte. Le bouton de la page enregistre
 * une demande de session ; une session Claude, avec Chrome, fait défiler le
 * fil et dépose ici chaque pub retenue (voir scripts/radar-ads.mjs). La page
 * relit simplement ces deux tables.
 */

/** Durée d'une session de veille, en minutes. Au-delà, le fil web de TikTok
 *  ressert surtout les mêmes annonceurs : mieux vaut une session par jour
 *  qu'une longue, c'est la répétition d'un jour sur l'autre qui fait le signal. */
export const SESSION_MINUTES = 30;

/** Une créa : une vidéo sponsorisée, vue une ou plusieurs fois. */
export type AdCrea = {
  id: string;
  videoUrl: string;
  /** Compte TikTok de l'annonceur, avec son @. */
  advertiser: string;
  caption: string | null;
  likes: number | null;
  /** Libellé du bouton de la pub, ex. « Acheter ». */
  cta: string | null;
  /** "AAAA-MM-JJ" : mise en ligne de la vidéo, lue dans son identifiant. */
  postedAt: string | null;
  firstSeen: string;
  lastSeen: string;
  /** Jours distincts où elle est apparue, "AAAA-MM-JJ". */
  days: string[];
  /** Nombre d'apparitions, toutes sessions confondues. */
  seen: number;
  note: string | null;
};

/** Un produit poussé en pub, avec toutes les créas qui y mènent. */
export type AdProduct = {
  key: string;
  url: string;
  domain: string;
  title: string;
  price: string | null;
  image: string | null;
  /** Type de produit, ex. « robe », « ensemble ». */
  kind: string | null;
  creas: AdCrea[];
  /** Jours distincts où une de ses pubs est apparue. */
  days: string[];
  /** Première trace de la campagne : la plus ancienne mise en ligne d'une de
   *  ses créas, ou à défaut le premier jour où on l'a vue. */
  since: string;
  lastSeen: string;
  /** Jours écoulés entre `since` et la dernière apparition. */
  runningDays: number;
};

export type AdSession = {
  id: string;
  status: "pending" | "running" | "done";
  requestedAt: string;
  startedAt: string | null;
  doneAt: string | null;
  /** Bilan déposé en fin de session. */
  stats: {
    minutes?: number;
    videos?: number;
    ads?: number;
    kept?: number;
    carts?: number;
    note?: string | null;
  };
};

type AdRow = {
  id: string;
  videoUrl: string;
  advertiser: string;
  caption: string | null;
  likes: number | bigint | null;
  cta: string | null;
  landingUrl: string;
  domain: string;
  productKey: string;
  productTitle: string;
  price: string | null;
  image: string | null;
  kind: string | null;
  postedAt: string | null;
  firstSeen: string;
  lastSeen: string;
  days: string;
  seen: number | bigint;
  note: string | null;
};

type SessionRow = {
  id: string;
  status: string;
  requestedAt: string;
  startedAt: string | null;
  doneAt: string | null;
  payload: string | null;
};

/* Tables créées à la volée, comme RadarCreaSearch : rien à installer sur
   Turso. Le script de la session Claude crée les mêmes. */
let ready: Promise<unknown> | null = null;
function ensureTables() {
  ready ??= (async () => {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "RadarAd" (
         "id" TEXT PRIMARY KEY,
         "videoUrl" TEXT NOT NULL,
         "advertiser" TEXT NOT NULL,
         "caption" TEXT,
         "likes" INTEGER,
         "cta" TEXT,
         "landingUrl" TEXT NOT NULL,
         "domain" TEXT NOT NULL,
         "productKey" TEXT NOT NULL,
         "productTitle" TEXT NOT NULL,
         "price" TEXT,
         "image" TEXT,
         "kind" TEXT,
         "postedAt" TEXT,
         "firstSeen" TEXT NOT NULL,
         "lastSeen" TEXT NOT NULL,
         "days" TEXT NOT NULL,
         "seen" INTEGER NOT NULL,
         "note" TEXT
       )`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "RadarAdSession" (
         "id" TEXT PRIMARY KEY,
         "status" TEXT NOT NULL,
         "requestedAt" TEXT NOT NULL,
         "startedAt" TEXT,
         "doneAt" TEXT,
         "payload" TEXT
       )`,
    );
  })();
  return ready;
}

function parseDays(raw: string): string[] {
  try {
    const d = JSON.parse(raw) as unknown;
    return Array.isArray(d) ? d.filter((x): x is string => typeof x === "string").sort() : [];
  } catch {
    return [];
  }
}

const dayDiff = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000));

/** Regroupe les créas par produit et classe les produits : ceux dont la pub
 *  tourne depuis le plus longtemps d'abord. Exporté pour être testé seul. */
export function groupAds(rows: AdRow[]): AdProduct[] {
  const byKey = new Map<string, AdProduct>();
  for (const r of rows) {
    const crea: AdCrea = {
      id: r.id,
      videoUrl: r.videoUrl,
      advertiser: r.advertiser,
      caption: r.caption,
      likes: r.likes == null ? null : Number(r.likes),
      cta: r.cta,
      postedAt: r.postedAt,
      firstSeen: r.firstSeen,
      lastSeen: r.lastSeen,
      days: parseDays(r.days),
      seen: Number(r.seen),
      note: r.note,
    };
    const start = crea.postedAt ?? crea.firstSeen.slice(0, 10);
    const p = byKey.get(r.productKey);
    if (!p) {
      byKey.set(r.productKey, {
        key: r.productKey,
        url: r.landingUrl,
        domain: r.domain,
        title: r.productTitle,
        price: r.price,
        image: r.image,
        kind: r.kind,
        creas: [crea],
        days: crea.days,
        since: start,
        lastSeen: crea.lastSeen,
        runningDays: 0,
      });
      continue;
    }
    p.creas.push(crea);
    p.days = [...new Set([...p.days, ...crea.days])].sort();
    if (start < p.since) p.since = start;
    if (crea.lastSeen > p.lastSeen) p.lastSeen = crea.lastSeen;
    p.image ??= r.image;
    p.price ??= r.price;
    p.kind ??= r.kind;
  }
  const products = [...byKey.values()];
  for (const p of products) {
    p.runningDays = dayDiff(p.since, p.lastSeen);
    p.creas.sort((a, b) => b.seen - a.seen || b.lastSeen.localeCompare(a.lastSeen));
  }
  // Revue sur plusieurs jours d'abord : c'est constaté. L'ancienneté lue sur
  // la vidéo départage ensuite, puis le nombre de créas engagées.
  return products.sort(
    (a, b) =>
      b.days.length - a.days.length ||
      b.runningDays - a.runningDays ||
      b.creas.length - a.creas.length ||
      b.lastSeen.localeCompare(a.lastSeen),
  );
}

/** Tous les produits repérés. Ne lève pas : une base injoignable ne doit pas
 *  casser la page. */
export async function loadAds(): Promise<AdProduct[]> {
  try {
    await ensureTables();
    const rows = await prisma.$queryRawUnsafe<AdRow[]>(`SELECT * FROM "RadarAd"`);
    return groupAds(rows);
  } catch {
    return [];
  }
}

function toSession(r: SessionRow): AdSession {
  let stats: AdSession["stats"] = {};
  try {
    stats = JSON.parse(r.payload ?? "{}") as AdSession["stats"];
  } catch {
    // Bilan illisible : on affiche la session sans ses chiffres.
  }
  return {
    id: r.id,
    status: r.status === "done" ? "done" : r.status === "running" ? "running" : "pending",
    requestedAt: r.requestedAt,
    startedAt: r.startedAt,
    doneAt: r.doneAt,
    stats,
  };
}

/** Les dernières sessions, la plus récente d'abord. Ne lève pas. */
export async function loadSessions(limit = 5): Promise<AdSession[]> {
  try {
    await ensureTables();
    const rows = await prisma.$queryRawUnsafe<SessionRow[]>(
      `SELECT * FROM "RadarAdSession" ORDER BY "requestedAt" DESC LIMIT ?`,
      limit,
    );
    return rows.map(toSession);
  } catch {
    return [];
  }
}

/** Enregistre une demande de session. Une demande déjà en attente ou en cours
 *  est rendue telle quelle : cliquer deux fois ne lance pas deux veilles. */
export async function requestSession(): Promise<AdSession> {
  await ensureTables();
  const open = await prisma.$queryRawUnsafe<SessionRow[]>(
    `SELECT * FROM "RadarAdSession" WHERE "status" IN ('pending','running') ORDER BY "requestedAt" LIMIT 1`,
  );
  if (open[0]) return toSession(open[0]);
  const now = new Date().toISOString();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "RadarAdSession" ("id","status","requestedAt") VALUES (?,'pending',?)`,
    now,
    now,
  );
  return { id: now, status: "pending", requestedAt: now, startedAt: null, doneAt: null, stats: {} };
}
