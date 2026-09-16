"use server";

import { revalidatePath } from "next/cache";
import { checkScan, insertScan, type RawScan } from "./avontti";

/**
 * Enregistre un relevé envoyé par le collecteur (ou collé à la main).
 * Reçu en texte : un relevé mal formé doit produire un message, pas une 500.
 */
export async function saveAvonttiScan(
  json: string,
): Promise<{ ok: true; products: number; variants: number } | { ok: false; error: string }> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "Le texte collé n'est pas un relevé lisible." };
  }
  const problem = checkScan(raw);
  if (problem) return { ok: false, error: problem };
  const scan = raw as RawScan;
  try {
    await insertScan(scan);
  } catch (e) {
    return {
      ok: false,
      error: `Enregistrement impossible : ${e instanceof Error ? e.message : "erreur base"}`,
    };
  }
  revalidatePath("/radar/avontti");
  const read = scan.products.filter((p) => p.variants?.length > 0);
  return {
    ok: true,
    products: read.length,
    variants: read.reduce((n, p) => n + p.variants.length, 0),
  };
}
