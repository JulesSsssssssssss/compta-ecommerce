import raw from "@/data/radar.json";
import { Card, StatCard } from "@/app/components/ui";

// Le JSON est produit en local par scan.py puis poussé dans le dépôt : la page
// est statique et se met à jour à chaque redéploiement. Volontairement limitée
// à Card et StatCard, les seuls composants partagés par toutes les versions
// du design system.
type Row = {
  handle: string;
  title: string;
  price: string | null;
  rank: number;
  age_days: number;
  url: string;
  /** true = vend deja, false = aucune vente, null = frontiere non fiable */
  selling?: boolean | null;
};

type Move = { title: string; rank: number; from: number; delta?: number };

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
};

const radar = raw as unknown as Radar;

const euro = (p: string | null) =>
  p == null ? "—" : `${Number(p).toFixed(2).replace(".", ",")} €`;

const jours = (n: number) => (n <= 1 ? `${n} jour` : `${n} jours`);

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-5 py-4 border-b border-slate-200">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
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

function ProductRow({ r, domain }: { r: Row; domain: string }) {
  return (
    <li className="px-4 sm:px-5 py-3 flex items-center gap-3">
      <Rank n={r.rank} />
      <div className="min-w-0 flex-1">
        <a
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-slate-900 hover:text-indigo-600 hover:underline block truncate"
        >
          {r.title}
        </a>
        <p className="text-xs text-slate-400 mt-0.5 truncate">
          {domain} · en ligne depuis {jours(r.age_days)}
        </p>
      </div>
      <span className="text-sm tabular-nums text-slate-700 shrink-0">
        {euro(r.price)}
      </span>
    </li>
  );
}

export default function RadarPage() {
  const sites = radar.sites;
  const ok = sites.filter((s) => !s.error);
  const strong = ok.flatMap((s) => (s.strong ?? []).map((r) => ({ r, s })));
  const watch = ok.flatMap((s) => (s.watch ?? []).map((r) => ({ r, s })));
  const fresh = ok.flatMap((s) => (s.fresh ?? []).map((r) => ({ r, s })));
  const scanned = ok.reduce((n, s) => n + (s.n_products ?? 0), 0);
  const movers = ok.flatMap((s) => [
    ...(s.movements?.first_sale ?? []).map((m) => ({ m, s, kind: "first" as const })),
    ...(s.movements?.climbing ?? []).map((m) => ({ m, s, kind: "climb" as const })),
  ]);

  return (
    <div className="space-y-6 sm:space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
          Radar concurrents
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Les produits récents qui se vendent déjà chez les concurrents — des
          candidats au lancement.
        </p>
      </div>

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

      {/* ---- Le cœur du rapport ---- */}
      <Card className="overflow-hidden">
        <SectionTitle
          title="Signaux forts"
          subtitle="Mis en ligne il y a moins de 15 jours et déjà dans le top 10 des ventes"
        />
        {strong.length === 0 ? (
          <p className="px-5 py-10 text-sm text-slate-400 text-center">
            Aucun signal aujourd&apos;hui. C&apos;est le cas la plupart des jours
            — mieux vaut ça qu&apos;une fausse piste.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {strong
              .sort((a, b) => a.r.rank - b.r.rank || a.r.age_days - b.r.age_days)
              .map(({ r, s }) => (
                <ProductRow key={s.domain + r.handle} r={r} domain={s.domain} />
              ))}
          </ul>
        )}
      </Card>

      {movers.length > 0 && (
        <Card className="overflow-hidden">
          <SectionTitle
            title="Mouvements depuis le dernier scan"
            subtitle="Progression réelle au classement, mesurée jour après jour"
          />
          <ul className="divide-y divide-slate-200">
            {movers.map(({ m, s, kind }) => (
              <li key={s.domain + m.title} className="px-4 sm:px-5 py-3">
                <p className="text-sm font-medium text-slate-900">{m.title}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {s.domain} ·{" "}
                  {kind === "first" ? (
                    <span className="text-emerald-600 font-medium">
                      première vente détectée — entre au rang {m.rank}
                    </span>
                  ) : (
                    `${m.from} → ${m.rank} (+${m.delta})`
                  )}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {watch.length > 0 && (
        <Card className="overflow-hidden">
          <SectionTitle
            title="À surveiller"
            subtitle="Moins nets, à confirmer sur quelques jours"
          />
          <ul className="divide-y divide-slate-200">
            {watch.map(({ r, s }) => (
              <ProductRow key={s.domain + r.handle} r={r} domain={s.domain} />
            ))}
          </ul>
        </Card>
      )}

      {fresh.length > 0 && (
        <Card className="overflow-hidden">
          <SectionTitle
            title="Nouveautés des concurrents"
            subtitle="En ligne depuis moins de 7 jours — celles qui vendent déjà sont en tête"
          />
          <ul className="divide-y divide-slate-200">
            {fresh.map(({ r, s }) => (
              <li
                key={s.domain + r.handle}
                className="px-4 sm:px-5 py-3 flex items-center gap-3"
              >
                {r.selling ? (
                  <Rank n={r.rank} />
                ) : (
                  <span className="grid place-items-center w-8 h-8 shrink-0 rounded-lg border border-dashed border-slate-300 text-slate-300 text-xs">
                    —
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-slate-900 hover:text-indigo-600 hover:underline block truncate"
                  >
                    {r.title}
                  </a>
                  <p className="text-xs mt-0.5 truncate">
                    <span className="text-slate-400">
                      {s.domain} · il y a {jours(r.age_days)} ·{" "}
                    </span>
                    {r.selling ? (
                      <span className="text-emerald-600 font-medium">
                        déjà {r.rank}
                        <sup>{r.rank === 1 ? "er" : "e"}</sup> des ventes
                      </span>
                    ) : r.selling === null ? (
                      <span className="text-slate-400">classement non fiable</span>
                    ) : (
                      <span className="text-slate-400">pas encore de vente</span>
                    )}
                  </p>
                </div>
                <span className="text-sm tabular-nums text-slate-700 shrink-0">
                  {euro(r.price)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---- Détail par site, avec la fiabilité affichée honnêtement ---- */}
      <Card className="overflow-hidden">
        <SectionTitle title="Détail par site" />
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
                <span className="text-xs tabular-nums text-slate-500 shrink-0">
                  {s.error ? "—" : `${s.n_products} produits`}
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
      </Card>

      <p className="text-xs text-slate-400 leading-relaxed">
        Méthode : Shopify trie <code>?sort_by=best-selling</code> par unités
        vendues sur une fenêtre glissante d&apos;environ 30 jours. Les produits
        sans aucune vente ne peuvent pas être départagés et retombent en ordre de
        date de création — c&apos;est cette rupture qui permet de savoir qui a
        vendu. Le classement reste <strong>ordinal</strong> : il dit qui vend, pas
        combien. Scan du {radar.generated_at.replace("T", " à ")}.
      </p>
    </div>
  );
}
