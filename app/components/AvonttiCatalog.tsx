"use client";

import { useMemo, useState } from "react";

export type CatalogRow = {
  t: string;
  h: string;
  sold: number;
  ca: number;
  /** Unités par jour depuis la mise en ligne. */
  v: number;
  price: number;
  cap: number;
  disc: number;
  nv: number;
  col: string;
  pub: string;
};

type Key = keyof Omit<CatalogRow, "h">;

const COLS: { k: Key; label: string; num?: boolean }[] = [
  { k: "t", label: "Produit" },
  { k: "sold", label: "Unités", num: true },
  { k: "ca", label: "CA est.", num: true },
  { k: "v", label: "U/jour", num: true },
  { k: "price", label: "Prix", num: true },
  { k: "cap", label: "Barré", num: true },
  { k: "disc", label: "Remise", num: true },
  { k: "nv", label: "Variantes", num: true },
  { k: "col", label: "Rayon" },
  { k: "pub", label: "En ligne" },
];

const fmt = (n: number) => n.toLocaleString("fr-FR");
const eur = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

/** Catalogue complet, triable par colonne, filtrable. */
export function AvonttiCatalog({ rows, newSince }: { rows: CatalogRow[]; newSince: string }) {
  const [key, setKey] = useState<Key>("sold");
  const [dir, setDir] = useState(-1);
  const [filter, setFilter] = useState<"all" | "sold" | "new">("all");

  const shown = useMemo(() => {
    let list = rows;
    if (filter === "sold") list = list.filter((r) => r.sold > 0);
    if (filter === "new") list = list.filter((r) => r.pub >= newSince);
    return [...list].sort((a, b) => {
      const x = a[key];
      const y = b[key];
      return (typeof x === "string" ? x.localeCompare(String(y), "fr") : x - Number(y)) * dir;
    });
  }, [rows, key, dir, filter]);

  const sortBy = (k: Key) => {
    if (k === key) setDir(-dir);
    else {
      setKey(k);
      setDir(k === "t" || k === "col" ? 1 : -1);
    }
  };

  const tabs: [typeof filter, string][] = [
    ["all", `Les ${rows.length}`],
    ["sold", "Ont vendu"],
    ["new", "Sortis ce mois-ci"],
  ];

  return (
    <div>
      <div className="px-4 sm:px-5 py-3 flex flex-wrap gap-2 border-b border-slate-200">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              filter === k
                ? "bg-indigo-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60">
              {COLS.map((c) => (
                <th
                  key={c.k}
                  aria-sort={key === c.k ? (dir === 1 ? "ascending" : "descending") : undefined}
                  className={`px-3 py-2 text-[11px] font-medium uppercase tracking-wider whitespace-nowrap ${
                    c.num ? "text-right" : "text-left"
                  } ${key === c.k ? "text-indigo-600" : "text-slate-500"}`}
                >
                  <button type="button" onClick={() => sortBy(c.k)} className="uppercase hover:text-slate-900">
                    {c.label}
                    {key === c.k ? (dir === 1 ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((r) => (
              <tr key={r.h} className="hover:bg-slate-50">
                <td className="px-3 py-2 min-w-[230px]">
                  <a
                    href={`https://avontti.com/fr-fr/products/${encodeURIComponent(r.h)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-slate-900 hover:text-indigo-600 hover:underline"
                  >
                    {r.t}
                  </a>
                  {r.sold > 100 && (
                    <span className="ml-1.5 rounded-full bg-orange-50 px-1.5 py-px text-[10px] font-medium text-orange-700">
                      best-seller
                    </span>
                  )}
                  {r.pub >= newSince && (
                    <span className="ml-1.5 rounded-full bg-emerald-50 px-1.5 py-px text-[10px] font-medium text-emerald-700">
                      nouveau
                    </span>
                  )}
                </td>
                <Num v={r.sold} text={fmt(r.sold)} />
                <Num v={r.ca} text={fmt(r.ca)} />
                <Num v={r.v} text={r.v.toFixed(2).replace(".", ",")} />
                <Num v={1} text={eur(r.price)} />
                <Num v={r.cap} text={eur(r.cap)} />
                <Num v={r.disc} text={`−${r.disc} %`} tone="text-orange-700 font-medium" />
                <Num v={1} text={String(r.nv)} />
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.col}</td>
                <td className="px-3 py-2 text-slate-500 tabular-nums whitespace-nowrap">{r.pub || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Num({ v, text, tone = "text-slate-700" }: { v: number; text: string; tone?: string }) {
  return (
    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${v ? tone : "text-slate-300"}`}>
      {v ? text : "—"}
    </td>
  );
}
