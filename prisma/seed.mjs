// Import des données existantes de la Google Sheet (année 2026).
// Lancer avec : npm run seed
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const dayKey = (year, month, day) => new Date(Date.UTC(year, month - 1, day));

// Catalogue produit (prix d'achat = coût).
const products = [
  { name: "Ensemble Anabelle", costPrice: 18.92 },
  { name: "Santana", costPrice: 14.74 },
  { name: "Kaya", costPrice: 14.74 },
  { name: "Lowena", costPrice: 17.64 },
];

// [jour, commandes, CA, dépense TikTok, coût d'achat]
// Juillet 2026 (onglet "Juillet", jours 24 → 31).
const july = [
  [24, 2, 69.94, 24.54, 29.81],
  [25, 2, 79.9, 47.4, 34.06],
  [26, 0, 0, 21.58, 0],
  [27, 2, 79.98, 49.9, 38.1],
  [28, 4, 154.92, 50.27, 72.15],
  [29, 4, 159.96, 75.0, 75.68],
  [30, 4, 159.96, 76.78, 75.68],
  [31, 3, 119.0, 81.0, 56.83],
];

// Août 2026 (onglet "Aout" — les dates y étaient mal recopiées en 07,
// on les rétablit en août 01 → 18).
const august = [
  [1, 5, 229.94, 95.0, 109.0],
  [2, 5, 202.0, 61.73, 94.6],
  [3, 3, 125.77, 50.4, 56.76],
  [4, 3, 119.97, 60.0, 56.76],
  [5, 1, 39.99, 34.34, 18.92],
  [6, 1, 39.99, 0.0, 18.92],
  [7, 3, 128.0, 50.17, 56.76],
  [8, 6, 249.4, 58.67, 113.52],
  [9, 9, 386.01, 105.83, 170.28],
  [10, 2, 85.78, 37.58, 37.84],
  [11, 11, 453.0, 111.69, 195.84],
  [12, 5, 203.0, 48.23, 93.53],
  [13, 7, 297.33, 84.1, 84.1],
  [14, 1, 42.89, 37.59, 18.92],
  [15, 6, 257.32, 80.0, 113.52],
  [16, 2, 85.78, 55.96, 18.92],
  [17, 1, 42.89, 56.14, 18.92],
  [18, 1, 42.89, 34.58, 18.92],
];

async function importMonth(year, month, rows) {
  for (const [day, ordersCount, revenue, tiktokSpend, purchaseCost] of rows) {
    const date = dayKey(year, month, day);
    const data = { ordersCount, revenue, tiktokSpend, purchaseCost };
    await prisma.dailyEntry.upsert({
      where: { date },
      create: { date, ...data },
      update: data,
    });
  }
}

async function main() {
  for (const p of products) {
    await prisma.product.upsert({
      where: { name: p.name },
      create: p,
      update: { costPrice: p.costPrice },
    });
  }
  await importMonth(2026, 7, july);
  await importMonth(2026, 8, august);

  const count = await prisma.dailyEntry.count();
  console.log(
    `✅ Import terminé : ${products.length} produits, ${count} journées.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
