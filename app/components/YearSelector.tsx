"use client";

import { useRouter } from "next/navigation";

export function YearSelector({
  years,
  current,
}: {
  years: number[];
  current: number;
}) {
  const router = useRouter();
  return (
    <select
      value={current}
      onChange={(e) => router.push(`/?year=${e.target.value}`)}
      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
    >
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  );
}
