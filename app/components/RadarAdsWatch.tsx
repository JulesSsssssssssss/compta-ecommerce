"use client";

import { useState, useTransition } from "react";
import { askAdWatch } from "@/lib/radar-ads-actions";
import type { AdSession } from "@/lib/radar-ads";

/** "2026-10-11T16:33:00Z" -> "11/10 à 18:33", à l'heure de Paris. */
const when = (iso: string) =>
  new Date(iso)
    .toLocaleString("fr-FR", {
      timeZone: "Europe/Paris",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(" ", " à ");

/**
 * Bouton « Lancer une veille TikTok » et l'état de la dernière session.
 *
 * La veille fait défiler le fil TikTok du compte dans Chrome : elle ne peut
 * pas partir de ce serveur. Cliquer enregistre la demande ; une session Claude
 * la mène puis dépose les pubs trouvées.
 */
export function RadarAdsWatch({
  initial,
  minutes,
}: {
  initial: AdSession | null;
  /** Durée d'une session, affichée sur le bouton. */
  minutes: number;
}) {
  const [session, setSession] = useState(initial);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ask = () => {
    setFailure(null);
    startTransition(async () => {
      try {
        setSession(await askAdWatch());
      } catch {
        setFailure("La demande n'a pas pu être enregistrée.");
      }
    });
  };

  const open = session?.status === "pending" || session?.status === "running";
  return (
    <div className="w-full sm:w-72 shrink-0">
      <button
        onClick={ask}
        disabled={pending || open}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending
          ? "Enregistrement…"
          : session?.status === "running"
            ? "Veille TikTok en cours…"
            : session?.status === "pending"
              ? "Veille TikTok demandée"
              : `Lancer une veille TikTok · ${minutes} min`}
      </button>
      {session && (
        <p className="mt-1.5 text-xs text-slate-500">
          {session.status === "pending" ? (
            <>
              Demandée le {when(session.requestedAt)} — elle démarre à la
              prochaine session Claude, avec Chrome connecté à TikTok.
            </>
          ) : session.status === "running" ? (
            <>
              Commencée le {when(session.startedAt ?? session.requestedAt)} —
              les pubs s&apos;ajoutent à la liste au fil du défilement.
            </>
          ) : (
            <>
              Dernière veille le {when(session.doneAt ?? session.requestedAt)}
              {session.stats.kept != null &&
                ` — ${session.stats.kept} pub${session.stats.kept > 1 ? "s" : ""} retenue${session.stats.kept > 1 ? "s" : ""}`}
              {session.stats.ads != null && ` sur ${session.stats.ads} vue${session.stats.ads > 1 ? "s" : ""}`}
              .
            </>
          )}
        </p>
      )}
      {failure && <p className="mt-1.5 text-xs text-red-600">{failure}</p>}
    </div>
  );
}
