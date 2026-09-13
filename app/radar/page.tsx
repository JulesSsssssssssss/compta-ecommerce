import type { ReactNode } from "react";
import raw from "@/data/radar.json";
import { Card, StatCard } from "@/app/components/ui";
import { RadarScan } from "@/app/components/RadarScan";
import { prisma } from "@/lib/prisma";
import { addRadarSite, removeRadarSite } from "@/lib/radar-actions";
import {
  isRealClimb,
  loadTrends,
  type Step,
  type Trends,
} from "@/lib/radar-trends";

// La liste des sites vit en base, et un scan peut être lancé à tout moment :
// la page doit refléter l'un comme l'autre immédiatement.
export const dynamic = "force-dynamic";

// Un scan lancé depuis l'application scanne une boutique par requête ; 60 s
// couvrent largement la plus lente d'entre elles.
export const maxDuration = 60;

// Deux sources possibles pour le rapport : le scan de 20h, qui écrit
// data/radar.json dans le dépôt et déclenche un redéploiement, et un scan
// lancé depuis l'application, qui écrit en base. On affiche le plus récent des
// deux. Volontairement limitée à Card et StatCard, les seuls composants
// partagés par toutes les versions du design system.
type Row = {
  handle: string;
  title: string;
  price: string | null;
  rank: number;
  age_days: number;
  url: string;
  /** true = vend deja, false = aucune vente, null = frontiere non fiable */
  selling?: boolean | null;
  /** Rang au scan precedent, null si absent ou pas de comparaison possible. */
  was?: number | null;
  /** Places gagnees depuis le scan precedent (negatif = perdues). */
  delta?: number | null;
  /** Vrai si le produit ne figurait pas au scan precedent. */
  is_new?: boolean;
};

type Move = {
  /** Handle Shopify du produit : de quoi reconstruire l'URL de sa fiche. */
  h?: string;
  title: string;
  rank: number;
  from: number;
  delta?: number;
  /** Entree au classement : le rang atteint est-il dans la zone de vente ? */
  selling?: boolean | null;
};

type Site = {
  domain: string;
  error?: string;
  n_products?: number;
  boundary?: number;
  confidence?: "fiable" | "faible";
  warning?: string | null;
  compared_to?: string | null;
  top?: Row[];
  strong?: Row[];
  watch?: Row[];
  fresh?: Row[];
  movements?: {
    first_sale?: Move[];
    climbing?: Move[];
    falling?: Move[];
    new_products?: Move[];
    dropped_out?: Move[];
  };
};

type Radar = {
  date: string;
  generated_at: string;
  n_sites: number;
  n_strong: number;
  sites: Site[];
  /** Absent des rapports antérieurs à son introduction : calculé à la volée. */
  trends?: Trends | null;
};

const fromRepo = raw as unknown as Radar;

/** Le rapport à afficher : celui de la base s'il est plus frais que le JSON. */
async function latestRadar(): Promise<Radar> {
  const row = await prisma.radarReport
    .findFirst({ orderBy: { generatedAt: "desc" } })
    .catch(() => null);
  if (!row) return fromRepo;
  try {
    const stored = JSON.parse(row.payload) as Radar;
    // `generated_at` est une heure locale sans fuseau des deux côtés : les
    // comparer via Date les remet sur la même échelle.
    return Date.parse(stored.generated_at) > Date.parse(fromRepo.generated_at)
      ? stored
      : fromRepo;
  } catch {
    return fromRepo;
  }
}

const euro = (p: string | null) =>
  p == null ? "—" : `${Number(p).toFixed(2).replace(".", ",")} €`;

const frDate = (d: string) => d.split("-").reverse().join("/");

const jours = (n: number) =>
  n <= 0 ? "aujourd'hui" : n === 1 ? "1 jour" : `${n} jours`;

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-5 py-4 border-b border-slate-200">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

/**
 * Mouvement d'un produit depuis le scan de la veille, posé sur sa propre
 * ligne. Un produit qui gagne une place doit se voir là où on le lit, pas
 * seulement dans une carte séparée plus bas.
 *
 * Rien ne s'affiche quand il n'y a pas de scan précédent auquel se comparer :
 * mieux vaut un blanc qu'un « = » qui laisserait croire à une stabilité
 * réellement mesurée.
 */
function Delta({ r }: { r: Row }) {
  // « nouveau » ne tient pas dans la colonne étroite des flèches : il
  // débordait sur le titre. Il est affiché sur la ligne de contexte.
  if (r.is_new || r.delta == null) return null;
  if (r.delta === 0) {
    return (
      <span className="text-[11px] text-slate-300 tabular-nums" title="Rang inchangé depuis hier">
        =
      </span>
    );
  }
  const up = r.delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums whitespace-nowrap ${
        up ? "text-emerald-600" : "text-slate-400"
      }`}
      title={`${r.was}e hier, ${r.rank}e aujourd'hui`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(r.delta)}
    </span>
  );
}

/** Pastille de rang : plus le rang est petit, plus le produit vend. */
function Rank({ n }: { n: number }) {
  return (
    <span
      className={`grid place-items-center w-8 h-8 shrink-0 rounded-lg text-xs font-bold tabular-nums ${
        n <= 3
          ? "bg-indigo-600 text-white"
          : "bg-slate-100 text-slate-600 border border-slate-200"
      }`}
    >
      {n}
    </span>
  );
}

/**
 * Ligne produit, en deux niveaux : le titre et le prix sur la première ligne,
 * le contexte sur la seconde. Cette forme tient en demi-largeur, ce qui permet
 * de poser deux cartes côte à côte plutôt que de les empiler.
 */
function ProductRow({
  r,
  domain,
  status,
  ranked = true,
}: {
  r: Row;
  domain: string;
  /** Complément de contexte, ex. « déjà 2e des ventes ». */
  status?: ReactNode;
  /** Faux quand le rang n'a pas de sens : le produit ne vend pas encore. */
  ranked?: boolean;
}) {
  return (
    <li className="px-4 sm:px-5 py-2.5 flex items-start gap-2.5">
      <span className="flex items-center gap-1 shrink-0">
        {ranked ? (
          <Rank n={r.rank} />
        ) : (
          <span className="grid place-items-center w-8 h-8 shrink-0 rounded-lg border border-dashed border-slate-300 text-slate-300 text-xs">
            —
          </span>
        )}
        <span className="w-10 text-right">{ranked ? <Delta r={r} /> : null}</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-slate-900 hover:text-indigo-600 hover:underline truncate"
          >
            {r.title}
          </a>
          <span className="text-sm tabular-nums text-slate-700 shrink-0">
            {euro(r.price)}
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-0.5 truncate">
          {domain} · {jours(r.age_days)}
          {r.is_new && ranked ? (
            <>
              {" · "}
              <span
                className="rounded-full bg-indigo-50 px-1.5 py-px font-medium text-indigo-600"
                title="Absent du scan précédent"
              >
                nouveau
              </span>
            </>
          ) : null}
          {status ? <> · {status}</> : null}
        </p>
      </div>
    </li>
  );
}

/** Pied de liste quand tout n'est pas montré : dire ce qu'on ne voit pas. */
function More({ hidden, word }: { hidden: number; word: string }) {
  if (hidden <= 0) return null;
  return (
    <li className="px-4 sm:px-5 py-2.5 text-xs text-slate-400">
      et {hidden} {word}
      {hidden > 1 ? "s" : ""} de plus, non {hidden > 1 ? "affichés" : "affiché"}
    </li>
  );
}

/** Montée affichée dans la carte « Produits qui grimpent ». */
type Climb = {
  domain: string;
  title: string;
  url: string | null;
  price: string | null;
  rank: number;
  from: number;
  path?: Step[];
};

/** Trajet d'un produit au fil des scans : « 147 › 148 › 2 ». */
function Path({ steps }: { steps: Step[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 tabular-nums">
      {steps.map((st, i) => (
        <span key={st.date} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-slate-300">›</span>}
          <span
            title={`${frDate(st.date)} : ${st.rank == null ? "absent" : `${st.rank}e`}`}
            className={
              i === steps.length - 1 ? "font-semibold text-slate-700" : undefined
            }
          >
            {st.rank ?? "—"}
          </span>
        </span>
      ))}
    </span>
  );
}

function ClimbRow({ c }: { c: Climb }) {
  const gain = c.from - c.rank;
  return (
    <li className="px-4 sm:px-5 py-2.5 flex items-start gap-2.5">
      <span className="flex items-center gap-1 shrink-0">
        <Rank n={c.rank} />
        <span className="w-10 text-right text-[11px] font-medium tabular-nums text-emerald-600 whitespace-nowrap">
          ▲{gain}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          {c.url ? (
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-slate-900 hover:text-indigo-600 hover:underline truncate"
            >
              {c.title}
            </a>
          ) : (
            <span className="text-sm font-medium text-slate-900 truncate">
              {c.title}
            </span>
          )}
          {c.price != null && (
            <span className="text-sm tabular-nums text-slate-700 shrink-0">
              {euro(c.price)}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-0.5 truncate">
          {c.domain} ·{" "}
          <span className="text-emerald-600 font-medium">
            {c.from}e → {c.rank}
            {c.rank === 1 ? "er" : "e"} des ventes
          </span>
          {c.path && c.path.length > 2 && (
            <>
              {" · trajet "}
              <Path steps={c.path} />
            </>
          )}
        </p>
      </div>
    </li>
  );
}

/**
 * Le Top 3 à essayer : la conclusion de la page, posée avant le détail. Chaque
 * choix dit pourquoi, et ce qui pourrait le démentir.
 */
function TopPicks({ trends }: { trends: Trends }) {
  const { picks, dates } = trends;
  const span =
    dates.length > 1
      ? `${dates.length} scans, du ${frDate(dates[0])} au ${frDate(dates[dates.length - 1])}`
      : "un seul scan";
  return (
    <Card className="overflow-hidden">
      <SectionTitle
        title="Top 3 à essayer sur ta boutique"
        subtitle={`D'après ${span} — progression au classement, rang atteint, fraîcheur et tenue dans le temps`}
      />
      {picks.length === 0 ? (
        <p className="px-5 py-8 text-sm text-slate-400 text-center">
          {dates.length < 2
            ? "Il faut au moins deux scans pour voir qui se met à vendre."
            : "Aucun produit ne se détache nettement pour l'instant — mieux vaut ça qu'une fausse piste."}
        </p>
      ) : (
        <ol className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200">
          {picks.map((p, i) => (
            <li key={p.url} className="p-4 sm:p-5 flex flex-col gap-2 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="grid place-items-center w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-bold">
                  {i + 1}
                </span>
                <span className="text-sm tabular-nums text-slate-700">
                  {euro(p.price)}
                </span>
              </div>
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-slate-900 hover:text-indigo-600 hover:underline line-clamp-2"
              >
                {p.title}
              </a>
              <p className="text-xs text-slate-400">
                {p.domain} ·{" "}
                {p.age_days <= 0
                  ? "mis en ligne aujourd'hui"
                  : `en ligne depuis ${jours(p.age_days)}`}
              </p>
              {p.path.length > 1 && (
                <p className="text-xs text-slate-400">
                  Rang au fil des scans : <Path steps={p.path} />
                </p>
              )}
              <p className="text-sm text-slate-600 leading-snug">{p.why}</p>
              {p.caution && (
                <p className="text-xs text-amber-600">{p.caution}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export default async function RadarPage() {
  const radar = await latestRadar();
  const tracked = await prisma.radarSite
    .findMany({ orderBy: { domain: "asc" } })
    .catch(() => [] as { domain: string }[]);
  const scannedDomains = new Set(radar.sites.map((s) => s.domain));
  // Un site ajoute apres le dernier scan n'a pas encore de donnees.
  const pending = tracked
    .map((t) => t.domain)
    .filter((d) => !scannedDomains.has(d));
  const sites = radar.sites;
  const ok = sites.filter((s) => !s.error);
  const strong = ok.flatMap((s) => (s.strong ?? []).map((r) => ({ r, s })));
  const watch = ok.flatMap((s) => (s.watch ?? []).map((r) => ({ r, s })));
  // Tri global : ce qui vend deja passe devant, tous sites confondus.
  const fresh = ok
    .flatMap((s) => (s.fresh ?? []).map((r) => ({ r, s })))
    .sort(
      (a, b) =>
        Number(Boolean(b.r.selling)) - Number(Boolean(a.r.selling)) ||
        (a.r.selling ? a.r.rank - b.r.rank : a.r.age_days - b.r.age_days),
    );
  const scanned = ok.reduce((n, s) => n + (s.n_products ?? 0), 0);
  // Lecture de l'historique : stockée avec le rapport, recalculée à la volée
  // pour les rapports produits avant qu'elle n'existe.
  const trends =
    radar.trends ??
    (await loadTrends(
      ok.map((s) => s.domain),
      radar.date,
    ));
  // Seules les montées franches comptent : un produit qui glisse d'une place
  // en 99e position ne dit rien, un bond de 148e à 2e dit qu'il se vend. Sans
  // historique en base, on retombe sur les mouvements du rapport, même filtre.
  const climbs: Climb[] = trends
    ? trends.climbers.map((t) => ({ ...t, from: t.prev! }))
    : ok
        .flatMap((s) =>
          [...(s.movements?.first_sale ?? []), ...(s.movements?.climbing ?? [])]
            .filter((m) => isRealClimb(m.from, m.rank))
            .map((m) => ({
              domain: s.domain,
              title: m.title,
              url: m.h ? `https://${s.domain}/products/${m.h}` : null,
              price: null,
              rank: m.rank,
              from: m.from,
            })),
        )
        .sort((a, b) => a.rank / a.from - b.rank / b.from);
  // Toutes ces listes sont des classements : au-dela des dix premieres lignes,
  // on ne lit plus un signal, on fait defiler. Ce qui est coupe est annonce.
  const LIST_MAX = 10;
  const freshTop = fresh.slice(0, LIST_MAX);
  const strongSorted = [...strong].sort(
    (a, b) => a.r.rank - b.r.rank || a.r.age_days - b.r.age_days,
  );
  const strongTop = strongSorted.slice(0, LIST_MAX);
  const watchTop = watch.slice(0, LIST_MAX);
  const climbsShown = climbs.slice(0, LIST_MAX);
  // Date de reference du diff : la meme pour tous les sites en pratique.
  const comparedTo = ok.find((s) => s.compared_to)?.compared_to ?? null;
  const failed = sites.length - ok.length;

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
            Radar concurrents
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Les produits récents qui se vendent déjà chez les concurrents — des
            candidats au lancement.
          </p>
        </div>
        <RadarScan />
      </div>

      {trends && <TopPicks trends={trends} />}

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard
          label="Signaux forts"
          value={String(strong.length)}
          tone={strong.length > 0 ? "brand" : "neutral"}
          hint={`au ${radar.date.split("-").reverse().join("/")}`}
        />
        <StatCard
          label="Sites suivis"
          value={String(radar.n_sites)}
          hint={`${ok.length} scannés`}
        />
        <StatCard label="Produits analysés" value={String(scanned)} />
      </div>

      {/* Deux cartes de front des qu'il y a la place : la page tenait sur
          quatre ecrans de haut, elle en fait deux. En dessous de lg, elles
          s'empilent — le plafond de dix lignes garde le defilement court. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
        {/* ---- Ce qui vient de sortir chez les concurrents, et son statut ---- */}
        {fresh.length > 0 && (
          <Card className="overflow-hidden">
            <SectionTitle
              title="Nouveautés des concurrents"
              subtitle="En ligne depuis moins de 7 jours — celles qui vendent déjà sont en tête"
            />
            <ul className="divide-y divide-slate-200">
              {freshTop.map(({ r, s }) => (
                <ProductRow
                  key={s.domain + r.handle}
                  r={r}
                  domain={s.domain}
                  ranked={Boolean(r.selling)}
                  status={
                    r.selling ? (
                      <span className="text-emerald-600 font-medium">
                        déjà {r.rank}
                        <sup>{r.rank === 1 ? "er" : "e"}</sup> des ventes
                      </span>
                    ) : r.selling === null ? (
                      "vente non mesurable"
                    ) : (
                      "pas encore de vente"
                    )
                  }
                />
              ))}
              <More hidden={fresh.length - freshTop.length} word="nouveauté" />
            </ul>
          </Card>
        )}

        {/* ---- Le cœur du rapport ---- */}
        <Card className="overflow-hidden">
          <SectionTitle
            title="Signaux forts"
            subtitle="Mis en ligne il y a moins de 15 jours et déjà dans le top 10 des ventes"
          />
          {strong.length === 0 ? (
            <p className="px-5 py-10 text-sm text-slate-400 text-center">
              Aucun signal aujourd&apos;hui. C&apos;est le cas la plupart des
              jours — mieux vaut ça qu&apos;une fausse piste.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {strongTop.map(({ r, s }) => (
                <ProductRow key={s.domain + r.handle} r={r} domain={s.domain} />
              ))}
              <More hidden={strong.length - strongTop.length} word="signal" />
            </ul>
          )}
        </Card>

        {/* ---- Ce qui grimpe depuis le dernier scan ---- */}
        {comparedTo && (
          <Card className="overflow-hidden">
            <SectionTitle
              title="Produits qui grimpent"
              subtitle={`Gros bonds au classement des ventes depuis le ${frDate(comparedTo)} — la preuve qu'ils se vendent`}
            />
            {climbs.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-400 text-center">
                Aucune montée franche depuis le dernier scan. Les petits
                glissements de rang ne sont pas affichés.
              </p>
            ) : (
              <ul className="divide-y divide-slate-200">
                {climbsShown.map((c) => (
                  <ClimbRow key={c.domain + c.title} c={c} />
                ))}
                <More
                  hidden={climbs.length - climbsShown.length}
                  word="montée"
                />
              </ul>
            )}
          </Card>
        )}

        {watch.length > 0 && (
          <Card className="overflow-hidden">
            <SectionTitle
              title="À surveiller"
              subtitle="Moins nets, à confirmer sur quelques jours"
            />
            <ul className="divide-y divide-slate-200">
              {watchTop.map(({ r, s }) => (
                <ProductRow key={s.domain + r.handle} r={r} domain={s.domain} />
              ))}
              <More hidden={watch.length - watchTop.length} word="produit" />
            </ul>
          </Card>
        )}
      </div>

      {/* ---- Détail par site, avec la fiabilité affichée honnêtement ----
          Replié : c'est la carte la plus longue et la moins consultée, on ne
          l'ouvre que pour ajouter ou retirer une boutique. ---- */}
      <Card className="overflow-hidden">
        <details className="group">
          <summary className="px-4 sm:px-5 py-4 flex items-center justify-between gap-3 cursor-pointer list-none border-b border-slate-200">
            <span className="min-w-0">
              <span className="text-sm font-semibold text-slate-900 block">
                Sites surveillés
              </span>
              <span className="text-xs text-slate-500">
                {sites.length} boutique{sites.length > 1 ? "s" : ""} scannée
                {sites.length > 1 ? "s" : ""}
                {failed > 0 &&
                  `, ${failed} injoignable${failed > 1 ? "s" : ""}`}
                {pending.length > 0 &&
                  `, ${pending.length} en attente de scan`}
                {" — ouvrir pour en ajouter ou en retirer"}
              </span>
            </span>
            <span
              aria-hidden
              className="shrink-0 text-slate-400 transition-transform group-open:rotate-180"
            >
              ▾
            </span>
          </summary>
        <form
          action={addRadarSite}
          className="px-4 sm:px-5 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center gap-2.5 bg-slate-50/60"
        >
          <input
            name="domain"
            required
            placeholder="Colle l'URL d'une boutique — https://exemple.com/products/robe-x"
            className="flex-1 min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
          <button className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors">
            Ajouter au radar
          </button>
        </form>
        {pending.length > 0 && (
          <ul className="divide-y divide-slate-200">
            {pending.map((d) => (
              <li
                key={d}
                className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 bg-indigo-50/40"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium text-slate-900 truncate block">
                    {d}
                  </span>
                  <span className="text-xs text-indigo-600">
                    Ajouté — lance un scan pour le voir apparaître
                  </span>
                </div>
                <form action={removeRadarSite} className="shrink-0">
                  <input type="hidden" name="domain" value={d} />
                  <button className="text-xs text-slate-400 hover:text-red-600 transition-colors">
                    Retirer
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <ul className="divide-y divide-slate-200">
          {sites.map((s) => (
            <li key={s.domain} className="px-4 sm:px-5 py-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <a
                  href={`https://${s.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-slate-900 hover:text-indigo-600 hover:underline truncate"
                >
                  {s.domain}
                </a>
                <span className="flex items-baseline gap-3 shrink-0">
                  <span className="text-xs tabular-nums text-slate-500">
                    {s.error ? "—" : `${s.n_products} produits`}
                  </span>
                  <form action={removeRadarSite}>
                    <input type="hidden" name="domain" value={s.domain} />
                    <button className="text-xs text-slate-300 hover:text-red-600 transition-colors">
                      Retirer
                    </button>
                  </form>
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {s.error ? (
                  <span className="text-red-600">Scan impossible : {s.error}</span>
                ) : s.confidence === "faible" ? (
                  "Frontière zéro-vente indéterminée (catalogue trop petit ou dates trop groupées) — classement brut seulement"
                ) : (
                  `${s.boundary} produit${(s.boundary ?? 0) > 1 ? "s" : ""} avec des ventes sur la fenêtre glissante`
                )}
              </p>
              {s.warning && !s.error && (
                <p className="text-xs text-slate-300 mt-1">{s.warning}</p>
              )}
            </li>
          ))}
          </ul>
        </details>
      </Card>

      <div className="text-xs text-slate-400 leading-relaxed">
        <p>
          Scan automatique tous les soirs à 20h ; le bouton en haut de page en
          relance un à la demande. Dernier scan :{" "}
          {radar.generated_at.replace("T", " à ")}.
        </p>
        <details className="mt-1.5">
          <summary className="cursor-pointer hover:text-slate-600 transition-colors">
            Comment ces classements sont établis
          </summary>
          <p className="mt-1.5">
            Shopify trie <code>?sort_by=best-selling</code> par unités vendues
            sur une fenêtre glissante d&apos;environ 30 jours. Les produits sans
            aucune vente ne peuvent pas être départagés et retombent en ordre de
            date de création — c&apos;est cette rupture qui permet de savoir qui
            a vendu. Le classement reste <strong>ordinal</strong> : il dit qui
            vend, pas combien.
          </p>
        </details>
      </div>
    </div>
  );
}
