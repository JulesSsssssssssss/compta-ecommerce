/**
 * Côté session Claude : relever la « demande » sur TikTok — les vidéos de
 * tenues, hors pub, dont les commentaires demandent d'où vient la pièce — et
 * déposer ce relevé pour la page /radar/tiktok.
 *
 *   node --env-file=.env scripts/radar-demand.mjs receive
 *   node --env-file=.env scripts/radar-demand.mjs save releve.json
 *   node --env-file=.env scripts/radar-demand.mjs list
 *
 * Méthode, avec Chrome connecté au compte TikTok de l'utilisateur :
 *   1. dans un onglet tiktok.com, exécuter scripts/radar-demand-page.js avec
 *      l'outil JavaScript, puis `window.__demand.run([...mots-clés])`. Il
 *      cherche des vidéos de tenues, garde celles de moins de deux mois qui
 *      ont assez de commentaires, et lit jusqu'à 150 commentaires de chacune.
 *      À la différence du défilement du fil (radar-ads.mjs), l'onglet n'a pas
 *      besoin d'être visible : cela tourne pendant que l'utilisateur travaille ;
 *   2. suivre `window.__demand.state` jusqu'à la phase "fini" ;
 *   3. lancer `receive` ici, puis `window.__demand.send()` dans l'onglet : le
 *      relevé arrive par un formulaire envoyé à 127.0.0.1 et il est déposé
 *      aussitôt. C'est la seule sortie que la page autorise (elle bloque les
 *      requêtes et les cadres vers une autre adresse), et l'onglet quitte
 *      TikTok au passage : y revenir ensuite. `save` dépose un relevé déjà
 *      écrit dans un fichier ;
 *   4. la vignette de chaque vidéo est prise ici, par le service d'intégration
 *      public de TikTok, et réduite : les adresses d'images de TikTok expirent
 *      en quelques heures, on garde donc l'image.
 *
 * Une demande, c'est un commentaire qui pose la question (« elle vient d'où
 * la robe ? », « la ref svp », « le haut ?? ») ; `wants` compte à part l'envie
 * sans question (« il me la faut »). Le relevé ne voit pas la vidéo : que la
 * personne danse se déduit de la légende et du son, pas de l'image.
 *
 * Une vidéo déjà relevée n'est pas dupliquée : ses chiffres sont mis à jour et
 * le relevé du jour s'ajoute à son historique, ce qui montre si la demande
 * monte d'un jour sur l'autre.
 *
 * Sans TURSO_DATABASE_URL, le script vise la base locale prisma/dev.db.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:./prisma/dev.db",
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

await db.execute(`CREATE TABLE IF NOT EXISTS "RadarDemand" (
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
)`);

/** Le jour, vu de Paris. */
const parisDay = (d) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

/** L'identifiant d'une vidéo TikTok porte sa date de mise en ligne dans ses
 *  32 bits de poids fort. Rend "AAAA-MM-JJ", ou null si ce n'en est pas un. */
function postedAt(id) {
  if (!/^\d{17,20}$/.test(id)) return null;
  const d = new Date(Number(BigInt(id) >> 32n) * 1000);
  return d.getFullYear() >= 2018 && d.getTime() <= Date.now() + 86_400_000 ? parisDay(d) : null;
}

const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const int = (v) => (Number.isFinite(v) ? Math.round(v) : null);

/** La vignette de la vidéo, réduite et rangée telle quelle dans la base.
 *  Rend null si TikTok ne la donne pas : la carte s'affiche alors sans image. */
async function thumbnail(videoUrl) {
  try {
    const headers = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" };
    const meta = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`, {
      headers,
    });
    const { thumbnail_url: src } = await meta.json();
    if (!src) return null;
    const img = await fetch(src, { headers });
    if (!img.ok) return null;
    const { default: sharp } = await import("sharp");
    const small = await sharp(Buffer.from(await img.arrayBuffer()))
      .resize({ width: 200 })
      .jpeg({ quality: 55 })
      .toBuffer();
    return `data:image/jpeg;base64,${small.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Port d'écoute de `receive`, le même que `send()` dans la page. */
const PORT = 47831;

async function save(parsed) {
  const now = new Date();
  const today = parisDay(now);
  for (const v of Array.isArray(parsed) ? parsed : [parsed]) {
    for (const k of ["videoUrl", "creator"]) {
      if (typeof v[k] !== "string" || !v[k].trim()) throw new Error(`champ manquant : ${k}`);
    }
    const videoUrl = v.videoUrl.split("?")[0];
    const id = videoUrl.match(/\/video\/(\d+)/)?.[1] ?? videoUrl;
    const known = (
      await db.execute({ sql: `SELECT "history","image" FROM "RadarDemand" WHERE "id"=?`, args: [id] })
    ).rows[0];
    const asks = int(v.asks) ?? 0;
    const point = { day: today, asks, comments: int(v.comments), plays: int(v.plays) };
    // Un seul point par jour : relever deux fois dans la journée remplace.
    const history = [
      ...(known ? JSON.parse(known.history) : []).filter((h) => h.day !== today),
      point,
    ];
    const quotes = (Array.isArray(v.quotes) ? v.quotes : [])
      .filter((q) => q && typeof q.t === "string" && q.t.trim())
      .slice(0, 5)
      .map((q) => ({ t: q.t.trim().slice(0, 140), l: int(q.l) ?? 0 }));
    const image = known?.image ?? (await thumbnail(videoUrl));
    await db.execute({
      sql: `INSERT INTO "RadarDemand" ("id","videoUrl","creator","caption","postedAt","plays","likes","comments","saves","sampled","asks","askLikes","wants","kind","dance","quotes","creatorNote","source","image","firstSeen","lastSeen","history")
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT("id") DO UPDATE SET
              "plays"=excluded."plays", "likes"=excluded."likes", "comments"=excluded."comments",
              "saves"=excluded."saves", "sampled"=excluded."sampled", "asks"=excluded."asks",
              "askLikes"=excluded."askLikes", "wants"=excluded."wants",
              "kind"=COALESCE(excluded."kind","RadarDemand"."kind"),
              "quotes"=excluded."quotes",
              "creatorNote"=COALESCE(excluded."creatorNote","RadarDemand"."creatorNote"),
              "image"=COALESCE("RadarDemand"."image",excluded."image"),
              "lastSeen"=excluded."lastSeen", "history"=excluded."history"`,
      args: [
        id,
        videoUrl,
        v.creator.trim().slice(0, 100),
        text(v.caption, 500),
        postedAt(id),
        int(v.plays),
        int(v.likes),
        int(v.comments),
        int(v.saves),
        int(v.sampled) ?? 0,
        asks,
        int(v.askLikes) ?? 0,
        int(v.wants) ?? 0,
        text(v.kind, 40),
        v.dance ? 1 : 0,
        JSON.stringify(quotes),
        text(v.creatorNote, 300),
        text(v.source, 80),
        image,
        now.toISOString(),
        now.toISOString(),
        JSON.stringify(history),
      ],
    });
    console.log(
      `${known ? "Mise à jour" : "Nouvelle"} : ${v.creator} — ${asks} demande(s) sur ${int(v.sampled) ?? 0} commentaires lus${image ? "" : " (sans vignette)"}`,
    );
  }
}

const [cmd, a] = process.argv.slice(2);

if (cmd === "save" && a) {
  await save(JSON.parse(readFileSync(a, "utf8")));
} else if (cmd === "receive") {
  // Un seul envoi attendu, puis on s'arrête : rien ne reste à l'écoute.
  const server = createServer((req, res) => {
    if (req.method !== "POST") return res.end();
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        await save(JSON.parse(new URLSearchParams(body).get("d") ?? "[]"));
        res.end("Relevé déposé.");
      } catch (e) {
        res.statusCode = 400;
        res.end(String(e));
        process.exitCode = 1;
      }
      server.close();
    });
  });
  server.listen(PORT, "127.0.0.1", () => console.log(`En attente du relevé sur 127.0.0.1:${PORT}…`));
} else if (cmd === "list") {
  const { rows } = await db.execute(
    `SELECT "creator","kind","asks","sampled","comments","plays","lastSeen" FROM "RadarDemand" ORDER BY "asks" DESC`,
  );
  if (rows.length === 0) console.log("Aucune demande relevée.");
  for (const r of rows) {
    console.log(
      `${String(r.asks).padStart(3)} demandes / ${r.sampled} lus · ${r.comments} com. · ${r.plays} vues · ${r.kind ?? "?"} · ${r.creator} · ${r.lastSeen.slice(0, 10)}`,
    );
  }
} else {
  console.log("usage : radar-demand.mjs receive | save <releve.json> | list");
  process.exitCode = 1;
}
