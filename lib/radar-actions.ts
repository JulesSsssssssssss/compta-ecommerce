"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";

/**
 * Extrait le domaine nu d'une saisie libre : l'utilisateur peut coller
 * "https://www.exemple.com/products/robe-x" ou "EXEMPLE.COM/", on garde
 * "www.exemple.com" / "exemple.com". Renvoie null si rien d'exploitable.
 */
function toDomain(input: string): string | null {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split("?")[0]
    .trim();
  // Au moins un point et des caractères de domaine valides.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

export async function addRadarSite(formData: FormData) {
  const domain = toDomain(String(formData.get("domain") ?? ""));
  if (!domain) return;
  // Un doublon n'est pas une erreur : l'utilisateur voulait juste l'ajouter.
  await prisma.radarSite.upsert({
    where: { domain },
    update: {},
    create: { domain },
  });
  revalidatePath("/radar");
}

export async function removeRadarSite(formData: FormData) {
  const domain = String(formData.get("domain") ?? "");
  if (!domain) return;
  await prisma.radarSite.deleteMany({ where: { domain } });
  revalidatePath("/radar");
}
