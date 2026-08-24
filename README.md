# Compta e-commerce

Application web qui remplace la Google Sheet de suivi comptable e-commerce :
saisie jour par jour, totaux mensuels et récapitulatif annuel, calculés
automatiquement (marge, bénéfice net, ROAS, panier moyen).

Objectif de cette v1 : **remplacer la saisie manuelle dans la Google Sheet**.
Étape suivante prévue : automatiser la récupération des chiffres (TikTok, Shopify…).

## Fonctionnalités

- **Tableau de bord** : récapitulatif annuel, indicateurs clés, graphiques
  (CA et bénéfice net par mois), tableau détaillé par mois.
- **Saisie du jour** : une page par mois, une ligne par jour. On ne renseigne
  que 4 champs (commandes, CA, dépense TikTok, coût d'achat) ; le reste est
  calculé en direct (marge %, bénéfice net, ROAS, panier moyen).
- **Produits** : catalogue des articles avec leur prix d'achat (comme la table
  « Article » de la sheet).
- **Accès protégé** (optionnel) par mot de passe pour un usage en ligne.

## Stack technique

- [Next.js 16](https://nextjs.org) (App Router) + React 19 + TypeScript
- [Tailwind CSS 4](https://tailwindcss.com) pour l'interface
- [Prisma 6](https://www.prisma.io) + [Turso](https://turso.tech) (SQLite hébergé,
  via l'adaptateur libSQL)
- [Recharts](https://recharts.org) pour les graphiques

## Démarrer en local

Aucune base à installer : sans configuration, l'app utilise un fichier SQLite
local (`prisma/dev.db`).

```bash
npm install
cp .env.example .env   # (optionnel) pour pointer vers Turso ; sinon laisse vide
npm run seed           # crée les tables + importe les données 2026
npm run dev            # démarre sur http://localhost:3000
```

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production (génère aussi le client Prisma) |
| `npm run start` | Sert le build de production |
| `npm run seed` | Importe les produits + jours de juillet/août 2026 |

## Structure du code

```
app/
  page.tsx                     Tableau de bord (récap annuel)
  mois/[year]/[month]/page.tsx Suivi jour par jour d'un mois
  produits/page.tsx            Catalogue produits
  login/page.tsx               Page de connexion
  components/                  Nav, cartes, graphiques, tableau mensuel
lib/
  calc.ts                      Formules (marge, ROAS, prix moyens)
  data.ts                      Requêtes agrégées (mois, année)
  actions.ts                   Server Actions (CRUD jours & produits)
  auth-actions.ts              Connexion / déconnexion
  format.ts                    Formatage FR (€, %, dates)
prisma/
  schema.prisma                Modèle de données
  seed.mjs                     Import des données 2026
proxy.ts                       Gate d'accès par mot de passe (ex-middleware)
docs/analyse-google-sheet.md   Analyse de la sheet d'origine
```

## Protéger l'accès (usage en ligne)

Définir `APP_PASSWORD` dans `.env` (ou dans les variables d'environnement de
l'hébergeur). Une page de connexion s'affichera alors. Laisser vide = accès
libre (pratique en local).

## Connecter Shopify

Le bouton « ↻ Synchroniser depuis Shopify » (pages mois) récupère le nombre de
commandes et le CA jour par jour. Il reste grisé tant que les deux variables
ci-dessous ne sont pas définies.

> Shopify ne permet plus de créer les anciennes « applications personnalisées »
> depuis l'admin (celles qui fournissaient un jeton `shpat_` permanent). Les
> nouvelles apps se créent dans le **Dev Dashboard**, et l'app s'authentifie en
> échangeant ses identifiants contre un jeton temporaire.

1. Sur [dev.shopify.com](https://dev.shopify.com), créer une app (nom libre,
   ex. « Compta ») dans l'organisation **qui contient la boutique**.
2. Déclarer les portées **`read_orders`** (+ **`read_all_orders`** pour
   l'historique au-delà de 60 jours), puis publier une version de l'app et
   approuver l'accès sur la boutique.
3. Récupérer le **client ID** et le **client secret** de l'app.
4. Renseigner dans `.env` (et dans Vercel pour la mise en ligne) :
   - `SHOPIFY_STORE_DOMAIN` = le domaine technique `xxxxxx-xx.myshopify.com`
     (pas le domaine public de la boutique)
   - `SHOPIFY_CLIENT_ID` et `SHOPIFY_CLIENT_SECRET` = l'étape 3
5. Redémarrer `npm run dev` (les variables d'environnement sont lues au démarrage).

L'app échange ces identifiants contre un jeton d'accès valable 24 h
(`client_credentials`), qu'elle garde en cache et renouvelle toute seule — voir
`getAccessToken()` dans `lib/shopify.ts`. Ce mode ne fonctionne que si l'app et
la boutique sont dans la **même organisation Shopify** ; sinon Shopify répond
`shop_not_permitted`.

Si tu maintiens une ancienne app de l'admin avec un jeton `shpat_` permanent,
renseigne `SHOPIFY_ADMIN_TOKEN` à la place : il prend le pas sur le reste.

La synchronisation n'écrase que **le CA et le nombre de commandes** : la dépense
TikTok et le coût d'achat saisis à la main sont conservés. Les commandes de test
et les commandes annulées sont ignorées.

## Mise en ligne sur Vercel

1. **Créer une base Turso gratuite** (SQLite hébergé) :
   - `curl -sSfL https://get.tur.so/install.sh | bash` puis `turso auth signup`
   - `turso db create compta` (crée la base)
   - `turso db show compta --url` → **TURSO_DATABASE_URL** (commence par `libsql://`)
   - `turso db tokens create compta` → **TURSO_AUTH_TOKEN**
2. **Préparer la base** (tables + données 2026), une seule fois, en local :
   mets `TURSO_DATABASE_URL` et `TURSO_AUTH_TOKEN` dans `.env`, puis `npm run seed`.
3. **Importer le projet dans Vercel** : « Add New… → Project » → ce dépôt GitHub.
4. **Variables d'environnement** (Settings → Environment Variables) :
   - `TURSO_DATABASE_URL` = l'URL de l'étape 1
   - `TURSO_AUTH_TOKEN` = le token de l'étape 1
   - `APP_PASSWORD` = un mot de passe de ton choix (protège l'accès en ligne)
   - `SHOPIFY_STORE_DOMAIN` et `SHOPIFY_ADMIN_TOKEN` (voir « Connecter Shopify »)
5. **Déployer.**

> La même base Turso sert en local et en ligne : mêmes données partout.

## Prochaines étapes (roadmap)

- Automatiser l'import des dépenses publicitaires (TikTok Ads).
- Rattacher les ventes aux produits pour déduire automatiquement le coût d'achat.
- Synchroniser le CA et les commandes depuis la plateforme e-commerce (Shopify…).
