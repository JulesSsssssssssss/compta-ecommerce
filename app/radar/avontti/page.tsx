import Link from "next/link";
import type { ReactNode } from "react";
import { Card, StatCard } from "@/app/components/ui";
import { AvonttiScan } from "@/app/components/AvonttiScan";
import { AvonttiCatalog, type CatalogRow } from "@/app/components/AvonttiCatalog";
import {
  BASELINE_AT,
  BASELINE_FEED,
  diffScans,
  knownHandles,
  loadScans,
  type Diff,
  type ProductView,
} from "@/lib/avontti";

// Un relevé peut arriver à tout moment depuis avontti.com.
export const dynamic = "force-dynamic";

const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");
const eur = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const kEur = (n: number) =>
  n >= 10_000 ? `${fmt(n / 1000)} k€` : `${fmt(n)} €`;
/** "2026-09-15T17:00" → "15/09 à 17h00". */
const when = (at: string) => {
  const [d, t] = at.split("T");
  const [, m, day] = d.split("-");
  return `${day}/${m}${t ? ` à ${t.replace(":", "h")}` : ""}`;
};
const days = (n: number) =>
  n < 1 ? `${fmt(n * 24)} h` : `${n.toFixed(1).replace(".", ",").replace(",0", "")} jour${n >= 2 ? "s" : ""}`;

function SectionTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="px-4 sm:px-5 py-4 border-b border-slate-200 flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

function Line({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-slate-100 last:border-0 text-sm">
      <span className="text-slate-600 min-w-0">
        {label}
        {hint && <span className="text-xs text-slate-400"> ({hint})</span>}
      </span>
      <span className={`font-semibold tabular-nums shrink-0 ${tone ?? "text-slate-900"}`}>{value}</span>
    </div>
  );
}

/** Classement par unités écoulées, en barres. */
function Ranking({ products }: { products: ProductView[] }) {
  const sold = products.filter((p) => p.sold > 0);
  const max = sold[0]?.sold ?? 1;
  const bar = (p: ProductView, i: number) => (
    <li key={p.h} className="grid grid-cols-[1.5rem_minmax(0,1fr)_5.5rem] items-center gap-2.5">
      <span className="text-right text-xs tabular-nums text-slate-400">{i + 1}</span>
      <div className="relative h-7 overflow-hidden rounded-md bg-slate-100">
        <div
          className={`absolute inset-y-0 left-0 ${i === 0 ? "bg-indigo-500/80" : "bg-indigo-300/70"}`}
          style={{ width: `${Math.max(1.2, (p.sold / max) * 100)}%` }}
        />
        <a
          href={`https://avontti.com/fr-fr/products/${encodeURIComponent(p.h)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute inset-0 flex items-center px-2.5 text-xs font-medium text-slate-900 truncate hover:underline"
        >
          {p.t}
        </a>
      </div>
      <span className="text-right text-sm font-semibold tabular-nums leading-tight">
        {fmt(p.sold)}
        <small className="block text-[10px] font-normal text-slate-400">{fmt(p.ca)} €</small>
      </span>
    </li>
  );
  return (
    <div className="p-4 sm:p-5">
      <ol className="flex flex-col gap-1.5">{sold.slice(0, 10).map(bar)}</ol>
      {sold.length > 10 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer px-8 py-1.5 text-xs text-slate-400 hover:text-slate-600">
            et {sold.length - 10} autres produits qui ont vendu
          </summary>
          <ol className="flex flex-col gap-1.5">{sold.slice(10).map((p, i) => bar(p, i + 10))}</ol>
        </details>
      )}
    </div>
  );
}

/** Ce qui s'est vendu entre deux relevés : le vrai chiffre de la période. */
function Period({ diff }: { diff: Diff }) {
  const top = diff.movements.filter((m) => m.units > 0);
  const restocks = diff.movements.filter((m) => m.restock);
  return (
    <Card className="overflow-hidden">
      <SectionTitle
        title={`Ventes depuis le relevé du ${when(diff.from.at)}`}
        subtitle={
          diff.exact
            ? `Différence de stock variante par variante sur ${days(diff.days)} — des unités réellement écoulées, sans estimation`
            : `Comparé au teardown du 15/09, produit par produit sur ${days(diff.days)} — lance un second scan pour la précision à la variante`
        }
      />
      <div className="grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-200">
        {[
          ["Unités écoulées", fmt(diff.units)],
          ["Par jour", fmt(diff.units / diff.days)],
          ["CA estimé", kEur(diff.ca)],
        ].map(([k, v]) => (
          <div key={k} className="px-4 sm:px-5 py-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">{k}</p>
            <p className="text-xl font-semibold tabular-nums text-slate-900">{v}</p>
          </div>
        ))}
      </div>
      {top.length === 0 ? (
        <p className="px-5 py-8 text-sm text-slate-400 text-center">
          Aucune vente visible entre les deux relevés.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {top.slice(0, 10).map((m, i) => (
            <li key={m.h} className="px-4 sm:px-5 py-2.5 flex items-center gap-3">
              <span
                className={`grid place-items-center w-7 h-7 shrink-0 rounded-lg text-xs font-bold tabular-nums ${
                  i < 3 ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 truncate">{m.t}</p>
                <p className="text-xs text-slate-400">
                  {eur(m.price)} · {m.perDay.toFixed(1).replace(".", ",")} / jour
                  {m.isNew && <span className="text-emerald-600"> · nouvelle fiche</span>}
                  {m.restock && <span className="text-amber-600"> · réassort : plancher</span>}
                </p>
              </div>
              <span className="text-right text-sm font-semibold tabular-nums">
                {fmt(m.units)}
                <small className="block text-[10px] font-normal text-slate-400">{kEur(m.units * m.price)}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
      {restocks.length > 0 && (
        <p className="px-4 sm:px-5 py-2.5 text-xs text-amber-700 bg-amber-50/60 border-t border-slate-200">
          Réassort détecté sur {restocks.length} produit{restocks.length > 1 ? "s" : ""} : les ventes couvertes
          par le nouveau stock ne se voient pas, le chiffre est un minimum.
        </p>
      )}
    </Card>
  );
}

export default async function AvonttiPage() {
  const scans = await loadScans();
  const current = scans[0];
  const previous = scans[1] ?? null;
  const products = current.products;
  const diff = previous ? diffScans(current, previous) : null;

  const units = products.reduce((n, p) => n + p.sold, 0);
  const ca = products.reduce((n, p) => n + p.ca, 0);
  const selling = products.filter((p) => p.sold > 0).length;
  const hero = products[0];
  const heroShare = ca > 0 ? Math.round((hero.ca / ca) * 100) : 0;
  const today = new Date(current.at.slice(0, 10));
  const monthStart = `${current.at.slice(0, 7)}-01`;
  const rows: CatalogRow[] = products.map((p) => {
    const age = p.pub ? Math.max(1, Math.round((+today - +new Date(p.pub)) / 864e5)) : 0;
    return {
      t: p.t,
      h: p.h,
      sold: p.sold,
      ca: p.ca,
      v: age && p.sold ? p.sold / age : 0,
      price: p.price,
      cap: p.cap,
      disc: p.disc,
      nv: p.nv,
      col: p.col,
      pub: p.pub ?? "",
    };
  });
  const heroCurve = (hero.curve ?? []).filter(([, q]) => q > 0);
  const curveMax = Math.max(1, ...heroCurve.map(([, q]) => q));
  const coreShare = hero.sold
    ? Math.round(
        (heroCurve
          .filter(([k]) => /(^|\/)(S|M)$/.test(k))
          .reduce((n, [, q]) => n + q, 0) /
          hero.sold) *
          100,
      )
    : 0;
  const realScans = scans.filter((s) => !s.isBaseline);

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <Link href="/radar" className="text-xs font-medium text-slate-500 hover:text-indigo-600">
          ← Radar concurrents
        </Link>
        <div className="mt-2 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
              Avontti <span className="text-slate-400 font-normal">· scan exclusif</span>
            </h1>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              Boutique de mode féminine sur <b className="text-slate-700">SHOPLINE</b> (pas Shopify),
              pilotée au pixel TikTok. Le stock négatif laissé par leur politique de survente expose
              le volume réel écoulé, référence par référence.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[
                "SHOPLINE · store 1743149733387",
                "8 marchés · EUR sur /fr-fr",
                "TikTok + Meta Pixel",
                "SmartPush · SalesMartly · xCottons",
                "0 avis client",
                "Fuseau Asia/Shanghai",
              ].map((f) => (
                <span key={f} className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] text-slate-500">
                  {f}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-400">
              {current.isBaseline
                ? `Chiffres du teardown du ${when(BASELINE_AT)} — aucun scan lancé depuis l'app pour l'instant.`
                : `Dernier relevé : ${when(current.at)} · ${realScans.length} relevé${realScans.length > 1 ? "s" : ""} dans l'app`}
            </p>
          </div>
          <AvonttiScan handles={knownHandles(scans)} />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Références en ligne" value={String(products.length)} hint={`${selling} ont déjà vendu`} />
        <StatCard label="Unités écoulées" value={fmt(units)} hint="plancher, cumulé depuis la rupture" tone="brand" />
        <StatCard label="CA estimé" value={kEur(ca)} hint="unités × prix actuel" />
        <StatCard
          label="Concentration"
          value={`${heroShare} %`}
          hint={`du CA sur ${hero.t.replace(/\s*\(.*$/, "").replace(/\s*（.*$/, "")}`}
          tone={heroShare >= 50 ? "negative" : "neutral"}
        />
      </div>

      {diff && <Period diff={diff} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
        <Card className="overflow-hidden">
          <SectionTitle title="Le classement réel" subtitle="Unités écoulées au-delà du stock, par produit" />
          <Ranking products={products} />
        </Card>

        <Card className="overflow-hidden">
          <SectionTitle
            title="Le produit qui porte la boutique"
            subtitle={`${hero.t}${hero.pub ? ` · en ligne depuis le ${hero.pub.split("-").reverse().join("/")}` : ""}`}
          />
          <div className="p-4 sm:p-5">
            {heroCurve.length > 0 && (
              <>
                <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-3">
                  Courbe des tailles — unités écoulées
                </p>
                <div className="flex items-end gap-1.5 h-36 border-b border-slate-200">
                  {heroCurve.slice(0, 14).map(([k, q]) => (
                    <div key={k} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                      <span className="text-[10px] font-semibold tabular-nums">{fmt(q)}</span>
                      <div className="w-full rounded-t bg-indigo-500" style={{ height: `${Math.max(2, (q / curveMax) * 100)}px` }} />
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5 mt-1.5">
                  {heroCurve.slice(0, 14).map(([k]) => (
                    <span key={k} className="flex-1 text-center text-[10px] text-slate-400 truncate">
                      {k.split("/").pop()}
                    </span>
                  ))}
                </div>
              </>
            )}
            <div className="mt-4">
              <Line label="Prix de vente" value={eur(hero.price)} />
              {hero.cap > hero.price && <Line label="Prix barré" value={eur(hero.cap)} />}
              {hero.disc > 0 && <Line label="Remise affichée" value={`−${hero.disc} %`} tone="text-orange-700" />}
              <Line label="Unités écoulées" value={fmt(hero.sold)} />
              <Line label="CA estimé" value={`${fmt(hero.ca)} €`} />
              <Line label="Variantes" value={hero.nv} />
              {coreShare > 0 && <Line label="Cœur de gamme S+M" value={`${coreShare} %`} />}
              <Line label="Politique de stock" value={hero.pol} />
              <Line label="Mécanique" value="Buy 2 → port offert" />
            </div>
          </div>
        </Card>
      </div>

      {/* ---- Lecture du moment, telle que relevée le 15/09 ---- */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Ce qui se vendait le 15/09</h2>
        <p className="text-sm text-slate-500 mt-0.5 max-w-3xl">
          Le compteur de surventes est cumulé, sans axe temporel : un relevé seul ne se découpe pas
          par date. Ces deux signaux vivants, relevés le 15 septembre à 17h, donnaient la photo du
          moment — les relevés de l&apos;app la donnent désormais au chiffre près.
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
        <Card className="overflow-hidden">
          <SectionTitle
            title="Signal 1 — le flux de commandes réelles"
            subtitle="Le pop-up « X vient d'acheter » est branché sur les vraies commandes (customCreateTime: null)"
          />
          <ul className="divide-y divide-slate-100">
            {BASELINE_FEED.map((f, i) => (
              <li key={i} className="px-4 sm:px-5 py-2 grid grid-cols-[3rem_minmax(0,1fr)_auto] gap-2 items-baseline text-sm">
                <span className="text-xs tabular-nums text-slate-400">{f.t}</span>
                <span className={`truncate font-medium ${/Kylie/.test(f.p) ? "text-indigo-700" : "text-slate-800"}`}>{f.p}</span>
                <span className="text-xs text-slate-400 whitespace-nowrap">{f.c}</span>
              </li>
            ))}
          </ul>
          <div className="px-4 sm:px-5 py-2.5 border-t border-slate-200 flex justify-between text-sm">
            <span className="text-slate-600">10 commandes en 9,9 h</span>
            <b className="tabular-nums">≈ 24 / jour</b>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <SectionTitle
            title="Signal 2 — le tri natif du site"
            subtitle="« Meilleurs vendeurs » (?sort_type=2) est une fenêtre glissante, pas le cumul"
          />
          <div className="px-4 sm:px-5 py-2">
            <Line label="Totti Jean" hint="1 vendu, en ligne le 8 sept." value="↑ 2e" tone="text-emerald-600" />
            <Line label="Tied pants" hint="75 vendus, en ligne en mars" value="↓ 4e" tone="text-orange-700" />
            <Line label="Kylie Button Top Mahogany" hint="27, 26 août" value="↑ 3e" tone="text-emerald-600" />
            <Line label="Crochet linen top" hint="42, 20 mai" value="↓ 4e" tone="text-orange-700" />
            <Line label="Denim mini dress" hint="1, 10 sept." value="↑ 2e" tone="text-emerald-600" />
            <Line label="Backless maxi dress" hint="2, 11 août" value="↓ 3e" tone="text-orange-700" />
          </div>
          <p className="px-4 sm:px-5 pb-4 text-xs text-slate-500">
            Les six écarts vont dans le même sens : ce qui est récent remonte, ce qui est ancien descend.
          </p>
        </Card>
      </div>
      <Card className="p-4 sm:p-5 border-t-4 border-t-indigo-600">
        <p className="text-[11px] uppercase tracking-wider text-slate-500">Verdict du 15/09 — ce qui se vendait</p>
        <p className="mt-1 text-xl sm:text-2xl font-semibold text-slate-900">Kylie Button Top, Graphite</p>
        <p className="mt-2 text-sm text-slate-600 max-w-3xl leading-relaxed">
          6 des 10 dernières commandes · 140 unités en 20 jours, soit <b className="text-slate-900">7,0 / jour</b> —
          la deuxième meilleure vélocité de la boutique, et la seule qui monte. Le <b className="text-slate-900">Jodie Jeans</b>{" "}
          reste 1er du tri natif mais n&apos;apparaît dans aucune des 10 dernières commandes : un fond de catalogue
          qui tourne encore, plus le moteur de croissance. La capsule <b className="text-slate-900">Kylie</b> pèse
          8 des 10 dernières commandes à elle seule.
        </p>
      </Card>

      <Card className="overflow-hidden">
        <SectionTitle title="Catalogue complet" subtitle="Clique un en-tête pour trier" />
        <AvonttiCatalog rows={rows} newSince={monthStart} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
        <Card className="overflow-hidden">
          <SectionTitle title="Ce qu'ils font bien — panier moyen" />
          <ul className="px-4 sm:px-5 py-3 space-y-2 text-sm text-slate-600 list-disc pl-9">
            <li><b className="text-slate-900">Le nom du produit porte l&apos;offre</b> — « Jodie Jeans (Buy 2 Free Shipping) ». La condition est lue avant même le clic, dans les collections et dans les pubs.</li>
            <li><b className="text-slate-900">Palier de remise en fiche</b> — Buy 1 / Buy 2 (−5 %) / Buy 3 (−10 %), affiché sous le prix.</li>
            <li><b className="text-slate-900">Port offert dès 99 $</b> en bandeau défilant permanent.</li>
            <li><b className="text-slate-900">Gift Offer dès 43,37 €</b> — un seuil converti depuis l&apos;USD, appliqué tel quel.</li>
            <li><b className="text-slate-900">Shipping Protection à 0,95 €</b> vendu comme un produit (98 variantes, une par tranche de panier).</li>
            <li><b className="text-slate-900">Programme de points</b> déductible directement dans le panier.</li>
          </ul>
        </Card>
        <Card className="overflow-hidden">
          <SectionTitle title="Ce qu'ils font bien — assortiment" />
          <ul className="px-4 sm:px-5 py-3 space-y-2 text-sm text-slate-600 list-disc pl-9">
            <li><b className="text-slate-900">Coloris = fiche séparée</b> — « Kimberly foldover pant » existe en 3 fiches (Espresso, Pink, Light heather grey) : trois pages à référencer, trois créas à tester.</li>
            <li><b className="text-slate-900">Capsule signée</b> — la « Kylie Collection » (7 pièces) a sa propre collection ; le Kylie Button Top Graphite était 5e au cumul en trois semaines.</li>
            <li><b className="text-slate-900">Prix barré systématique</b> sur les produits poussés : −46 à −49 % sur les best-sellers, 0 % sur les nouveautés premium.</li>
            <li><b className="text-slate-900">Preuve sociale</b> — pop-up « J** vient d&apos;acheter à Banstead, il y a 2 h ».</li>
            <li><b className="text-slate-900">Aucun système d&apos;avis</b> installé. C&apos;est le trou béant du dispositif.</li>
          </ul>
        </Card>
      </div>

      {realScans.length > 0 && (
        <Card className="overflow-hidden">
          <SectionTitle title="Historique des relevés" subtitle="Chaque relevé sert de référence au suivant" />
          <ul className="divide-y divide-slate-100">
            {scans.map((s, i) => {
              const u = s.products.reduce((n, p) => n + p.sold, 0);
              const d = scans[i + 1] ? diffScans(s, scans[i + 1]) : null;
              return (
                <li key={s.id} className="px-4 sm:px-5 py-2.5 flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-slate-800">
                    {when(s.at)}
                    {s.isBaseline && <span className="text-xs text-slate-400"> · teardown initial</span>}
                  </span>
                  <span className="text-xs tabular-nums text-slate-500">
                    {s.products.length} fiches · {fmt(u)} unités cumulées
                    {d && <b className="text-emerald-600 font-medium"> · +{fmt(d.units)} en {days(d.days)}</b>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="text-xs text-slate-400 leading-relaxed">
        <details>
          <summary className="cursor-pointer hover:text-slate-600 transition-colors">
            Comment ces chiffres sont obtenus — à lire avant de les citer
          </summary>
          <div className="mt-1.5 space-y-1.5 max-w-3xl">
            <p>
              SHOPLINE embarque l&apos;objet produit complet dans chaque fiche, variantes et quantités en stock
              comprises. La boutique tourne en <code>inventory_policy: continue</code> : la vente continue une fois
              le stock à zéro et le compteur passe en négatif. Un stock de −1 466 sur le Jodie Jeans taille S
              signifie 1 466 unités vendues au-delà du stock enregistré.
            </p>
            <p>
              C&apos;est un <strong>plancher, pas un total</strong> : ce qui a été vendu tant que le stock était
              positif n&apos;est pas compté, et un réassort remet le compteur à zéro. Le CA est estimé au prix affiché
              en EUR ; les remises panier et les paliers Buy 2 / Buy 3 le tirent vers le bas.
            </p>
            <p>
              Entre deux relevés, la baisse de stock d&apos;une variante donne les unités vendues sur la période,
              quelle que soit la politique de stock. Une hausse signale un réassort : la période est alors un minimum.
            </p>
            <p>
              avontti.com est protégé par Cloudflare : aucun serveur ne peut le lire. Le scan tourne donc dans ton
              navigateur, sur le site, et renvoie son relevé à l&apos;app.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}
