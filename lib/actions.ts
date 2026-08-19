"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { dayKey } from "./format";

// ---- Utilitaires de parsing (tolère "12,50" ou "12.50", champs vides) ----

function toNumber(v: FormDataEntryValue | null): number {
  if (v == null) return 0;
  const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function toInt(v: FormDataEntryValue | null): number {
  return Math.max(0, Math.round(toNumber(v)));
}

// ---- Saisie d'une journée ----

/**
 * Crée ou met à jour la saisie d'un jour (upsert sur la date).
 * Champs attendus : year, month, day, ordersCount, revenue, tiktokSpend,
 * purchaseCost, note.
 */
export async function saveDailyEntry(formData: FormData) {
  const year = toInt(formData.get("year"));
  const month = toInt(formData.get("month"));
  const day = toInt(formData.get("day"));
  if (!year || !month || !day) throw new Error("Date invalide");

  // Lignes produits (parallèle : itemProductId[i] ↔ itemQuantity[i]).
  const productIds = formData.getAll("itemProductId").map(String);
  const quantities = formData.getAll("itemQuantity");
  const qtyByProduct = new Map<string, number>();
  productIds.forEach((pid, i) => {
    if (!pid) return;
    const q = toInt(quantities[i]);
    if (q <= 0) return;
    qtyByProduct.set(pid, (qtyByProduct.get(pid) ?? 0) + q);
  });

  // Coût d'achat : calculé depuis le catalogue si des produits sont choisis,
  // sinon on prend le montant saisi à la main.
  let purchaseCost: number;
  if (qtyByProduct.size > 0) {
    const products = await prisma.product.findMany({
      where: { id: { in: [...qtyByProduct.keys()] } },
      select: { id: true, costPrice: true },
    });
    const costById = new Map(products.map((p) => [p.id, p.costPrice]));
    purchaseCost = [...qtyByProduct].reduce(
      (sum, [pid, q]) => sum + (costById.get(pid) ?? 0) * q,
      0,
    );
  } else {
    purchaseCost = toNumber(formData.get("purchaseCost"));
  }

  const date = dayKey(year, month, day);
  const data = {
    ordersCount: toInt(formData.get("ordersCount")),
    revenue: toNumber(formData.get("revenue")),
    tiktokSpend: toNumber(formData.get("tiktokSpend")),
    purchaseCost,
    note: (formData.get("note") as string)?.trim() || null,
  };

  const entry = await prisma.dailyEntry.upsert({
    where: { date },
    create: { date, ...data },
    update: data,
  });

  // On remplace les lignes produits du jour par la nouvelle sélection.
  await prisma.dailyEntryItem.deleteMany({ where: { entryId: entry.id } });
  if (qtyByProduct.size > 0) {
    await prisma.dailyEntryItem.createMany({
      data: [...qtyByProduct].map(([productId, quantity]) => ({
        entryId: entry.id,
        productId,
        quantity,
      })),
    });
  }

  revalidatePath("/");
  revalidatePath(`/mois/${year}/${month}`);
}

/** Supprime la saisie d'un jour (remet la ligne à zéro). */
export async function deleteDailyEntry(formData: FormData) {
  const id = String(formData.get("id") || "");
  const year = toInt(formData.get("year"));
  const month = toInt(formData.get("month"));
  if (!id) return;
  await prisma.dailyEntry.delete({ where: { id } }).catch(() => {});
  revalidatePath("/");
  revalidatePath(`/mois/${year}/${month}`);
}

// ---- Catalogue produits ----

export async function createProduct(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const costPrice = toNumber(formData.get("costPrice"));
  if (!name) throw new Error("Nom requis");
  await prisma.product.upsert({
    where: { name },
    create: { name, costPrice },
    update: { costPrice },
  });
  revalidatePath("/produits");
}

export async function updateProduct(formData: FormData) {
  const id = String(formData.get("id") || "");
  const name = String(formData.get("name") || "").trim();
  const costPrice = toNumber(formData.get("costPrice"));
  const active = formData.get("active") === "on";
  if (!id || !name) throw new Error("Champs requis manquants");
  await prisma.product.update({
    where: { id },
    data: { name, costPrice, active },
  });
  revalidatePath("/produits");
}

export async function deleteProduct(formData: FormData) {
  const id = String(formData.get("id") || "");
  if (!id) return;
  await prisma.product.delete({ where: { id } }).catch(() => {});
  revalidatePath("/produits");
}
