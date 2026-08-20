import Link from "next/link";
import { notFound } from "next/navigation";
import { getMonth, getProducts } from "@/lib/data";
import {
  formatEuro,
  formatPercent,
  formatRoas,
  monthLabel,
} from "@/lib/format";
import { Card, StatCard } from "@/app/components/ui";
import { MonthTable, type DayCell } from "@/app/components/MonthTable";
import { DailyTrendChart } from "@/app/components/Charts";
import { ShopifySync } from "@/app/components/ShopifySync";
import { shopifyConfigured } from "@/lib/shopify";

export default async function MonthPage({
  params,
}: PageProps<"/mois/[year]/[month]">) {
  const { year: yearStr, month: monthStr } = await params;
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || month < 1 || month > 12) notFound();

  const [{ days, total }, productList] = await Promise.all([
    getMonth(year, month),
    getProducts(),
  ]);

  const products = productList
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, name: p.name, costPrice: p.costPrice }));

  const cells: DayCell[] = days.map((d) => ({
    day: d.day,
    dateLabel: `${String(d.day).padStart(2, "0")}/${String(month).padStart(2, "0")}`,
    id: d.id,
    ordersCount: d.ordersCount,
    revenue: d.revenue,
    tiktokSpend: d.tiktokSpend,
    purchaseCost: d.purchaseCost,
    margin: d.margin,
    marginRate: d.marginRate,
    roas: d.roas,
    avgSellPrice: d.avgSellPrice,
    hasData: d.hasData,
    items: d.items,
  }));

  const trend = days.map((d) => ({
    label: String(d.day),
    revenue: Math.round(d.revenue),
    margin: Math.round(d.margin),
  }));

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href={`/?year=${year}`}
            className="text-xs text-slate-500 hover:text-brand-600"
          >
            ← Récapitulatif {year}
          </Link>
          <h1 className="text-2xl font-semibold">
            {monthLabel(month)} {year}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/mois/${prev.y}/${prev.m}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            ← {monthLabel(prev.m)}
          </Link>
          <Link
            href={`/mois/${next.y}/${next.m}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            {monthLabel(next.m)} →
          </Link>
        </div>
      </div>

      {/* KPIs du mois */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="CA du mois" value={formatEuro(total.revenue)} tone="brand" />
        <StatCard
          label="Bénéfice net"
          value={formatEuro(total.margin)}
          tone={total.margin >= 0 ? "positive" : "negative"}
          hint={`Marge ${formatPercent(total.marginRate)}`}
        />
        <StatCard label="Dépense TikTok" value={formatEuro(total.tiktokSpend)} />
        <StatCard
          label="Commandes"
          value={String(total.ordersCount)}
          hint={`ROAS ${formatRoas(total.roas)}`}
        />
      </div>

      {total.revenue > 0 && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">
            Évolution du mois (CA & bénéfice net)
          </h2>
          <DailyTrendChart data={trend} />
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">
              Suivi jour par jour
            </h2>
            <p className="text-xs text-slate-400">
              Commandes et CA depuis Shopify · TikTok et coûts à renseigner
            </p>
          </div>
          <ShopifySync year={year} month={month} configured={shopifyConfigured()} />
        </div>
        <MonthTable
          year={year}
          month={month}
          days={cells}
          total={total}
          products={products}
        />
      </Card>
    </div>
  );
}
