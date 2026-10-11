import { prisma } from "./prisma";

/**
 * Demande TikTok : les vidéos de tenues, hors pub, dont les commentaires
 * demandent d'où vient la pièce (« elle vient d'où la robe ? », « la ref
 * svp »). Là où la veille des pubs montre ce que les boutiques poussent, ce
 * relevé montre ce que les clientes réclament sans qu'on le leur vende.
 *
 * Comme la veille, il se fait depuis une session Claude avec Chrome connecté
 * au compte (voir scripts/radar-demand.mjs). La page relit simplement la table.
 */

/** Un commentaire cité, avec ses likes. */
export type DemandQuote = { t: string; l: number };

/** Le relevé d'un jour, pour voir la demande monter ou retomber. */
export type DemandPoint = {
  day: string;
  asks: number;
  comments: number | null;
  plays: number | null;
};

export type DemandVideo = {
  id: string;
  videoUrl: string;
  /** Compte TikTok de la créatrice, avec son @. */
  creator: string;
  caption: string | null;
  /** "AAAA-MM-JJ" : mise en ligne de la vidéo, lue dans son identifiant. */
  postedAt: string | null;
  plays: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  /** Commentaires réellement lus : TikTok n'en sert qu'une partie. */
  sampled: number;
  /** Parmi eux, ceux qui demandent la provenance. */
  asks: number;
  /** Likes cumulés de ces demandes : une question likée vaut plusieurs voix. */
  askLikes: number;
  /** L'envie sans question (« il me la faut »), comptée à part. */
  wants: number;
  /** La pièce la plus réclamée, ex. « robe ». */
  kind: string | null;
  /** Légende ou son de danse / de tendance. Déduit du texte, pas de l'image. */
  dance: boolean;
  quotes: DemandQuote[];
  /** Ce que la créatrice a répondu elle-même en commentaire, s'il y en a. */
  creatorNote: string | null;
  /** La recherche qui a fait trouver la vidéo. */
  source: string | null;
  image: string | null;
  firstSeen: string;
  lastSeen: string;
  history: DemandPoint[];
  /** Part des commentaires lus qui sont des demandes, de 0 à 1. */
  share: number;
};

type DemandRow = {
  id: string;
  videoUrl: string;
  creator: string;
  caption: string | null;
  postedAt: string | null;
  plays: number | bigint | null;
  likes: number | bigint | null;
  comments: number | bigint | null;
  saves: number | bigint | null;
  sampled: number | bigint;
  asks: number | bigint;
  askLikes: number | bigint;
  wants: number | bigint;
  kind: string | null;
  dance: number | bigint;
  quotes: string;
  creatorNote: string | null;
  source: string | null;
  image: string | null;
  firstSeen: string;
  lastSeen: string;
  history: string;
};

/* Table créée à la volée, comme RadarAd : rien à installer sur Turso. Le
   script de la session Claude crée la même. */
let ready: Promise<unknown> | null = null;
function ensureTable() {
  ready ??= prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "RadarDemand" (
       "id" TEXT PRIMARY KEY,
       "videoUrl" TEXT NOT NULL,
       "creator" TEXT NOT NULL,
       "caption" TEXT,
       "postedAt" TEXT,
       "plays" INTEGER,
       "likes" INTEGER,
       "comments" INTEGER,
       "saves" INTEGER,
       "sampled" INTEGER NOT NULL,
       "asks" INTEGER NOT NULL,
       "askLikes" INTEGER NOT NULL,
       "wants" INTEGER NOT NULL,
       "kind" TEXT,
       "dance" INTEGER NOT NULL,
       "quotes" TEXT NOT NULL,
       "creatorNote" TEXT,
       "source" TEXT,
       "image" TEXT,
       "firstSeen" TEXT NOT NULL,
       "lastSeen" TEXT NOT NULL,
       "history" TEXT NOT NULL
     )`,
  );
  return ready;
}

function parseList<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

const num = (v: number | bigint | null) => (v == null ? null : Number(v));

/** Met les lignes en forme et les classe : le plus de demandes d'abord, les
 *  likes de ces demandes pour départager. Exporté pour être testé seul. */
export function rankDemand(rows: DemandRow[]): DemandVideo[] {
  return rows
    .map((r) => {
      const sampled = Number(r.sampled);
      const asks = Number(r.asks);
      return {
        id: r.id,
        videoUrl: r.videoUrl,
        creator: r.creator,
        caption: r.caption,
        postedAt: r.postedAt,
        plays: num(r.plays),
        likes: num(r.likes),
        comments: num(r.comments),
        saves: num(r.saves),
        sampled,
        asks,
        askLikes: Number(r.askLikes),
        wants: Number(r.wants),
        kind: r.kind,
        dance: Number(r.dance) === 1,
        quotes: parseList<DemandQuote>(r.quotes),
        creatorNote: r.creatorNote,
        source: r.source,
        image: r.image,
        firstSeen: r.firstSeen,
        lastSeen: r.lastSeen,
        history: parseList<DemandPoint>(r.history),
        share: sampled > 0 ? asks / sampled : 0,
      };
    })
    .sort(
      (a, b) =>
        b.asks - a.asks || b.askLikes - a.askLikes || b.lastSeen.localeCompare(a.lastSeen),
    );
}

/** Les vidéos les plus demandées. Chaque ligne porte sa vignette : on borne
 *  la liste pour que la page reste légère quand les relevés s'accumulent.
 *  Ne lève pas : une base injoignable ne doit pas casser la page. */
export async function loadDemand(limit = 40): Promise<DemandVideo[]> {
  try {
    await ensureTable();
    const rows = await prisma.$queryRawUnsafe<DemandRow[]>(
      `SELECT * FROM "RadarDemand" ORDER BY "asks" DESC, "askLikes" DESC LIMIT ?`,
      limit,
    );
    return rankDemand(rows);
  } catch {
    return [];
  }
}
