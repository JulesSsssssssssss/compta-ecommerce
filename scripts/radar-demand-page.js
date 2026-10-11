/**
 * Collecteur de la « demande » TikTok : à exécuter dans un onglet tiktok.com
 * connecté au compte de l'utilisateur (outil JavaScript de Chrome), pas avec
 * Node. Voir scripts/radar-demand.mjs pour la méthode d'ensemble.
 *
 * Il cherche des vidéos de tenues par mots-clés, lit les commentaires de
 * chacune et compte ceux qui demandent d'où vient la pièce. Tout passe par les
 * requêtes que la page fait elle-même (`/api/search/general/full/`,
 * `/api/comment/list/`) : l'onglet n'a donc pas besoin d'être visible, à la
 * différence du défilement du fil.
 *
 *   window.__demand.run(["tenue automne femme", "robe soirée", …])   // lance
 *   window.__demand.state                                            // avancement
 *   window.__demand.top(25)                                          // résultat
 *   window.__demand.send()        // l'envoie à `radar-demand.mjs receive`
 *
 * Aucune pause par minuterie entre deux requêtes : Chrome ralentit les
 * minuteries d'un onglet masqué jusqu'à une par minute. Les requêtes
 * s'enchaînent une à une, ce qui suffit à rester loin d'un débit de robot.
 */
(() => {
  /** Vidéos plus anciennes : la demande est retombée, ou déjà servie. */
  const MAX_AGE_DAYS = 60;
  /** En dessous, trop peu de commentaires pour y lire quoi que ce soit. */
  const MIN_COMMENTS = 15;
  /** Pages de commentaires lues par vidéo (une cinquantaine chacune). */
  const COMMENT_PAGES = 3;

  const GARMENTS = {
    robe: /\b(robes?|dress(es)?|vestidos?)\b/i,
    jupe: /\b(jupes?|skirts?|skorts?|faldas?)\b/i,
    haut: /\b(hauts?|tops?|t-?shirts?|tee|blouses?|chemisiers?|chemises?|bodys?|bodies|corsets?|bustiers?|d[ée]bardeurs?|shirts?)\b/i,
    pantalon: /\b(pantalons?|jeans?|pants|trousers|leggings?|cargos?|shorts?|pantal[oó]n(es)?)\b/i,
    veste: /\b(vestes?|blazers?|manteaux?|trenchs?|doudounes?|blousons?|jackets?|coats?|perfectos?|chaquetas?)\b/i,
    maille: /\b(pulls?|gilets?|cardigans?|sweats?|sweaters?|hoodies?|jumpers?|knits?|tricots?)\b/i,
    ensemble: /\b(ensembles?|combinaisons?|combis?|co-?ords?|sets?|jumpsuits?|tenues?|outfits?|fits?|looks?|conjuntos?)\b/i,
    chaussures: /\b(chaussures?|bottes?|bottines?|baskets?|talons?|sandales?|boots?|shoes?|heels?|sneakers?|zapatos?)\b/i,
    sac: /\b(sacs?|bags?|bolsos?)\b/i,
  };
  const ANY_GARMENT = new RegExp(
    Object.values(GARMENTS)
      .map((r) => r.source)
      .join("|"),
    "i",
  );

  /** « D'où ça vient » : la question elle-même, dans les langues du fil. */
  const SOURCE =
    /d['’ ]?o[uù] (vien|sort|provien|c['’ ]?est)|vien[st]? d['’ ]?o[uù]|o[uù] (tu |t['’ ]?)?(l['’ ]?)?(as|a|avez)[- ]?(tu |vous )?(achet|trouv|pris|command|eu)|(achet|trouv|pris|command)\w* o[uù]|o[uù] (acheter|trouver|commander|est[- ]ce qu)|dispo(nible)? o[uù]|(quelle|quoi|kel+e?) (est )?(la |cette )?marque|la marque|(nom|adresse) (du|de la|d['’ ]une?) (site|boutique|marque|shop)|(quel|kel) (est le )?(site|shop)|where\b.{0,40}\b(from|get|buy|bought|find|purchase)|what brand|which brand|(outfit|dress|fit|top) (details|deets|info)|\bdeets\b|de d[oó]nde|d[oó]nde (lo|la|las|los)? ?(compr|consig|es)|\bdove (l['’ ]?hai|si)\b/i;
  /** Mots qui ne valent une demande qu'avec une pièce nommée ou un « svp ». */
  const WEAK = /\b(liens?|links?|r[ée]fs?|r[ée]f[ée]rences?|site|shop|boutique|marque|brand|code promo)\b/i;
  const PLEASE = /\?|\b(svp|stp|sil (te|vous) pla[iî]t|s['’ ]il (te|vous) pla[iî]t|please|pls|plz|por favor|porfa)\b/i;
  /** L'envie, sans question : « il me la faut », « je veux la même ». */
  const WANT =
    /\b(il me (la|le|les) faut|je (la |le |les )?veux|j['’ ]?en (veux|ai besoin)|besoin de (cette?|ce|ces)|je veux (la|le|les) m[êe]mes?|i need (this|that|the)|need (this|that) \w+|obsessed with (the|this|that|your)|lo necesito|la quiero)\b/i;
  /** Questions qui portent sur autre chose que la tenue. */
  const OFF_TOPIC =
    /\b(musique|chanson|son|song|sound|audio|titre|filtre|filter|maquillage|make ?up|gloss|rouge [àa] l[èe]vres|cheveux|coiffure|perruque|hair|wig|parfum|perfume|ongles|nails|t[ée]l[ée]phone|coque|appli|app|restaurant|h[oô]tel|lieu|ville|endroit|d[ée]co|canap[ée])\b/i;

  /** 2 = demande de provenance, 1 = envie, 0 = rien. */
  function grade(text) {
    if (!text || OFF_TOPIC.test(text)) return 0;
    const garment = ANY_GARMENT.test(text);
    if (SOURCE.test(text)) return 2;
    if (WEAK.test(text) && (garment || PLEASE.test(text))) return 2;
    if (garment && PLEASE.test(text) && text.length <= 80) return 2;
    if (WANT.test(text) && (garment || text.length <= 40)) return 1;
    return 0;
  }

  /** La pièce la plus citée dans les demandes, sinon dans la légende. */
  function pieceOf(texts, caption) {
    const tally = {};
    for (const t of texts) {
      for (const [k, re] of Object.entries(GARMENTS)) if (re.test(t)) tally[k] = (tally[k] || 0) + 1;
    }
    // « tenue » est le mot par défaut : une pièce précise l'emporte à égalité.
    const best = Object.entries(tally).sort(
      (a, b) => b[1] - a[1] || (a[0] === "ensemble") - (b[0] === "ensemble"),
    )[0];
    if (best) return best[0];
    for (const [k, re] of Object.entries(GARMENTS)) if (k !== "ensemble" && re.test(caption)) return k;
    return null;
  }

  const query = (o) =>
    new URLSearchParams({
      aid: "1988",
      app_language: "fr",
      app_name: "tiktok_web",
      browser_language: "fr-FR",
      channel: "tiktok_web",
      device_platform: "web_pc",
      language: "fr",
      os: "mac",
      priority_region: "FR",
      region: "FR",
      store_region: "FR",
      tz_name: "Europe/Paris",
      webcast_language: "fr",
      ...o,
    }).toString();

  /** `lean` : n'envoyer que l'identifiant d'application. La liste des
   *  commentaires revient vide dès qu'on y ajoute les paramètres de région,
   *  alors que la recherche, sans eux, sert des vidéos d'autres pays. */
  async function get(path, o, lean = false) {
    const qs = lean ? new URLSearchParams({ aid: "1988", ...o }).toString() : query(o);
    const r = await fetch(`${path}?${qs}`, { credentials: "include" });
    const t = await r.text();
    try {
      return JSON.parse(t);
    } catch {
      // Réponse vide ou page de vérification : TikTok demande de ralentir.
      return { blocked: true, status: r.status };
    }
  }

  const state = { phase: "idle", keywords: 0, found: 0, kept: 0, read: 0, blocked: 0, error: null };
  const videos = new Map();

  async function search(keyword, pages) {
    let offset = 0;
    for (let p = 0; p < pages; p++) {
      const j = await get("/api/search/general/full/", {
        keyword,
        offset: String(offset),
        from_page: "search",
        search_source: "normal_search",
      });
      if (j.blocked) {
        state.blocked++;
        return;
      }
      for (const d of j.data || []) {
        const i = d.item;
        if (!i || !i.id || !i.author || videos.has(i.id)) continue;
        state.found++;
        const s = i.stats || {};
        videos.set(i.id, {
          id: i.id,
          creator: `@${i.author.uniqueId}`,
          caption: (i.desc || "").trim().slice(0, 300),
          createTime: i.createTime,
          plays: s.playCount ?? null,
          likes: s.diggCount ?? null,
          comments: s.commentCount ?? 0,
          shares: s.shareCount ?? null,
          saves: Number(s.collectCount) || null,
          music: i.music ? i.music.title : null,
          isAd: !!i.isAd,
          source: keyword,
        });
      }
      if (!j.has_more) return;
      offset = j.cursor ?? offset + 12;
    }
  }

  async function readComments(v) {
    const asks = [];
    const wants = [];
    const creator = [];
    let cursor = 0;
    let sampled = 0;
    for (let p = 0; p < COMMENT_PAGES; p++) {
      const j = await get(
        "/api/comment/list/",
        { aweme_id: v.id, count: "50", cursor: String(cursor) },
        true,
      );
      if (j.blocked) {
        state.blocked++;
        break;
      }
      for (const c of j.comments || []) {
        sampled++;
        const text = (c.text || "").trim();
        const row = { t: text.slice(0, 110), l: c.digg_count || 0 };
        if (c.user && `@${c.user.unique_id}` === v.creator) {
          if (text) creator.push(text.slice(0, 140));
          continue;
        }
        const g = grade(text);
        if (g === 2) asks.push(row);
        else if (g === 1) wants.push(row);
      }
      if (!j.has_more) break;
      cursor = j.cursor ?? cursor + 50;
    }
    const byLikes = (a, b) => b.l - a.l;
    v.sampled = sampled;
    v.asks = asks.length;
    v.askLikes = asks.reduce((n, a) => n + a.l, 0);
    v.wants = wants.length;
    v.quotes = [...asks.sort(byLikes).slice(0, 4), ...wants.sort(byLikes).slice(0, 1)];
    v.creatorNote = creator.slice(0, 2).join(" · ") || null;
    v.kind = pieceOf(asks.map((a) => a.t), v.caption);
    v.dance = /\b(danse|dance|dancing|choré|chor[ée]graphie|dc|trend|tiktokdance)\b/i.test(
      `${v.caption} ${v.music || ""}`,
    );
  }

  async function run(keywords, { pages = 2, max = 90 } = {}) {
    try {
      state.phase = "recherche";
      for (const k of keywords) {
        await search(k, pages);
        state.keywords++;
      }
      const oldest = Date.now() / 1000 - MAX_AGE_DAYS * 86400;
      const todo = [...videos.values()]
        .filter((v) => !v.isAd && v.sampled == null && v.createTime >= oldest && v.comments >= MIN_COMMENTS)
        .sort((a, b) => b.comments - a.comments)
        .slice(0, max);
      state.kept = todo.length;
      state.phase = "commentaires";
      for (const v of todo) {
        await readComments(v);
        state.read++;
      }
      state.phase = "fini";
    } catch (e) {
      state.error = String(e);
      state.phase = "erreur";
    }
    return state;
  }

  /** Les vidéos où la demande est la plus nette, prêtes pour `radar-demand.mjs save`. */
  function top(n = 25, minAsks = 3) {
    return [...videos.values()]
      .filter((v) => (v.asks || 0) >= minAsks)
      .sort((a, b) => b.asks - a.asks || b.askLikes - a.askLikes)
      .slice(0, n)
      .map((v) => ({
        videoUrl: `https://www.tiktok.com/${v.creator}/video/${v.id}`,
        creator: v.creator,
        caption: v.caption,
        plays: v.plays,
        likes: v.likes,
        comments: v.comments,
        saves: v.saves,
        sampled: v.sampled,
        asks: v.asks,
        askLikes: v.askLikes,
        wants: v.wants,
        kind: v.kind,
        dance: v.dance,
        quotes: v.quotes,
        creatorNote: v.creatorNote,
        source: v.source,
      }));
  }

  /** Envoie le résultat au script qui écoute sur la machine. La page
   *  n'autorise ni requête ni cadre vers une autre adresse : seul un
   *  formulaire passe, et il fait quitter TikTok à l'onglet. */
  function send(n = 25, minAsks = 3, port = 47831) {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = `http://127.0.0.1:${port}/`;
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "d";
    input.value = JSON.stringify(top(n, minAsks));
    form.appendChild(input);
    document.body.appendChild(form);
    // Après le retour de l'appel : sinon la navigation coupe la réponse de l'outil.
    setTimeout(() => form.submit(), 50);
  }

  window.__demand = { run, top, send, state, videos, grade };
})();
