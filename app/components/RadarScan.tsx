"use client";

import { useState, useTransition } from "react";
import { startRadarScan, stepRadarScan, type ScanState } from "@/lib/radar-run";

/**
 * Bouton « Lancer un scan » et sa barre de progression.
 *
 * Le scan avance boutique par boutique : chaque étape est un aller-retour
 * serveur, ce qui permet d'afficher une progression réelle — la barre ne bouge
 * que quand un site est effectivement scanné, jamais « à l'estime ».
 */
export function RadarScan() {
  const [state, setState] = useState<ScanState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () => {
    setFailure(null);
    startTransition(async () => {
      try {
        let s = await startRadarScan();
        setState(s);
        // Une étape = une boutique. On enchaîne tant que le serveur dit qu'il
        // reste du travail, avec une borne dure : une étape qui n'avancerait
        // pas ferait tourner cette boucle indéfiniment.
        for (let i = 0; s.status === "running" && i <= s.total + 1; i++) {
          s = await stepRadarScan(s.id);
          setState(s);
        }
      } catch (e) {
        setFailure(e instanceof Error ? e.message : "le scan a échoué");
      }
    });
  };

  const total = state?.total ?? 0;
  const done = state?.done ?? 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="w-full sm:w-72 shrink-0">
      <button
        onClick={run}
        disabled={pending}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? (
          <>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Scan en cours…
          </>
        ) : (
          <>
            <span aria-hidden>↻</span> Lancer un scan
          </>
        )}
      </button>

      {state && total > 0 && (
        <div className="mt-2.5">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Avancement du scan"
          >
            <div
              className="h-full rounded-full bg-indigo-600 transition-[width] duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-500 tabular-nums">
            {state.status === "running" ? (
              <>
                {done}/{total} boutiques
                {state.current && ` · ${state.current}`}
              </>
            ) : state.status === "done" ? (
              <>
                Scan terminé — {total} boutique{total > 1 ? "s" : ""}
                {state.failed > 0 &&
                  `, ${state.failed} injoignable${state.failed > 1 ? "s" : ""}`}
              </>
            ) : (
              <span className="text-red-600">{state.error}</span>
            )}
          </p>
        </div>
      )}

      {failure && <p className="mt-2 text-xs text-red-600">{failure}</p>}
    </div>
  );
}
