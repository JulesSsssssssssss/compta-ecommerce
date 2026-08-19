// Helpers de formatage (format français : espace milliers, virgule décimale).

const eur = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});
const num = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const pct = new Intl.NumberFormat("fr-FR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export const formatEuro = (v: number) => eur.format(v ?? 0);
export const formatNumber = (v: number) => num.format(v ?? 0);
export const formatPercent = (v: number) => pct.format(v ?? 0);
export const formatRoas = (v: number) =>
  (v ?? 0).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const MONTHS_FR = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

export const monthLabel = (m: number) => MONTHS_FR[m - 1] ?? "";

/** Date "clé" d'une journée, normalisée à minuit UTC pour l'unicité en base. */
export function dayKey(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Nombre de jours dans un mois donné. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Formate une Date en "JJ/MM/AAAA". */
export function formatDateFR(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getUTCFullYear()}`;
}
