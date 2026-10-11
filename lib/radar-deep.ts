import { prisma } from "./prisma";

/**
 * Recherche approfondie des créas d'un produit.
 *
 * Elle ne peut pas tourner depuis le serveur : TikTok ne livre ses résultats
 * qu'à un navigateur connecté. Le bouton de la page enregistre donc une
 * demande ; une session Claude, avec Chrome, la traite et dépose ici le Top 5
 * (voir scripts/radar-creas.mjs). La page relit simplement cette table.
 */

/** Une vidéo retenue par la recherche. */
export type DeepPick = {
  url: string;
  /** Compte TikTok, avec son @. */
  creator: string;
  likes: number | null;
  views: number | null;
  /** "AAAA-MM-JJ" */
  date: string | null;
  /** Pourquoi elle est retenue, et quoi en reprendre. */
  why: string;
};

export type Deep = {
  status: "pending" | "done";
  requestedAt: string;
  doneAt: string | null;
  picks: DeepPick[];
  /** Ce que la recherche n'a pas pu établir. */
  note: string | null;
};

type DeepRow = {
  status: string;
  requestedAt: string;
  doneAt: string | null;
  payload: string | null;
};

/* Table créée à la volée, comme AvonttiScan : rien à installer sur Turso. */
let ready: Promise<unknown> | null = null;
function ensureTable() {
  ready ??= prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "RadarCreaSearch" (
       "url" TEXT PRIMARY KEY,
       "title" TEXT NOT NULL,
       "domain" TEXT NOT NULL,
       "status" TEXT NOT NULL,
       "requestedAt" TEXT NOT NULL,
       "doneAt" TEXT,
       "payload" TEXT
     )`,
  );
  return ready;
}

function toDeep(r: DeepRow): Deep {
  let picks: DeepPick[] = [];
  let note: string | null = null;
  try {
    const p = JSON.parse(r.payload ?? "{}") as { picks?: DeepPick[]; note?: string };
    picks = Array.isArray(p.picks) ? p.picks : [];
    note = p.note ?? null;
  } catch {
    // Résultat illisible : on affiche la demande sans son contenu.
  }
  return {
    status: r.status === "done" ? "done" : "pending",
    requestedAt: r.requestedAt,
    doneAt: r.doneAt,
    picks,
    note,
  };
}

/** L'état de la recherche pour ce produit, ou null si elle n'a jamais été
 *  demandée. Ne lève pas : une base injoignable ne doit pas casser la page. */
export async function loadDeep(url: string): Promise<Deep | null> {
  try {
    await ensureTable();
    const rows = await prisma.$queryRawUnsafe<DeepRow[]>(
      `SELECT "status","requestedAt","doneAt","payload" FROM "RadarCreaSearch" WHERE "url" = ? LIMIT 1`,
      url,
    );
    return rows[0] ? toDeep(rows[0]) : null;
  } catch {
    return null;
  }
}

/** Enregistre (ou relance) la demande. Un résultat déjà obtenu reste affiché
 *  jusqu'à ce que le nouveau le remplace. */
export async function requestDeep(
  url: string,
  title: string,
  domain: string,
): Promise<Deep> {
  await ensureTable();
  const now = new Date().toISOString();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "RadarCreaSearch" ("url","title","domain","status","requestedAt") VALUES (?,?,?,'pending',?)
     ON CONFLICT("url") DO UPDATE SET "status"='pending', "requestedAt"=excluded."requestedAt", "title"=excluded."title"`,
    url,
    title,
    domain,
    now,
  );
  return (await loadDeep(url)) ?? {
    status: "pending",
    requestedAt: now,
    doneAt: null,
    picks: [],
    note: null,
  };
}
