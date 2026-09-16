"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAvonttiScan } from "@/lib/avontti-actions";
import { collectorBookmarklet, collectorScript } from "@/lib/avontti-collector";

/** Origines depuis lesquelles un relevé est accepté. */
const AVONTTI = /^https:\/\/([a-z0-9-]+\.)*avontti\.com$/;

type Status =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "saving" }
  | { kind: "saved"; products: number; variants: number }
  | { kind: "error"; error: string };

/**
 * Lancement du scan Avontti et réception du relevé.
 *
 * avontti.com refuse toute requête qui ne vient pas d'un vrai navigateur
 * (challenge Cloudflare) : le scan tourne donc sur le site, via un favori ou
 * la console, et renvoie son relevé à cette page, ouverte dans une fenêtre à
 * part. Le collage manuel reste possible si la fenêtre n'a pas pu s'ouvrir.
 */
export function AvonttiScan({ handles }: { handles: string[] }) {
  const router = useRouter();
  const link = useRef<HTMLAnchorElement>(null);
  const [origin, setOrigin] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState("");
  const [, startTransition] = useTransition();

  const save = (json: string, reply?: (msg: object) => void) => {
    setStatus({ kind: "saving" });
    startTransition(async () => {
      const res = await saveAvonttiScan(json).catch((e: unknown) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : "enregistrement impossible",
      }));
      reply?.(res);
      if (res.ok) {
        setStatus({ kind: "saved", products: res.products, variants: res.variants });
        setPaste("");
        router.refresh();
      } else {
        setStatus({ kind: "error", error: res.error });
      }
    });
  };

  useEffect(() => {
    setOrigin(window.location.origin);
    const receiving = new URLSearchParams(window.location.search).has("recevoir");
    if (receiving) setStatus({ kind: "waiting" });

    let handled = false;
    const onMessage = (ev: MessageEvent) => {
      if (!AVONTTI.test(ev.origin)) return;
      const data = ev.data as { type?: string; json?: string } | null;
      if (data?.type !== "avontti-scan" || typeof data.json !== "string") return;
      const source = ev.source as Window | null;
      // Le collecteur renvoie son relevé chaque seconde jusqu'à l'accusé de
      // réception : on n'enregistre que le premier.
      if (handled) return;
      handled = true;
      save(data.json, (msg) =>
        source?.postMessage({ type: "avontti-ack", ...msg }, ev.origin),
      );
    };
    window.addEventListener("message", onMessage);
    // Signale au collecteur que la page est prête à recevoir.
    if (receiving && window.opener) {
      try {
        (window.opener as Window).postMessage({ type: "avontti-ready" }, "*");
      } catch {
        // Fenêtre d'origine fermée ou isolée : le collage manuel prend le relais.
      }
    }
    return () => window.removeEventListener("message", onMessage);
    // save ne change pas de comportement d'un rendu à l'autre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React refuse les URL javascript: dans href : on les pose à la main.
  useEffect(() => {
    if (origin && link.current) {
      link.current.setAttribute("href", collectorBookmarklet(origin, handles));
    }
  }, [origin, handles]);

  const copyScript = async () => {
    await navigator.clipboard.writeText(collectorScript(origin, handles));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="w-full lg:w-[26rem] shrink-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">Lancer un scan</h2>
        <a
          href="https://avontti.com/fr-fr"
          target="avontti"
          className="text-xs font-medium text-indigo-600 hover:underline"
        >
          Ouvrir avontti.com ↗
        </a>
      </div>
      <ol className="mt-3 space-y-2 text-xs text-slate-600 list-decimal pl-4">
        <li>
          Glisse ce bouton dans ta barre de favoris (une seule fois) :{" "}
          <a
            ref={link}
            onClick={(e) => e.preventDefault()}
            className="ml-1 inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 font-medium text-white cursor-grab"
            title="À glisser dans la barre de favoris, pas à cliquer ici"
          >
            ↻ Scanner Avontti
          </a>
        </li>
        <li>Ouvre avontti.com et clique sur le favori.</li>
        <li>
          Le scan lit toutes les fiches (≈ 1 min) et renvoie le relevé ici,
          dans une nouvelle fenêtre.
        </li>
      </ol>
      <p className="mt-2 text-[11px] text-slate-400">
        Pas de barre de favoris ?{" "}
        <button
          type="button"
          onClick={copyScript}
          disabled={!origin}
          className="font-medium text-indigo-600 hover:underline"
        >
          {copied ? "Script copié ✓" : "Copier le script"}
        </button>{" "}
        et colle-le dans la console (⌥⌘J) d&apos;un onglet avontti.com.
      </p>

      {status.kind !== "idle" && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-xs ${
            status.kind === "error"
              ? "bg-red-50 text-red-700"
              : status.kind === "saved"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-indigo-50 text-indigo-700"
          }`}
        >
          {status.kind === "waiting" && "En attente du relevé envoyé par avontti.com…"}
          {status.kind === "saving" && "Enregistrement du relevé…"}
          {status.kind === "saved" &&
            `Relevé enregistré — ${status.products} fiches, ${status.variants} variantes.`}
          {status.kind === "error" && status.error}
        </p>
      )}

      <details className="mt-3 group">
        <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-600">
          Coller un relevé à la main
        </summary>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={3}
          placeholder='{"v":1,"scanned_at":…}'
          className="mt-2 w-full rounded-lg border border-slate-300 px-2.5 py-2 font-mono text-[11px] outline-none focus:border-indigo-500"
        />
        <button
          type="button"
          disabled={!paste.trim() || status.kind === "saving"}
          onClick={() => save(paste)}
          className="mt-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          Enregistrer le relevé
        </button>
      </details>
    </div>
  );
}
