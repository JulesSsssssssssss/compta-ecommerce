import { prisma } from "./prisma";
import { computeMetrics, sumMetrics, type Metrics } from "./calc";
import { dayKey, daysInMonth } from "./format";

export type DayItem = { productId: string; quantity: number };

export type DayRow = Metrics & {
  id: string | null;
  date: Date;
  day: number;
  note: string | null;
  hasData: boolean;
  items: DayItem[];
};

export type MonthData = {
  year: number;
  month: number;
  days: DayRow[];
  total: Metrics;
};

/** Toutes les journées d'un mois (remplies ou vides), + total du mois. */
export async function getMonth(year: number, month: number): Promise<MonthData> {
  const start = dayKey(year, month, 1);
  // 1er jour du mois suivant (gère le passage à l'année suivante en décembre).
  const nextStart =
    month === 12 ? dayKey(year + 1, 1, 1) : dayKey(year, month + 1, 1);

  const entries = await prisma.dailyEntry.findMany({
    where: { date: { gte: start, lt: nextStart } },
    orderBy: { date: "asc" },
    include: { items: true },
  });

  const byDay = new Map(entries.map((e) => [e.date.getUTCDate(), e]));
  const nbDays = daysInMonth(year, month);

  const days: DayRow[] = [];
  for (let d = 1; d <= nbDays; d++) {
    const e = byDay.get(d);
    const base = e
      ? computeMetrics(e)
      : computeMetrics({
          ordersCount: 0,
          revenue: 0,
          tiktokSpend: 0,
          purchaseCost: 0,
        });
    days.push({
      ...base,
      id: e?.id ?? null,
      date: dayKey(year, month, d),
      day: d,
      note: e?.note ?? null,
      hasData: !!e,
      items:
        e?.items.map((it) => ({
          productId: it.productId,
          quantity: it.quantity,
        })) ?? [],
    });
  }

  return { year, month, days, total: sumMetrics(entries) };
}

export type MonthSummary = Metrics & { month: number };

/** Récapitulatif annuel : un total par mois + total année. */
export async function getYearRecap(year: number): Promise<{
  months: MonthSummary[];
  total: Metrics;
}> {
  const start = dayKey(year, 1, 1);
  const end = dayKey(year + 1, 1, 1);
  const entries = await prisma.dailyEntry.findMany({
    where: { date: { gte: start, lt: end } },
  });

  const months: MonthSummary[] = [];
  for (let m = 1; m <= 12; m++) {
    const monthEntries = entries.filter((e) => e.date.getUTCMonth() + 1 === m);
    months.push({ month: m, ...sumMetrics(monthEntries) });
  }

  return { months, total: sumMetrics(entries) };
}

/** Années pour lesquelles au moins une saisie existe (pour le sélecteur). */
export async function getAvailableYears(): Promise<number[]> {
  const entries = await prisma.dailyEntry.findMany({
    select: { date: true },
    orderBy: { date: "asc" },
  });
  const years = new Set(entries.map((e) => e.date.getUTCFullYear()));
  years.add(new Date().getUTCFullYear());
  return [...years].sort((a, b) => b - a);
}

export async function getProducts() {
  return prisma.product.findMany({ orderBy: { name: "asc" } });
}
