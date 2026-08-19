"use client";

import { useState } from "react";
import { saveDailyEntry, deleteDailyEntry } from "@/lib/actions";
import {
  formatEuro,
  formatPercent,
  formatRoas,
} from "@/lib/format";

export type ProductOption = { id: string; name: string; costPrice: number };

export type DayItem = { productId: string; quantity: number };

export type DayCell = {
  day: number;
  dateLabel: string;
  id: string | null;
  ordersCount: number;
  revenue: number;
  tiktokSpend: number;
  purchaseCost: number;
  margin: number;
  marginRate: number;
  roas: number;
  avgSellPrice: number;
  hasData: boolean;
  items: DayItem[];
};

export type MonthTotal = {
  ordersCount: number;
  revenue: number;
  tiktokSpend: number;
  purchaseCost: number;
  margin: number;
  marginRate: number;
  roas: number;
  avgSellPrice: number;
};

function signClass(v: number) {
  if (v > 0) return "text-emerald-600";
  if (v < 0) return "text-red-600";
  return "text-slate-400";
}

export function MonthTable({
  year,
  month,
  days,
  total,
  products,
}: {
  year: number;
  month: number;
  days: DayCell[];
  total: MonthTotal;
  products: ProductOption[];
}) {
  const [editing, setEditing] = useState<number | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50">
            <th className="px-3 py-3 font-medium">Date</th>
            <th className="px-3 py-3 font-medium text-right">Cmd.</th>
            <th className="px-3 py-3 font-medium text-right">CA</th>
            <th className="px-3 py-3 font-medium text-right">TikTok</th>
            <th className="px-3 py-3 font-medium text-right">Coût achat</th>
            <th className="px-3 py-3 font-medium text-right">Panier moy.</th>
            <th className="px-3 py-3 font-medium text-right">Marge %</th>
            <th className="px-3 py-3 font-medium text-right">Bénéfice net</th>
            <th className="px-3 py-3 font-medium text-right">ROAS</th>
            <th className="px-3 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {days.map((d) =>
            editing === d.day ? (
              <tr key={d.day} className="bg-brand-50/40">
                <td colSpan={10} className="px-3 py-4">
                  <DayEditor
                    year={year}
                    month={month}
                    day={d}
                    products={products}
                    onClose={() => setEditing(null)}
                  />
                </td>
              </tr>
            ) : (
              <tr
                key={d.day}
                className={`hover:bg-slate-50 ${d.hasData ? "" : "text-slate-400"}`}
              >
                <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                  {d.dateLabel}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {d.hasData ? d.ordersCount : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {d.hasData ? formatEuro(d.revenue) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                  {d.hasData ? formatEuro(d.tiktokSpend) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                  {d.hasData ? formatEuro(d.purchaseCost) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                  {d.hasData && d.ordersCount > 0 ? formatEuro(d.avgSellPrice) : "—"}
                </td>
                <td className={`px-3 py-2.5 text-right tabular-nums ${d.hasData ? signClass(d.margin) : ""}`}>
                  {d.hasData && d.revenue > 0 ? formatPercent(d.marginRate) : "—"}
                </td>
                <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${d.hasData ? signClass(d.margin) : ""}`}>
                  {d.hasData ? formatEuro(d.margin) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                  {d.hasData && d.tiktokSpend > 0 ? formatRoas(d.roas) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <button
                    onClick={() => setEditing(d.day)}
                    className="text-brand-600 hover:text-brand-700 text-xs font-medium"
                  >
                    {d.hasData ? "Modifier" : "Saisir"}
                  </button>
                  {d.hasData && d.id && (
                    <form
                      action={deleteDailyEntry}
                      className="inline"
                      onSubmit={(e) => {
                        if (!confirm(`Effacer la saisie du ${d.dateLabel} ?`))
                          e.preventDefault();
                      }}
                    >
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="year" value={year} />
                      <input type="hidden" name="month" value={month} />
                      <button className="ml-3 text-slate-400 hover:text-red-600 text-xs">
                        Effacer
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ),
          )}
        </tbody>
        <tfoot>
          <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
            <td className="px-3 py-3 whitespace-nowrap">Total du mois</td>
            <td className="px-3 py-3 text-right tabular-nums">
              {total.ordersCount}
            </td>
            <td className="px-3 py-3 text-right tabular-nums">
              {formatEuro(total.revenue)}
            </td>
            <td className="px-3 py-3 text-right tabular-nums text-slate-500">
              {formatEuro(total.tiktokSpend)}
            </td>
            <td className="px-3 py-3 text-right tabular-nums text-slate-500">
              {formatEuro(total.purchaseCost)}
            </td>
            <td className="px-3 py-3 text-right tabular-nums text-slate-500">
              {total.ordersCount > 0 ? formatEuro(total.avgSellPrice) : "—"}
            </td>
            <td className={`px-3 py-3 text-right tabular-nums ${signClass(total.margin)}`}>
              {total.revenue > 0 ? formatPercent(total.marginRate) : "—"}
            </td>
            <td className={`px-3 py-3 text-right tabular-nums ${signClass(total.margin)}`}>
              {formatEuro(total.margin)}
            </td>
            <td className="px-3 py-3 text-right tabular-nums text-slate-500">
              {total.tiktokSpend > 0 ? formatRoas(total.roas) : "—"}
            </td>
            <td className="px-3 py-3"></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

type Line = { key: number; productId: string; quantity: number };

function DayEditor({
  year,
  month,
  day,
  products,
  onClose,
}: {
  year: number;
  month: number;
  day: DayCell;
  products: ProductOption[];
  onClose: () => void;
}) {
  const costById = new Map(products.map((p) => [p.id, p.costPrice]));

  // Lignes produits initialisées depuis la saisie existante.
  const [lines, setLines] = useState<Line[]>(() =>
    day.items
      .filter((it) => costById.has(it.productId))
      .map((it, i) => ({ key: i, productId: it.productId, quantity: it.quantity })),
  );
  const [manualCost, setManualCost] = useState<string>(
    day.hasData && day.items.length === 0 ? String(day.purchaseCost) : "",
  );

  const nextKey = () =>
    lines.reduce((m, l) => Math.max(m, l.key), 0) + 1;

  const addLine = () =>
    setLines((ls) => [
      ...ls,
      { key: nextKey(), productId: products[0]?.id ?? "", quantity: 1 },
    ]);
  const removeLine = (key: number) =>
    setLines((ls) => ls.filter((l) => l.key !== key));
  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const hasLines = lines.length > 0;
  const computedCost = lines.reduce(
    (sum, l) => sum + (costById.get(l.productId) ?? 0) * (l.quantity || 0),
    0,
  );
  const totalQty = lines.reduce((sum, l) => sum + (l.quantity || 0), 0);

  return (
    <form
      action={async (fd) => {
        await saveDailyEntry(fd);
        onClose();
      }}
      className="space-y-4"
    >
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="day" value={day.day} />

      <div className="flex flex-wrap items-end gap-3">
        <span className="text-sm font-semibold w-16 shrink-0 pb-2">
          {day.dateLabel}
        </span>
        <Field label="Commandes" name="ordersCount" defaultValue={day.ordersCount} step="1" />
        <Field label="CA (€)" name="revenue" defaultValue={day.revenue} />
        <Field label="Dépense TikTok (€)" name="tiktokSpend" defaultValue={day.tiktokSpend} />
      </div>

      {/* Produits vendus */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Produits vendus
          </p>
          {products.length === 0 && (
            <span className="text-xs text-slate-400">
              Ajoute d&apos;abord des articles dans « Produits »
            </span>
          )}
        </div>

        {hasLines && (
          <div className="space-y-2 mb-2">
            {lines.map((l) => {
              const cost = costById.get(l.productId) ?? 0;
              return (
                <div key={l.key} className="flex flex-wrap items-center gap-2">
                  {/* Champs transmis à l'action serveur */}
                  <input type="hidden" name="itemProductId" value={l.productId} />
                  <input type="hidden" name="itemQuantity" value={l.quantity} />
                  <select
                    value={l.productId}
                    onChange={(e) => setLine(l.key, { productId: e.target.value })}
                    className="flex-1 min-w-44 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {formatEuro(p.costPrice)}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-slate-400">×</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={l.quantity}
                    onChange={(e) =>
                      setLine(l.key, {
                        quantity: Math.max(0, Math.round(Number(e.target.value) || 0)),
                      })
                    }
                    className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                  <span className="w-24 text-right text-sm tabular-nums text-slate-500">
                    {formatEuro(cost * (l.quantity || 0))}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeLine(l.key)}
                    className="text-slate-400 hover:text-red-600 text-sm px-1"
                    aria-label="Retirer"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={addLine}
            disabled={products.length === 0}
            className="rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + Ajouter un produit
          </button>

          {hasLines ? (
            <p className="text-sm">
              <span className="text-slate-500">
                {totalQty} article{totalQty > 1 ? "s" : ""} · Coût d&apos;achat calculé :{" "}
              </span>
              <span className="font-semibold tabular-nums">
                {formatEuro(computedCost)}
              </span>
            </p>
          ) : (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Coût d&apos;achat (€) :</span>
              <input
                type="number"
                name="purchaseCost"
                step="0.01"
                min="0"
                value={manualCost}
                onChange={(e) => setManualCost(e.target.value)}
                placeholder="0"
                className="w-28 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-right focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
            </label>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Enregistrer
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  step = "0.01",
}: {
  label: string;
  name: string;
  defaultValue: number;
  step?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        type="number"
        name={name}
        step={step}
        min="0"
        defaultValue={defaultValue || ""}
        placeholder="0"
        className="w-28 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
    </label>
  );
}
