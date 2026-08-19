import Link from "next/link";
import { getYearRecap, getAvailableYears } from "@/lib/data";
import {
  formatEuro,
  formatPercent,
  formatRoas,
  monthLabel,
  MONTHS_FR,
} from "@/lib/format";
import { Card, StatCard, signTone } from "./components/ui";
import { RevenueByMonthChart, MarginByMonthChart } from "./components/Charts";
import { YearSelector } from "./components/YearSelector";

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const years = await getAvailableYears();
  const yearParam = Number(
    Array.isArray(params.year) ? params.year[0] : params.year,
  );
  const year = years.includes(yearParam) ? yearParam : years[0];

  const { months, total } = await getYearRecap(year);

  const chartData = months.map((m) => ({
    label: MONTHS_FR[m.month - 1].slice(0, 3),
    revenue: Math.round(m.revenue),
    margin: Math.round(m.margin),
  }));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tableau de bord</h1>
          <p className="text-sm text-slate-500">Récapitulatif annuel {year}</p>
        </div>
        <YearSelector years={years} current={year} />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Chiffre d'affaires"
          value={formatEuro(total.revenue)}
          tone="brand"
        />
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

      {/* Graphiques */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">
            Chiffre d&apos;affaires par mois
          </h2>
          <RevenueByMonthChart data={chartData} />
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">
            Bénéfice net par mois
          </h2>
          <MarginByMonthChart data={chartData} />
        </Card>
      </div>

      {/* Tableau récapitulatif */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700">
            Détail par mois
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50">
                <th className="px-4 py-3 font-medium">Mois</th>
                <th className="px-4 py-3 font-medium text-right">Commandes</th>
                <th className="px-4 py-3 font-medium text-right">CA</th>
                <th className="px-4 py-3 font-medium text-right">Dépense TikTok</th>
                <th className="px-4 py-3 font-medium text-right">Marge %</th>
                <th className="px-4 py-3 font-medium text-right">Bénéfice net</th>
                <th className="px-4 py-3 font-medium text-right">ROAS</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {months.map((m) => (
                <tr key={m.month} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{monthLabel(m.month)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {m.ordersCount}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatEuro(m.revenue)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                    {formatEuro(m.tiktokSpend)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${signTone(m.margin)}`}
                  >
                    {m.revenue > 0 ? formatPercent(m.marginRate) : "—"}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums font-medium ${signTone(m.margin)}`}
                  >
                    {formatEuro(m.margin)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                    {m.tiktokSpend > 0 ? formatRoas(m.roas) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/mois/${year}/${m.month}`}
                      className="text-brand-600 hover:text-brand-700 text-xs font-medium"
                    >
                      Ouvrir →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                <td className="px-4 py-3">Total {year}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {total.ordersCount}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatEuro(total.revenue)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatEuro(total.tiktokSpend)}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums ${signTone(total.margin)}`}
                >
                  {formatPercent(total.marginRate)}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums ${signTone(total.margin)}`}
                >
                  {formatEuro(total.margin)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatRoas(total.roas)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}
