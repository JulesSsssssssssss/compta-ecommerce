/**
 * Côté session Claude : lire et solder les recherches approfondies demandées
 * depuis /radar (bouton « Recherche approfondie »).
 *
 *   node --env-file=.env scripts/radar-creas.mjs pending
 *   node --env-file=.env scripts/radar-creas.mjs save resultat.json
 *
 * `pending` liste les demandes en attente. `save` dépose un résultat :
 *   { "url": "<fiche produit, telle que listée par pending>",
 *     "note": "ce que la recherche n'a pas pu établir, ou null",
 *     "picks": [ { "url", "creator", "likes", "views", "date", "label", "why" } ] }
 *
 * Méthode pour remplir `picks` (5 vidéos au plus), avec Chrome connecté à
 * TikTok :
 *   1. vidéos de la fiche produit, puis de la boutique d'origine si la fiche
 *      a repris ses photos ailleurs ;
 *   2. compte TikTok de la boutique : vues par vidéo du produit ;
 *   3. recherche TikTok « marque + produit » : vidéos des créatrices sur leurs
 *      propres comptes, mention « Collaboration commerciale » ;
 *   4. à défaut, vidéos du même type de produit qui ont le mieux marché.
 * Retenir sur l'audience, la fraîcheur et ce qui est reproductible (accroche,
 * format). `label` dit en quelques mots ce qu'est la vidéo pour ce produit —
 * « Créa confirmée de la boutique », « Pub de la marque d'origine », « Vidéo
 * proche » : la page l'affiche à côté des chiffres. `why` détaille quoi en
 * reprendre.
 *
 * Sans TURSO_DATABASE_URL, le script vise la base locale prisma/dev.db.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:./prisma/dev.db",
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

await db.execute(`CREATE TABLE IF NOT EXISTS "RadarCreaSearch" (
  "url" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestedAt" TEXT NOT NULL,
  "doneAt" TEXT,
  "payload" TEXT
)`);

const [cmd, file] = process.argv.slice(2);

if (cmd === "pending") {
  const { rows } = await db.execute(
    `SELECT "url","title","domain","requestedAt" FROM "RadarCreaSearch" WHERE "status" = 'pending' ORDER BY "requestedAt"`,
  );
  if (rows.length === 0) console.log("Aucune recherche en attente.");
  for (const r of rows) {
    console.log(`${r.requestedAt.slice(0, 16)}  ${r.domain}  ${r.title}\n  ${r.url}`);
  }
} else if (cmd === "save" && file) {
  const res = JSON.parse(readFileSync(file, "utf8"));
  if (typeof res.url !== "string" || !Array.isArray(res.picks)) {
    throw new Error("résultat attendu : { url, note, picks: [...] }");
  }
  const picks = res.picks.slice(0, 5).map((p) => {
    if (typeof p.url !== "string" || typeof p.creator !== "string" || typeof p.why !== "string") {
      throw new Error("chaque vidéo doit avoir url, creator et why");
    }
    return {
      url: p.url,
      creator: p.creator,
      likes: Number.isFinite(p.likes) ? p.likes : null,
      views: Number.isFinite(p.views) ? p.views : null,
      date: typeof p.date === "string" ? p.date : null,
      label: typeof p.label === "string" && p.label.trim() ? p.label.trim().slice(0, 80) : null,
      why: p.why,
    };
  });
  const { rowsAffected } = await db.execute({
    sql: `UPDATE "RadarCreaSearch" SET "status"='done', "doneAt"=?, "payload"=? WHERE "url"=?`,
    args: [new Date().toISOString(), JSON.stringify({ picks, note: res.note ?? null }), res.url],
  });
  if (rowsAffected === 0) throw new Error(`aucune demande pour ${res.url}`);
  console.log(`Enregistré : ${picks.length} vidéo(s) pour ${res.url}`);
} else {
  console.log("usage : radar-creas.mjs pending | save <resultat.json>");
  process.exitCode = 1;
}
