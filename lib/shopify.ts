// Intégration Shopify : récupère les commandes et le CA jour par jour via
// l'API Admin GraphQL, pour remplir automatiquement les saisies quotidiennes.

const API_VERSION = "2026-07";
const SHOP_TIMEZONE = "Europe/Paris"; // fuseau de la boutique (CEST/CET)

export type DailyAgg = { ordersCount: number; revenue: number };

export function shopifyConfigured(): boolean {
  if (!process.env.SHOPIFY_STORE_DOMAIN) return false;
  // Deux modes d'authentification possibles (voir getAccessToken).
  return Boolean(
    process.env.SHOPIFY_ADMIN_TOKEN ||
      (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET),
  );
}

// Jeton obtenu par « client credentials », valable 24 h. On le garde en mémoire
// et on le renouvelle une minute avant l'échéance plutôt qu'à chaque appel.
let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Renvoie un jeton d'accès Admin API.
 *
 * - Si SHOPIFY_ADMIN_TOKEN est défini (ancienne app créée dans l'admin), on
 *   l'utilise tel quel : c'est un jeton permanent.
 * - Sinon on échange SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET contre un jeton
 *   temporaire. C'est le mode « client credentials », réservé aux apps qui
 *   agissent sur les boutiques de leur propre organisation Shopify.
 */
async function getAccessToken(domain: string): Promise<string> {
  const staticToken = process.env.SHOPIFY_ADMIN_TOKEN;
  if (staticToken) return staticToken;

  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Shopify non configuré");

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Authentification Shopify ${res.status} : ${body.slice(0, 300)}`,
    );
  }

  const { access_token, expires_in } = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    value: access_token,
    expiresAt: Date.now() + (expires_in - 60) * 1000,
  };
  return access_token;
}

type OrderNode = {
  createdAt: string;
  test: boolean;
  cancelledAt: string | null;
  subtotalLineItemsQuantity: number;
  totalPriceSet: { shopMoney: { amount: string } };
};

// `subtotalLineItemsQuantity` est le nombre d'articles de la commande (une
// commande de 2 pièces compte pour 2). On garde la variante « d'origine »
// plutôt que `currentSubtotalLineItemsQuantity` pour rester cohérent avec
// `totalPriceSet`, qui est lui aussi le montant d'origine, hors retours.
const ORDERS_QUERY = `
  query Orders($cursor: String, $q: String!) {
    orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        createdAt
        test
        cancelledAt
        subtotalLineItemsQuantity
        totalPriceSet { shopMoney { amount } }
      }
    }
  }
`;

/** Renvoie la date locale (Europe/Paris) d'un instant ISO, au format {y,m,d}. */
function toShopDate(iso: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  const [y, m, d] = parts.split("-").map(Number);
  return { y, m, d };
}

async function shopifyGraphQL<T>(query: string, variables: object): Promise<T> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) throw new Error("Shopify non configuré");
  const token = await getAccessToken(domain);

  const res = await fetch(
    `https://${domain}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify API ${res.status} : ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`Shopify GraphQL : ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  return json.data as T;
}

/**
 * Agrège les commandes d'un mois par jour (fuseau boutique).
 * Retourne une map { jour du mois -> { ordersCount, revenue } }.
 * On sur-échantillonne d'un jour de chaque côté pour couvrir le décalage
 * horaire, puis on ne garde que les jours du mois demandé.
 */
export async function fetchShopifyMonth(
  year: number,
  month: number,
): Promise<Map<number, DailyAgg>> {
  // Bornes UTC larges (J-1 → J+1) autour du mois local.
  const from = new Date(Date.UTC(year, month - 1, 1));
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(Date.UTC(year, month, 1));
  to.setUTCDate(to.getUTCDate() + 1);
  const q = `created_at:>=${from.toISOString()} created_at:<=${to.toISOString()}`;

  const result = new Map<number, DailyAgg>();
  let cursor: string | null = null;

  do {
    const data: {
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: OrderNode[];
      };
    } = await shopifyGraphQL(ORDERS_QUERY, { cursor, q });

    for (const o of data.orders.nodes) {
      if (o.test) continue; // ignore les commandes de test
      if (o.cancelledAt) continue; // ignore les commandes annulées
      const { y, m, d } = toShopDate(o.createdAt);
      if (y !== year || m !== month) continue; // hors du mois local
      const amount = Number(o.totalPriceSet?.shopMoney?.amount ?? 0);
      const agg = result.get(d) ?? { ordersCount: 0, revenue: 0 };
      // On compte les articles vendus, pas les commandes : le catalogue donne
      // un prix d'achat par article, donc « coût / compteur » n'a de sens que
      // si le compteur compte des articles.
      agg.ordersCount += o.subtotalLineItemsQuantity ?? 1;
      agg.revenue += amount;
      result.set(d, agg);
    }

    cursor = data.orders.pageInfo.hasNextPage
      ? data.orders.pageInfo.endCursor
      : null;
  } while (cursor);

  // Arrondi à 2 décimales pour éviter les flottants disgracieux.
  for (const agg of result.values()) {
    agg.revenue = Math.round(agg.revenue * 100) / 100;
  }
  return result;
}
