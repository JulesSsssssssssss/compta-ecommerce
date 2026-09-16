/**
 * Collecteur Avontti, exécuté dans le navigateur, SUR avontti.com.
 *
 * Pourquoi dans le navigateur : le site est derrière un challenge Cloudflare
 * que seul un vrai navigateur franchit. Une fois sur le site, les fiches se
 * lisent en same-origin sans rien contourner.
 *
 * Ce qu'il fait :
 * 1. liste les fiches (pages collection + handles déjà connus de l'app) ;
 * 2. lit chaque fiche et retrouve, dans le JSON embarqué par SHOPLINE, la
 *    liste des variantes et leur quantité en stock ;
 * 3. renvoie le relevé à l'application, ouverte dans une fenêtre à part, par
 *    postMessage — ou le laisse à copier si la fenêtre n'a pas pu s'ouvrir.
 *
 * La lecture ne dépend pas d'un nom de champ précis : SHOPLINE nomme ses
 * champs différemment selon les versions de thème. On cherche le tableau
 * d'objets qui ressemble le plus à des variantes (une quantité numérique et un
 * identifiant), en préférant celui dont le produit porte le handle de la page.
 *
 * Écrit en chaîne plutôt qu'en fonction : le code part tel quel dans un
 * favori `javascript:`, il ne doit pas passer par la compilation de Next.
 */

const SOURCE = String.raw`(async function () {
  var APP = "__APP__";
  var KNOWN = __HANDLES__;
  var HOST = /(^|\.)avontti\.com$/;
  var box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:2147483647;top:16px;right:16px;width:320px;padding:14px 16px;border-radius:12px;background:#0f172a;color:#fff;font:13px/1.45 -apple-system,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35)";
  document.body.appendChild(box);
  function say(html) { box.innerHTML = "<b style='display:block;margin-bottom:4px'>Scan Avontti</b>" + html; }
  if (!HOST.test(location.hostname)) {
    say("Ouvre d'abord <b>avontti.com</b>, puis relance le scan depuis cet onglet.");
    setTimeout(function () { box.remove(); }, 8000);
    return;
  }
  // Ouverte tout de suite, pendant le clic : plus tard, le navigateur la bloquerait.
  var win = window.open(APP + "/radar/avontti?recevoir=1", "avontti-scan");

  var QTY = ["inventory_quantity", "inventoryQuantity", "available_quantity", "availableQuantity", "stock", "stockQuantity", "stock_quantity", "quantity", "qty", "inventory"];
  var IDS = ["sku", "skuSeq", "sku_seq", "skuId", "sku_id", "id", "title", "name", "option1", "options", "attributes"];
  var POL = /^(inventory_?policy|inventoryPolicy|oversold|allow_?oversold|allowOversold)$/i;
  var PUB = ["published_at", "publishedAt", "created_at", "createdAt"];
  var CAP = ["compare_at_price", "compareAtPrice", "origin_price", "originPrice", "market_price", "marketPrice"];

  function num(v) {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
    return null;
  }
  function qtyOf(o) {
    for (var i = 0; i < QTY.length; i++) if (o[QTY[i]] !== undefined) { var n = num(o[QTY[i]]); if (n !== null) return n; }
    return null;
  }
  function isVariant(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return false;
    if (qtyOf(o) === null) return false;
    for (var i = 0; i < IDS.length; i++) if (o[IDS[i]] !== undefined) return true;
    return false;
  }
  function label(o) {
    if (typeof o.title === "string" && o.title && !/^default/i.test(o.title)) return o.title;
    var opts = [o.option1, o.option2, o.option3].filter(function (x) { return typeof x === "string" && x; });
    if (opts.length) return opts.join("/");
    if (Array.isArray(o.options)) {
      var vs = o.options.map(function (x) { return typeof x === "string" ? x : x && (x.value || x.name); }).filter(Boolean);
      if (vs.length) return vs.join("/");
    }
    if (Array.isArray(o.attributes)) {
      var as = o.attributes.map(function (x) { return x && (x.value || x.attrValue || x.name); }).filter(Boolean);
      if (as.length) return as.join("/");
    }
    return String(o.name || o.sku || o.skuSeq || o.id || "?");
  }
  // Extrait les objets JSON littéraux d'un script : window.X = {...}, "k":{...}.
  function jsonIn(text) {
    var out = [], re = /[=:(]\s*(\{|\[)/g, m, guard = 0;
    while ((m = re.exec(text)) && guard++ < 400) {
      var start = m.index + m[0].length - 1, depth = 0, str = false, esc = false, end = -1;
      for (var i = start; i < text.length; i++) {
        var c = text[i];
        if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') str = false; continue; }
        if (c === '"') str = true;
        else if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end < 0) continue;
      var chunk = text.slice(start, end + 1);
      if (chunk.length < 40) continue;
      try { out.push(JSON.parse(chunk)); re.lastIndex = end + 1; } catch (e) {}
    }
    // JSON.parse("...") : certains thèmes embarquent l'état en chaîne échappée.
    var re2 = /JSON\.parse\(\s*("(?:[^"\\]|\\.)*")\s*\)/g;
    while ((m = re2.exec(text))) { try { out.push(JSON.parse(JSON.parse(m[1]))); } catch (e) {} }
    return out;
  }
  function pick(o, keys) { for (var i = 0; i < keys.length; i++) if (o && o[keys[i]] != null) return o[keys[i]]; return null; }
  function mentions(o, h) {
    for (var k in o) {
      var v = o[k];
      if (typeof v === "string" && (v === h || v.indexOf("/products/" + h) >= 0 || v.indexOf("/products/" + encodeURIComponent(h)) >= 0)) return true;
    }
    return false;
  }
  function findVariants(roots, h) {
    var best = null, seen = 0;
    function walk(node, owner, depth) {
      if (!node || typeof node !== "object" || depth > 14 || seen++ > 200000) return;
      if (Array.isArray(node)) {
        var hits = 0;
        for (var i = 0; i < node.length; i++) if (isVariant(node[i])) hits++;
        if (hits > 0 && hits >= node.length / 2) {
          var score = hits + (owner && mentions(owner, h) ? 1000 : 0);
          if (!best || score > best.score) best = { score: score, list: node.filter(isVariant), owner: owner };
        }
        for (var j = 0; j < node.length; j++) walk(node[j], owner, depth + 1);
        return;
      }
      for (var k in node) walk(node[k], node, depth + 1);
    }
    roots.forEach(function (r) { walk(r, null, 0); });
    return best;
  }
  function meta(doc, names) {
    for (var i = 0; i < names.length; i++) {
      var el = doc.querySelector('meta[property="' + names[i] + '"],meta[name="' + names[i] + '"]');
      if (el && el.content) return el.content;
    }
    return null;
  }
  async function get(url) {
    var r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  }
  var prefix = "/fr-fr";

  // 1. Les fiches à lire.
  var handles = new Set(KNOWN);
  var fromSite = 0;
  for (var page = 1; page <= 15; page++) {
    say("Liste des fiches… page " + page);
    var html;
    try { html = await get(location.origin + prefix + "/collections/all?page_num=" + page + "&page_size=48"); } catch (e) { break; }
    var before = handles.size, re = /\/products\/([^"'?#\/\\\s<>]+)/g, m;
    while ((m = re.exec(html))) {
      var h; try { h = decodeURIComponent(m[1]); } catch (e) { h = m[1]; }
      if (h && h.length < 200) handles.add(h);
    }
    fromSite += handles.size - before;
    if (handles.size === before) break;
  }
  var list = Array.from(handles);

  // 2. Chaque fiche, quatre à la fois.
  var products = [], done = 0;
  async function read(h) {
    var p = { h: h, t: "", price: null, cap: null, pub: null, pol: null, variants: [], err: null };
    try {
      var html = await get(location.origin + prefix + "/products/" + encodeURIComponent(h));
      var doc = new DOMParser().parseFromString(html, "text/html");
      p.t = (meta(doc, ["og:title"]) || (doc.querySelector("h1") || {}).textContent || "").trim();
      p.price = num(meta(doc, ["product:price:amount", "og:price:amount"]));
      var roots = [];
      doc.querySelectorAll("script:not([src])").forEach(function (s) {
        var t = s.textContent || "";
        if (!/quantity|inventory|stock/i.test(t)) return;
        if (/json/i.test(s.type || "")) { try { roots.push(JSON.parse(t)); return; } catch (e) {} }
        roots = roots.concat(jsonIn(t));
      });
      var found = findVariants(roots, h);
      if (!found) { p.err = "aucune variante trouvée"; return p; }
      var o = found.owner || {};
      p.variants = found.list.map(function (v) { return { k: label(v), sku: v.sku || v.skuSeq || null, q: qtyOf(v) }; });
      var pol = pick(found.list[0], ["inventory_policy", "inventoryPolicy"]) || pick(o, ["inventory_policy", "inventoryPolicy"]);
      if (pol == null) for (var k in found.list[0]) if (POL.test(k)) { pol = found.list[0][k]; break; }
      if (pol === true) pol = "continue"; else if (pol === false) pol = "deny";
      p.pol = pol == null ? null : String(pol).toLowerCase();
      var pub = pick(o, PUB);
      if (pub) { var d = new Date(typeof pub === "number" && pub < 1e12 ? pub * 1000 : pub); if (!isNaN(d)) p.pub = d.toISOString().slice(0, 10); }
      var cap = num(pick(found.list[0], CAP)), vp = num(pick(found.list[0], ["price", "salePrice", "sale_price"]));
      // Certains thèmes donnent les prix en centimes : le prix de la fiche fait foi.
      if (cap !== null && p.price && vp && vp / p.price > 50) cap = cap / 100;
      p.cap = cap;
    } catch (e) {
      p.err = String(e && e.message || e);
    }
    return p;
  }
  var queue = list.slice();
  async function worker() {
    while (queue.length) {
      var h = queue.shift();
      products.push(await read(h));
      done++;
      say("Lecture des fiches : " + done + "/" + list.length);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);

  var ok = products.filter(function (p) { return p.variants.length; });
  var nv = ok.reduce(function (n, p) { return n + p.variants.length; }, 0);
  var payload = { v: 1, scanned_at: new Date().toISOString(), products: products };
  var json = JSON.stringify(payload);
  var summary = ok.length + "/" + list.length + " fiches lues, " + nv + " variantes" + (fromSite ? "" : " (liste des fiches reprise de l'app)");

  // 3. Envoi à l'application.
  var acked = false;
  window.addEventListener("message", function (ev) {
    if (ev.origin !== APP || !ev.data) return;
    if (ev.data.type === "avontti-ready" && win) win.postMessage({ type: "avontti-scan", json: json }, APP);
    if (ev.data.type === "avontti-ack") {
      acked = true;
      say(summary + "<br>" + (ev.data.ok ? "✓ Relevé enregistré dans l'app." : "<span style='color:#fca5a5'>" + ev.data.error + "</span>"));
    }
  });
  function copyBtn() {
    return "<button id='av-copy' style='margin-top:8px;padding:6px 10px;border-radius:8px;border:0;background:#6366f1;color:#fff;cursor:pointer'>Copier le relevé</button>" +
      "<div style='margin-top:6px;opacity:.7;font-size:12px'>puis colle-le dans la page Avontti de l'app.</div>";
  }
  function bindCopy() {
    var b = document.getElementById("av-copy");
    if (b) b.onclick = function () { navigator.clipboard.writeText(json).then(function () { b.textContent = "Copié ✓"; }); };
  }
  if (win) {
    say(summary + "<br>Envoi à l'application…");
    for (var i = 0; i < 20 && !acked; i++) {
      try { win.postMessage({ type: "avontti-scan", json: json }, APP); } catch (e) {}
      await new Promise(function (r) { setTimeout(r, 1000); });
    }
  }
  if (!acked) { say(summary + "<br>L'application n'a pas répondu." + copyBtn()); bindCopy(); }
})();`;

/** Le script prêt à coller dans la console d'avontti.com. */
export function collectorScript(appOrigin: string, handles: string[]): string {
  // Remplacement par fonction : un « $ » dans les données ne doit pas être
  // interprété comme motif de remplacement.
  return SOURCE.replace("__APP__", () => appOrigin).replace(
    "__HANDLES__",
    () => JSON.stringify(handles),
  );
}

/** Le même script, en favori à glisser dans la barre du navigateur. */
export function collectorBookmarklet(appOrigin: string, handles: string[]): string {
  return "javascript:" + encodeURIComponent(collectorScript(appOrigin, handles));
}
