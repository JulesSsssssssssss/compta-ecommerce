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
- [Prisma 6](https://www.prisma.io) + PostgreSQL pour les données
- [Recharts](https://recharts.org) pour les graphiques

## Démarrer en local

Il faut une base PostgreSQL. Le plus simple et gratuit : créer une base sur
[Neon](https://neon.tech) et copier son URL de connexion.

```bash
npm install
cp .env.example .env         # puis colle ton URL Postgres dans DATABASE_URL
npx prisma migrate deploy    # crée les tables
npm run seed                 # (optionnel) importe les données 2026 existantes
npm run dev                  # démarre sur http://localhost:3000
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

## Mise en ligne sur Vercel

1. **Créer une base Postgres gratuite** sur [Neon](https://neon.tech) :
   nouveau projet → copier la *connection string* (commence par `postgresql://`).
2. **Importer le projet dans Vercel** : « Add New… → Project » et choisir ce
   dépôt GitHub.
3. **Variables d'environnement** (onglet Settings → Environment Variables) :
   - `DATABASE_URL` = l'URL Neon copiée à l'étape 1.
   - `APP_PASSWORD` = un mot de passe de ton choix (protège l'accès en ligne).
4. **Déployer.** Le build applique automatiquement les migrations
   (`prisma migrate deploy`) et crée les tables.
5. **Importer tes données 2026** (une seule fois) : en local, mets la même
   `DATABASE_URL` dans `.env` puis lance `npm run seed`.

> La même base Neon peut servir en local et en ligne : tu as ainsi les mêmes
> données partout.

## Prochaines étapes (roadmap)

- Automatiser l'import des dépenses publicitaires (TikTok Ads).
- Rattacher les ventes aux produits pour déduire automatiquement le coût d'achat.
- Synchroniser le CA et les commandes depuis la plateforme e-commerce (Shopify…).
