/**
 * Côté session Claude : mener une veille des pubs TikTok demandée depuis
 * /radar (bouton « Lancer une veille TikTok ») et déposer ce qu'elle trouve.
 *
 *   node --env-file=.env scripts/radar-ads.mjs pending
 *   node --env-file=.env scripts/radar-ads.mjs start
 *   node --env-file=.env scripts/radar-ads.mjs add pub.json
 *   node --env-file=.env scripts/radar-ads.mjs done <id> bilan.json
 *
 * `pending` liste les demandes en attente. `start` prend la plus ancienne (ou
 * en ouvre une si la veille est lancée depuis la conversation) et affiche son
 * identifiant. `add` dépose une pub, ou un tableau de pubs — à faire au fil de
 * l'eau, pour ne rien perdre si la session s'interrompt :
 *   { "videoUrl": "https://www.tiktok.com/@compte/video/123…",
 *     "advertiser": "@compte", "caption": "…", "likes": 1234, "cta": "Acheter",
 *     "landingUrl": "https://boutique.com/products/robe-x",
 *     "productTitle": "Robe X", "price": "39.95", "image": "https://…",
 *     "kind": "robe", "note": null }
 * Une pub déjà connue n'est pas dupliquée : sa date de dernière vue, ses jours
 * d'apparition et son compteur sont mis à jour. C'est ce qui permet à la page
 * de dire qu'un produit tourne depuis plusieurs jours.
 * `done` solde la session : { "minutes", "videos", "ads", "kept", "carts", "note" }.
 *
 * Méthode, avec Chrome connecté au compte TikTok de l'utilisateur, pendant
 * SESSION_MINUTES (30 min, voir lib/radar-ads.ts) :
 *   1. ouvrir https://www.tiktok.com/foryou dans un nouvel onglet. Le fil ne
 *      se charge et ne défile que si cet onglet est l'onglet actif d'une
 *      fenêtre Chrome qui n'est pas entièrement recouverte par une autre
 *      (sinon `document.visibilityState` vaut "hidden" et rien ne bouge) ;
 *   2. avancer vidéo par vidéo en cliquant `[data-e2e="feed-navigation-next"]`
 *      depuis la page, une fois toutes les 1,5 s environ : des appuis clavier
 *      en rafale sont fusionnés et n'avancent presque pas ;
 *   3. une pub se reconnaît à son `[data-e2e="ad-tag"]` (mention « Publicité »)
 *      et à son bouton `[data-e2e="ttam-ads-cta"]` (« Visiter la boutique »,
 *      « Acheter »…), un lien qui mène hors de TikTok — l'équivalent, sur le
 *      web, du balayage vers la gauche de l'application. La mention
 *      « publicité » écrite par une créatrice dans sa légende, ou l'étiquette
 *      `sponsored-tag` d'un partenariat, n'en sont pas. Le même `<article>`
 *      donne le compte (`a[href^="/@"]`), la légende (`video-desc`), les
 *      likes (`like-count`) et l'identifiant de la vidéo, dans l'attribut
 *      `id="xgwrapper-0-<identifiant>"` : d'où
 *      https://www.tiktok.com/@compte/video/<identifiant> ;
 *   4. suivre ce bouton par un vrai clic (un `click()` lancé par script
 *      n'ouvre pas l'onglet). Ne retenir la pub que si la page est une
 *      boutique en ligne qui vend un vêtement pour femme ; ignorer les
 *      applications, les marques hors mode, les places de marché ;
 *   5. relever sur la fiche le titre, le prix et l'image du produit, puis la
 *      déposer avec `add`. Si la pub mène à l'accueil de la boutique plutôt
 *      qu'à une fiche, y retrouver le produit montré dans la vidéo ; à défaut,
 *      déposer la boutique et le dire dans `note` ;
 *   6. sur la fiche, choisir une taille et ajouter au panier, puis fermer
 *      l'onglet aussitôt : le signal d'intention fait remonter ce type de pubs
 *      dans le fil. Ne jamais aller au paiement ni saisir d'information ;
 *   7. revenir au fil et continuer. Laisser tourner quelques secondes les pubs
 *      de mode retenues, passer vite le reste.
 * Repère du 11/10/2026 : une pub pour sept vidéos sur un court essai. Les
 * étapes 5 et 6 n'ont pas encore été déroulées en conditions réelles.
 *
 * Sans TURSO_DATABASE_URL, le script vise la base locale prisma/dev.db.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:./prisma/dev.db",
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

await db.execute(`CREATE TABLE IF NOT EXISTS "RadarAd" (
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
)`);
await db.execute(`CREATE TABLE IF NOT EXISTS "RadarAdSession" (
  "id" TEXT PRIMARY KEY,
  "status" TEXT NOT NULL,
  "requestedAt" TEXT NOT NULL,
  "startedAt" TEXT,
  "doneAt" TEXT,
  "payload" TEXT
)`);

/** Le jour, vu de Paris : une veille de 23h50 ne doit pas compter pour demain. */
const parisDay = (d) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

/** L'identifiant d'une vidéo TikTok porte sa date de mise en ligne dans ses
 *  32 bits de poids fort. Rend "AAAA-MM-JJ", ou null si ce n'en est pas un. */
function postedAt(id) {
  if (!/^\d{17,20}$/.test(id)) return null;
  const seconds = Number(BigInt(id) >> 32n);
  const d = new Date(seconds * 1000);
  return d.getFullYear() >= 2018 && d.getTime() <= Date.now() + 86_400_000
    ? parisDay(d)
    : null;
}

/** Deux pubs qui mènent à la même fiche — paramètres de suivi différents,
 *  variante différente — parlent du même produit. */
function productKey(landingUrl) {
  const u = new URL(landingUrl);
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const path = u.pathname.replace(/\/+$/, "").toLowerCase();
  const handle = path.match(/\/products\/([^/]+)/);
  return handle ? `${host}/products/${handle[1]}` : `${host}${path}`;
}

/** L'adresse de la fiche, sans les paramètres de suivi de la pub. */
function cleanUrl(landingUrl) {
  const u = new URL(landingUrl);
  return `${u.origin}${u.pathname}`;
}

const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

const [cmd, a, b] = process.argv.slice(2);

if (cmd === "pending") {
  const { rows } = await db.execute(
    `SELECT "id","status","requestedAt" FROM "RadarAdSession" WHERE "status" IN ('pending','running') ORDER BY "requestedAt"`,
  );
  if (rows.length === 0) console.log("Aucune veille en attente.");
  for (const r of rows) console.log(`${r.requestedAt.slice(0, 16)}  ${r.status}  ${r.id}`);
} else if (cmd === "start") {
  const now = new Date().toISOString();
  const { rows } = await db.execute(
    `SELECT "id" FROM "RadarAdSession" WHERE "status" IN ('pending','running') ORDER BY "requestedAt" LIMIT 1`,
  );
  let id = rows[0]?.id;
  if (id) {
    await db.execute({
      sql: `UPDATE "RadarAdSession" SET "status"='running', "startedAt"=? WHERE "id"=?`,
      args: [now, id],
    });
  } else {
    id = now;
    await db.execute({
      sql: `INSERT INTO "RadarAdSession" ("id","status","requestedAt","startedAt") VALUES (?,'running',?,?)`,
      args: [id, now, now],
    });
  }
  console.log(id);
} else if (cmd === "add" && a) {
  const parsed = JSON.parse(readFileSync(a, "utf8"));
  const now = new Date();
  const today = parisDay(now);
  for (const ad of Array.isArray(parsed) ? parsed : [parsed]) {
    for (const k of ["videoUrl", "advertiser", "landingUrl", "productTitle"]) {
      if (typeof ad[k] !== "string" || !ad[k].trim()) throw new Error(`champ manquant : ${k}`);
    }
    const id = ad.videoUrl.match(/\/video\/(\d+)/)?.[1] ?? ad.videoUrl.split("?")[0];
    const known = (
      await db.execute({ sql: `SELECT "days","seen" FROM "RadarAd" WHERE "id"=?`, args: [id] })
    ).rows[0];
    const days = [...new Set([...(known ? JSON.parse(known.days) : []), today])].sort();
    const likes = Number.isFinite(ad.likes) ? Math.round(ad.likes) : null;
    await db.execute({
      sql: `INSERT INTO "RadarAd" ("id","videoUrl","advertiser","caption","likes","cta","landingUrl","domain","productKey","productTitle","price","image","kind","postedAt","firstSeen","lastSeen","days","seen","note")
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)
            ON CONFLICT("id") DO UPDATE SET
              "lastSeen"=excluded."lastSeen", "days"=excluded."days", "seen"="RadarAd"."seen"+1,
              "likes"=COALESCE(excluded."likes","RadarAd"."likes"),
              "price"=COALESCE(excluded."price","RadarAd"."price"),
              "image"=COALESCE(excluded."image","RadarAd"."image"),
              "note"=COALESCE(excluded."note","RadarAd"."note")`,
      args: [
        id,
        ad.videoUrl.split("?")[0],
        ad.advertiser.trim().slice(0, 100),
        text(ad.caption, 500),
        likes,
        text(ad.cta, 60),
        cleanUrl(ad.landingUrl),
        new URL(ad.landingUrl).hostname.replace(/^www\./, "").toLowerCase(),
        productKey(ad.landingUrl),
        ad.productTitle.trim().slice(0, 200),
        text(ad.price == null ? null : String(ad.price), 30),
        text(ad.image, 1000),
        text(ad.kind, 40),
        postedAt(id),
        now.toISOString(),
        now.toISOString(),
        JSON.stringify(days),
        text(ad.note, 300),
      ],
    });
    console.log(
      known
        ? `Revue (${Number(known.seen) + 1}e fois, ${days.length} jour(s)) : ${ad.productTitle}`
        : `Nouvelle pub : ${ad.productTitle} — ${productKey(ad.landingUrl)}`,
    );
  }
} else if (cmd === "done" && a && b) {
  const s = JSON.parse(readFileSync(b, "utf8"));
  const num = (v) => (Number.isFinite(v) ? v : undefined);
  const payload = {
    minutes: num(s.minutes),
    videos: num(s.videos),
    ads: num(s.ads),
    kept: num(s.kept),
    carts: num(s.carts),
    note: text(s.note, 500),
  };
  const { rowsAffected } = await db.execute({
    sql: `UPDATE "RadarAdSession" SET "status"='done', "doneAt"=?, "payload"=? WHERE "id"=?`,
    args: [new Date().toISOString(), JSON.stringify(payload), a],
  });
  if (rowsAffected === 0) throw new Error(`aucune session ${a}`);
  console.log(`Session soldée : ${payload.kept ?? 0} pub(s) retenue(s) sur ${payload.ads ?? "?"} vue(s).`);
} else {
  console.log("usage : radar-ads.mjs pending | start | add <pub.json> | done <id> <bilan.json>");
  process.exitCode = 1;
}
