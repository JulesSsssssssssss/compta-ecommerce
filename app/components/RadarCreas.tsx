"use client";

import { useState, useTransition } from "react";
import { askDeepSearch, openCreas } from "@/lib/radar-creas-actions";
import {
  brandFromDomain,
  tiktokAdsUrl,
  tiktokSearchUrl,
  type Creas,
} from "@/lib/radar-creas";
import type { Deep } from "@/lib/radar-deep";

/** Nombre de vignettes montrées par produit ; le reste est annoncé. */
const CREAS_MAX = 4;

const link = "text-indigo-600 hover:underline";
const outside = { target: "_blank", rel: "noopener noreferrer" } as const;

const count = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace(".0", "")} M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1).replace(".0", "")} k`
      : String(n);

/** "2026-10-11T16:33:00Z" ou "2026-10-11" -> "11/10" */
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Avec l'année : les vidéos retenues s'étalent souvent sur plus d'un an. */
const fullDay = (iso: string) => `${day(iso)}/${iso.slice(2, 4)}`;

/** 2300000 -> "2 300 000". Écrit à la main : le serveur et le navigateur
 *  doivent rendre exactement la même chaîne. */
const exact = (n: number) =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, "\u202f");

/**
 * Le Top 5 d'une recherche approfondie : une ligne de chiffres par vidéo, puis
 * ce qu'elle est pour ce produit. En version `compact`, sous la ligne d'un
 * produit, le détail de ce qu'il faut en reprendre reste dans le « + ».
 */
export function DeepPicks({ deep, compact = false }: { deep: Deep; compact?: boolean }) {
  const num = "py-0.5 pl-3 text-right tabular-nums whitespace-nowrap";
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-slate-700">
        Top {deep.picks.length} des vidéos à plus fort potentiel
        {deep.doneAt && (
          <span className="font-normal text-slate-400">
            {" "}
            · recherche du {day(deep.doneAt)}
          </span>
        )}
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-400">
            <th />
            <th className="py-0.5 text-left font-normal">Vidéo</th>
            <th className={`${num} font-normal`}>Vues</th>
            <th className={`${num} font-normal`}>Likes</th>
            <th className={`${num} font-normal`}>Date</th>
          </tr>
        </thead>
        {deep.picks.map((p, i) => (
          <tbody key={p.url} className="align-top">
            <tr>
              <td className="py-0.5 pr-2 text-slate-400 tabular-nums">{i + 1}</td>
              <td className="py-0.5 max-w-0 w-full truncate">
                <a href={p.url} {...outside} className={`${link} font-medium`}>
                  {p.creator}
                </a>
              </td>
              <td className={`${num} text-slate-700`}>
                {p.views != null ? exact(p.views) : "—"}
              </td>
              <td className={`${num} text-slate-700`}>
                {p.likes != null ? exact(p.likes) : "—"}
              </td>
              <td className={`${num} text-slate-400`}>
                {p.date ? fullDay(p.date) : "—"}
              </td>
            </tr>
            {(p.label || !compact) && (
              <tr>
                <td />
                <td colSpan={4} className="pb-1.5 leading-snug">
                  {p.label && <span className="text-slate-500">{p.label}</span>}
                  {!compact && (
                    <span className="block text-slate-600">{p.why}</span>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        ))}
      </table>
      {!compact && deep.note && <p className="text-xs text-amber-600">{deep.note}</p>}
    </div>
  );
}

/**
 * La recherche approfondie d'un produit : le bouton qui la demande, puis le
 * Top 5 une fois qu'elle a été traitée. Elle passe par un navigateur connecté
 * à TikTok, donc pas par ce serveur : cliquer enregistre la demande.
 */
function DeepSearch({
  url,
  title,
  domain,
  initial,
}: {
  url: string;
  title: string;
  domain: string;
  initial: Deep | null;
}) {
  const [deep, setDeep] = useState(initial);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ask = () => {
    setFailure(null);
    startTransition(async () => {
      try {
        setDeep(await askDeepSearch(url, title, domain));
      } catch {
        setFailure("La demande n'a pas pu être enregistrée.");
      }
    });
  };

  const waiting = deep?.status === "pending";
  return (
    <div className="space-y-2">
      {deep && deep.picks.length > 0 && <DeepPicks deep={deep} />}
      {deep?.status === "done" && deep.picks.length === 0 && (
        <p className="text-xs text-slate-400">
          Recherche du {deep.doneAt ? day(deep.doneAt) : "—"} : aucune vidéo
          exploitable trouvée.{deep.note ? ` ${deep.note}` : ""}
        </p>
      )}
      {waiting ? (
        <p className="text-xs text-slate-500">
          Recherche approfondie demandée le {day(deep.requestedAt)} — elle sera
          faite à la prochaine session Claude, avec Chrome connecté à TikTok.
        </p>
      ) : (
        <button
          onClick={ask}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending
            ? "Enregistrement…"
            : deep
              ? "Relancer la recherche approfondie"
              : "Recherche approfondie · Top 5 des UGC"}
        </button>
      )}
      {failure && <p className="text-xs text-red-600">{failure}</p>}
    </div>
  );
}

/**
 * Les créas d'un produit : les vidéos que la boutique affiche sur sa fiche, de
 * quoi les recouper sur TikTok, et la recherche approfondie.
 */
export function CreasView({
  url,
  title,
  domain,
  creas,
  deep,
}: {
  url: string;
  title: string;
  domain: string;
  creas: Creas;
  deep: Deep | null;
}) {
  const brand = brandFromDomain(domain);
  const shown = creas.videos.slice(0, CREAS_MAX);
  const hidden = creas.videos.length - shown.length;
  const unchecked = !creas.checked && creas.videos.length > 0;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-700">
        {creas.error
          ? "Créas : fiche illisible pour l'instant"
          : creas.videos.length === 0
            ? "Aucune vidéo sur la fiche"
            : `${creas.videos.length} vidéo${creas.videos.length > 1 ? "s" : ""} sur la fiche`}
      </p>
      {shown.length > 0 && (
        <ul className="flex gap-1.5">
          {shown.map((v, i) => (
            <li key={v.src} className="w-12 shrink-0">
              <a
                href={v.src}
                {...outside}
                title={`Ouvrir la vidéo ${i + 1}`}
                className="block aspect-[9/16] rounded-md overflow-hidden bg-slate-100 ring-1 ring-slate-200 hover:ring-indigo-400"
              >
                {v.poster ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={v.poster}
                    alt={`Vidéo ${i + 1} de la fiche`}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="grid place-items-center w-full h-full text-xs text-slate-400">
                    ▶
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
      {(hidden > 0 || creas.shared > 0 || unchecked) && (
        <p className="text-xs text-slate-400">
          {[
            hidden > 0 ? `${hidden} de plus sur la fiche` : null,
            creas.shared > 0
              ? `${creas.shared} vidéo${creas.shared > 1 ? "s" : ""} de marque écartée${creas.shared > 1 ? "s" : ""} (sur toutes les fiches)`
              : null,
            unchecked
              ? "non comparé aux autres fiches : peut inclure des vidéos de marque"
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <p className="text-xs text-slate-400">
        {creas.videos.length > 0 ? "À recouper" : "À chercher"} sur TikTok :{" "}
        <a href={tiktokSearchUrl(`${brand} ${title}`)} {...outside} className={link}>
          vidéos du produit
        </a>
        {" · "}
        <a href={tiktokAdsUrl(brand)} {...outside} className={link}>
          pubs de la boutique
        </a>
        {creas.tiktok && (
          <>
            {" · "}
            <a href={creas.tiktok} {...outside} className={link}>
              compte de la boutique
            </a>
          </>
        )}
      </p>
      <DeepSearch url={url} title={title} domain={domain} initial={deep} />
    </div>
  );
}

/**
 * Le « + » d'une ligne de produit : il déplie ses créas. La fiche n'est lue
 * qu'au clic — la page liste des dizaines de produits, on ne va pas toutes les
 * chercher pour rien.
 */
export function CreasToggle({
  url,
  title,
  domain,
  deep = null,
}: {
  url: string;
  title: string;
  domain: string;
  /** Recherche approfondie déjà traitée : son Top 5 se montre sans cliquer. */
  deep?: Deep | null;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ creas: Creas; deep: Deep | null } | null>(null);
  const [failure, setFailure] = useState(false);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next || data) return;
    setFailure(false);
    startTransition(async () => {
      try {
        setData(await openCreas(url));
      } catch {
        setFailure(true);
      }
    });
  };

  return (
    <div className="mt-1.5">
      <button
        onClick={toggle}
        aria-expanded={open}
        title={open ? "Replier les créas" : "Voir les vidéos de ce produit"}
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-xs text-slate-500 transition-colors hover:border-indigo-300 hover:text-indigo-600"
      >
        <span aria-hidden className="font-semibold leading-none">
          {open ? "−" : "+"}
        </span>
        créas
      </button>
      {!open && deep && (
        <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2.5">
          <DeepPicks deep={data?.deep?.picks.length ? data.deep : deep} compact />
        </div>
      )}
      {open && (
        <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2.5">
          {pending && !data ? (
            <p className="text-xs text-slate-400">Lecture de la fiche…</p>
          ) : failure || !data ? (
            <p className="text-xs text-red-600">
              La fiche n&apos;a pas pu être lue. Replie puis rouvre pour réessayer.
            </p>
          ) : (
            <CreasView
              url={url}
              title={title}
              domain={domain}
              creas={data.creas}
              deep={data.deep}
            />
          )}
        </div>
      )}
    </div>
  );
}
