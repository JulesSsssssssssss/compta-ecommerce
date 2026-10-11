"use server";

import { findCreas, type Creas } from "./radar-creas";
import { loadDeep, requestDeep, type Deep } from "./radar-deep";

/** Seules les fiches produit de boutiques sont lues : l'adresse vient du
 *  navigateur, on ne laisse pas le serveur aller chercher n'importe quoi. */
function productUrl(raw: string): string {
  const u = new URL(raw);
  if (u.protocol !== "https:" || !u.pathname.includes("/products/")) {
    throw new Error("adresse de fiche produit attendue");
  }
  return u.toString();
}

/** Ce que le « + » d'un produit affiche : les vidéos de sa fiche et, si elle a
 *  été demandée, sa recherche approfondie. */
export async function openCreas(
  url: string,
): Promise<{ creas: Creas; deep: Deep | null }> {
  const safe = productUrl(url);
  const [creas, deep] = await Promise.all([findCreas(safe), loadDeep(safe)]);
  return { creas, deep };
}

export async function askDeepSearch(
  url: string,
  title: string,
  domain: string,
): Promise<Deep> {
  return requestDeep(productUrl(url), title.slice(0, 200), domain.slice(0, 100));
}
