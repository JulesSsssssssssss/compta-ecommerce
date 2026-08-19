// Logique de calcul partagée — reproduit les formules de la Google Sheet.
//
//   Marge (€)        = CA − Dépense TikTok − Coût d'achat
//   Bénéfice net     = Marge (€)                (identique dans la sheet)
//   Marge (%)        = Marge (€) / CA
//   ROAS             = CA / Dépense TikTok
//   Prix vente moyen = CA / Nb commandes
//   Prix achat moyen = Coût d'achat / Nb commandes

export type EntryInput = {
  ordersCount: number;
  revenue: number;
  tiktokSpend: number;
  purchaseCost: number;
};

export type Metrics = {
  ordersCount: number;
  revenue: number;
  tiktokSpend: number;
  purchaseCost: number;
  margin: number; // Marge € (= bénéfice net)
  marginRate: number; // Marge % (0..1)
  roas: number; // Retour sur dépense pub
  avgSellPrice: number; // Prix de vente moyen
  avgBuyPrice: number; // Prix d'achat moyen
};

export function computeMetrics(e: EntryInput): Metrics {
  const margin = e.revenue - e.tiktokSpend - e.purchaseCost;
  return {
    ordersCount: e.ordersCount,
    revenue: e.revenue,
    tiktokSpend: e.tiktokSpend,
    purchaseCost: e.purchaseCost,
    margin,
    marginRate: e.revenue > 0 ? margin / e.revenue : 0,
    roas: e.tiktokSpend > 0 ? e.revenue / e.tiktokSpend : 0,
    avgSellPrice: e.ordersCount > 0 ? e.revenue / e.ordersCount : 0,
    avgBuyPrice: e.ordersCount > 0 ? e.purchaseCost / e.ordersCount : 0,
  };
}

/** Additionne plusieurs saisies puis recalcule les indicateurs sur les totaux. */
export function sumMetrics(entries: EntryInput[]): Metrics {
  const total = entries.reduce<EntryInput>(
    (acc, e) => ({
      ordersCount: acc.ordersCount + e.ordersCount,
      revenue: acc.revenue + e.revenue,
      tiktokSpend: acc.tiktokSpend + e.tiktokSpend,
      purchaseCost: acc.purchaseCost + e.purchaseCost,
    }),
    { ordersCount: 0, revenue: 0, tiktokSpend: 0, purchaseCost: 0 },
  );
  return computeMetrics(total);
}
