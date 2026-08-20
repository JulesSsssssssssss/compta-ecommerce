"use client";

import { useState, useTransition } from "react";
import { syncShopifyMonth, type SyncResult } from "@/lib/actions";

export function ShopifySync({
  year,
  month,
  configured,
}: {
  year: number;
  month: number;
  configured: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SyncResult | null>(null);

  const run = () => {
    setResult(null);
    startTransition(async () => {
      const r = await syncShopifyMonth(year, month);
      setResult(r);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={run}
        disabled={pending || !configured}
        title={
          configured
            ? "Récupère commandes et CA du mois depuis Shopify"
            : "Shopify pas encore connecté"
        }
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? (
          <>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            Synchronisation…
          </>
        ) : (
          <>↻ Synchroniser depuis Shopify</>
        )}
      </button>
      {result && (
        <span
          className={`text-sm ${result.ok ? "text-emerald-600" : "text-red-600"}`}
        >
          {result.message}
        </span>
      )}
      {!configured && !result && (
        <span className="text-xs text-slate-400">
          (bientôt : connexion Shopify à activer)
        </span>
      )}
    </div>
  );
}
