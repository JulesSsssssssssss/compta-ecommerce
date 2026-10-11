import Link from "next/link";
import { Card, StatCard } from "@/app/components/ui";
import { RadarAdsWatch } from "@/app/components/RadarAdsWatch";
import {
  SESSION_MINUTES,
  loadAds,
  loadSessions,
  type AdCrea,
  type AdProduct,
} from "@/lib/radar-ads";
import { loadDemand, type DemandVideo } from "@/lib/radar-demand";

// Les pubs arrivent pendant qu'une veille tourne : la page doit les montrer
// dès qu'elles sont déposées.
export const dynamic = "force-dynamic";

/** À partir de combien de jours une pub « tourne » : une boutique coupe en
 *  deux ou trois jours une créa qui ne vend pas. */
const RUNNING_DAYS = 3;

const outside = { target: "_blank", rel: "noopener noreferrer" } as const;

const euro = (p: string | null) => {
  if (p == null) return null;
  const n = Number(p.replace(",", "."));
  return Number.isFinite(n) ? `${n.toFixed(2).replace(".", ",")} €` : p;
};

/** "2026-10-11…" -> "11/10" */
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const jours = (n: number) => (n <= 0 ? "aujourd'hui" : n === 1 ? "1 jour" : `${n} jours`);

const count = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace(".0", "")} M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1).replace(".0", "")} k`
      : String(n);

function Crea({ c }: { c: AdCrea }) {
  return (
    <li className="text-xs">
      <p className="text-slate-500">
        <a href={c.videoUrl} {...outside} className="font-medium text-indigo-600 hover:underline">
          ▶ {c.advertiser}
        </a>
        {[
          c.postedAt ? `en ligne depuis le ${day(c.postedAt)}` : null,
          c.likes != null ? `${count(c.likes)} likes` : null,
          c.seen > 1 ? `vue ${c.seen} fois` : null,
          c.cta ? `bouton « ${c.cta} »` : null,
        ]
          .filter(Boolean)
          .map((s) => ` · ${s}`)
          .join("")}
      </p>
      {c.caption && <p className="mt-0.5 text-slate-600 leading-snug line-clamp-2">{c.caption}</p>}
      {c.note && <p className="mt-0.5 text-amber-600">{c.note}</p>}
    </li>
  );
}

function Product({ p }: { p: AdProduct }) {
  const running = p.runningDays >= RUNNING_DAYS;
  return (
    <li className="px-4 sm:px-5 py-4 flex gap-3 sm:gap-4">
      <a
        href={p.url}
        {...outside}
        className="block w-16 sm:w-20 shrink-0 self-start aspect-[3/4] rounded-lg overflow-hidden bg-slate-100 ring-1 ring-slate-200 hover:ring-indigo-400"
      >
        {p.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image} alt={p.title} loading="lazy" className="w-full h-full object-cover" />
        ) : null}
      </a>
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <a
              href={p.url}
              {...outside}
              className="text-sm font-semibold text-slate-900 hover:text-indigo-600 hover:underline truncate"
            >
              {p.title}
            </a>
            {euro(p.price) && (
              <span className="text-sm tabular-nums text-slate-700 shrink-0">{euro(p.price)}</span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {p.domain}
            {p.kind ? ` · ${p.kind}` : ""}
          </p>
        </div>
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          <span
            className={`rounded-full px-2 py-0.5 font-medium ${
              running ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
            }`}
            title={`Première trace le ${day(p.since)}, dernière apparition le ${day(p.lastSeen)}`}
          >
            {p.runningDays <= 0 ? "repérée le jour de sa mise en ligne" : `tourne depuis ${jours(p.runningDays)}`}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
            vue {p.days.length} jour{p.days.length > 1 ? "s" : ""} différent{p.days.length > 1 ? "s" : ""}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
            {p.creas.length} créa{p.creas.length > 1 ? "s" : ""}
          </span>
          <span className="text-slate-400">dernière vue le {day(p.lastSeen)}</span>
        </p>
        <ul className="space-y-1.5 rounded-lg bg-slate-50 px-3 py-2.5">
          {p.creas.map((c) => (
            <Crea key={c.id} c={c} />
          ))}
        </ul>
      </div>
    </li>
  );
}

/** Une demande nette : assez de questions pour ne pas tenir à une seule cliente. */
const STRONG_ASKS = 8;

function Demand({ v }: { v: DemandVideo }) {
  const strong = v.asks >= STRONG_ASKS;
  const first = v.history[0];
  const grown = v.history.length > 1 && first ? v.asks - first.asks : 0;
  return (
    <li className="px-4 sm:px-5 py-4 flex gap-3 sm:gap-4">
      <a
        href={v.videoUrl}
        {...outside}
        className="block w-16 sm:w-20 shrink-0 self-start aspect-[3/4] rounded-lg overflow-hidden bg-slate-100 ring-1 ring-slate-200 hover:ring-indigo-400"
      >
        {v.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.image} alt={v.creator} loading="lazy" className="w-full h-full object-cover" />
        ) : null}
      </a>
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <a
            href={v.videoUrl}
            {...outside}
            className="text-sm font-semibold text-slate-900 hover:text-indigo-600 hover:underline"
          >
            ▶ {v.creator}
          </a>
          <p className="text-xs text-slate-400 mt-0.5">
            {[
              v.kind,
              v.postedAt ? `en ligne depuis le ${day(v.postedAt)}` : null,
              v.plays != null ? `${count(v.plays)} vues` : null,
              v.likes != null ? `${count(v.likes)} likes` : null,
              v.comments != null ? `${count(v.comments)} commentaires` : null,
              v.saves != null ? `${count(v.saves)} enregistrements` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          <span
            className={`rounded-full px-2 py-0.5 font-medium ${
              strong ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
            }`}
            title={`${v.sampled} commentaires lus sur ${v.comments ?? "?"}`}
          >
            {v.asks} demande{v.asks > 1 ? "s" : ""} sur {v.sampled} commentaires lus
          </span>
          {v.askLikes > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
              {count(v.askLikes)} likes sur ces demandes
            </span>
          )}
          {v.wants > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
              {v.wants} « il me la faut »
            </span>
          )}
          {v.dance && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">danse / trend</span>
          )}
          {grown > 0 && first && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
              +{grown} depuis le {day(first.day)}
            </span>
          )}
        </p>
        {v.caption && <p className="text-xs text-slate-600 leading-snug line-clamp-2">{v.caption}</p>}
        {v.quotes.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
            {v.quotes.map((q, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-words">« {q.t} »</span>
                {q.l > 0 && (
                  <span className="shrink-0 tabular-nums text-slate-400">{count(q.l)} ♥</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {v.creatorNote && (
          <p className="text-xs text-amber-600 leading-snug line-clamp-2">
            Réponse de la créatrice : {v.creatorNote}
          </p>
        )}
      </div>
    </li>
  );
}

export default async function RadarTiktokPage() {
  const [products, sessions, demand] = await Promise.all([
    loadAds(),
    loadSessions(),
    loadDemand(),
  ]);
  const creas = products.reduce((n, p) => n + p.creas.length, 0);
  const running = products.filter((p) => p.runningDays >= RUNNING_DAYS).length;
  const shops = new Set(products.map((p) => p.domain)).size;
  const done = sessions.filter((s) => s.status === "done");

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <Link href="/radar" className="text-xs font-medium text-slate-500 hover:text-indigo-600">
          ← Radar concurrents
        </Link>
        <div className="mt-2 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
              Pubs TikTok <span className="text-slate-400 font-normal">· mode femme</span>
            </h1>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              Les publicités de boutiques de vêtements pour femme croisées dans ton fil TikTok, avec
              le produit vendu et la vidéo qui le pousse. Une pub encore diffusée plusieurs jours
              après sa mise en ligne est une pub qui rapporte.
            </p>
          </div>
          <RadarAdsWatch initial={sessions[0] ?? null} minutes={SESSION_MINUTES} />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label={`Tournent depuis ${RUNNING_DAYS} j ou plus`}
          value={String(running)}
          tone={running > 0 ? "brand" : "neutral"}
        />
        <StatCard label="Produits repérés" value={String(products.length)} />
        <StatCard label="Créas" value={String(creas)} />
        <StatCard label="Boutiques" value={String(shops)} />
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Produits poussés en pub</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Ceux revus sur le plus de jours d&apos;abord, puis ceux dont la pub tourne depuis le
            plus longtemps
          </p>
        </div>
        {products.length === 0 ? (
          <p className="px-5 py-10 text-sm text-slate-400 text-center">
            Aucune pub relevée pour l&apos;instant. Lance une veille : les pubs s&apos;ajoutent ici
            au fil du défilement.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {products.map((p) => (
              <Product key={p.key} p={p} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Demande dans les commentaires</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Des vidéos de tenues, hors pub, où l&apos;on demande d&apos;où vient la pièce — celles
            qui reçoivent le plus de demandes d&apos;abord
          </p>
        </div>
        {demand.length === 0 ? (
          <p className="px-5 py-10 text-sm text-slate-400 text-center">
            Aucune demande relevée pour l&apos;instant. Elle se relève avec la veille.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {demand.map((v) => (
              <Demand key={v.id} v={v} />
            ))}
          </ul>
        )}
      </Card>

      {done.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Dernières veilles</h2>
          </div>
          <ul className="divide-y divide-slate-200">
            {done.map((s) => (
              <li key={s.id} className="px-4 sm:px-5 py-3 text-xs text-slate-500">
                <span className="font-medium text-slate-700">{day(s.doneAt ?? s.requestedAt)}</span>
                {[
                  s.stats.minutes != null ? `${s.stats.minutes} min` : null,
                  s.stats.videos != null ? `${s.stats.videos} vidéos défilées` : null,
                  s.stats.ads != null ? `${s.stats.ads} pubs` : null,
                  s.stats.kept != null ? `${s.stats.kept} retenues` : null,
                  s.stats.carts != null ? `${s.stats.carts} ajouts au panier` : null,
                ]
                  .filter(Boolean)
                  .map((t) => ` · ${t}`)
                  .join("")}
                {s.stats.note && <p className="mt-0.5 text-amber-600">{s.stats.note}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="text-xs text-slate-400 leading-relaxed">
        <p>
          Une veille dure {SESSION_MINUTES} minutes : Claude fait défiler le fil « Pour toi » de ton
          compte dans Chrome, ouvre chaque pub, ne garde que les boutiques de mode femme, puis
          ajoute le produit au panier et quitte la page — sans jamais aller au paiement — pour que
          TikTok serve davantage de pubs de ce type.
        </p>
        <details className="mt-1.5">
          <summary className="cursor-pointer hover:text-slate-600 transition-colors">
            Comment lire « demandes »
          </summary>
          <p className="mt-1.5">
            Claude cherche des vidéos de tenues de moins de deux mois et lit jusqu&apos;à 150
            commentaires de chacune. Une demande est un commentaire qui pose la question : « elle
            vient d&apos;où la robe ? », « la ref svp », « le haut ?? ». TikTok ne sert qu&apos;une
            partie des commentaires, le compte est donc un minimum. Le relevé lit le texte, pas
            l&apos;image : « danse / trend » vient de la légende et du son.
          </p>
        </details>
        <details className="mt-1.5">
          <summary className="cursor-pointer hover:text-slate-600 transition-colors">
            Comment lire « tourne depuis »
          </summary>
          <p className="mt-1.5">
            La date de mise en ligne d&apos;une vidéo est inscrite dans son identifiant TikTok.
            « Tourne depuis » compte les jours entre la plus ancienne créa du produit et sa
            dernière apparition dans le fil. « Vue N jours différents » est ce qui a été constaté
            directement, veille après veille : c&apos;est le signal le plus sûr, et il ne se
            construit qu&apos;avec une veille par jour.
          </p>
        </details>
      </div>
    </div>
  );
}
