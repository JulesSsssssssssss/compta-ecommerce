# Analyse de la Google Sheet d'origine

Document de référence : la comptabilité e-commerce était tenue dans une Google
Sheet, une feuille par mois + un récapitulatif annuel. Ce fichier décrit sa
structure et la façon dont l'application la remplace.

## Structure de la sheet

### 1. Récapitulatif annuel 2026

Une ligne par mois + une ligne « TOTAL ANNÉE ».

| Colonne | Type |
|---|---|
| Mois | libellé |
| Nombre de commandes | saisi |
| CA du mois (€) | agrégé |
| Dépense TikTok (€) | agrégé |
| Prix achat moyen (€) | calculé |
| Prix vente moyen (€) | calculé |
| Marge moyenne (%) | calculé |
| Marge (€) | calculé |
| Bénéfice net (€) | calculé |

### 2. Une feuille par mois — « Suivi des ventes - [Mois] 2026 »

Une ligne par jour + une ligne « TOTAL DU MOIS ».
Convention de la sheet : *cellules bleues = à remplir à la main, cellules noires
= calculées*.

| Colonne | Type |
|---|---|
| Date | jour |
| Nombre de commandes | **saisi** |
| CA jour (€) | **saisi** |
| Dépense TikTok (€) | **saisi** |
| Prix d'achat (€) | **saisi** (coût d'achat total du jour) |
| Prix de vente moyen (€) | calculé |
| Marge (%) | calculé |
| Marge (€) | calculé |
| Bénéfice net jour (€) | calculé |
| ROAS | calculé |

### 3. Petite table « Article » (catalogue produits)

Liste d'articles avec leur prix d'achat, utilisée comme référence de coût :

| Article | Prix d'achat |
|---|---|
| Ensemble Anabelle | 18,92 € |
| Santana | 14,74 € |
| Kaya | 14,74 € |
| Lowena | 17,64 € |

## Formules de calcul (reproduites dans l'app — voir `lib/calc.ts`)

```
Marge (€)         = CA − Dépense TikTok − Coût d'achat
Bénéfice net      = Marge (€)
Marge (%)         = Marge (€) / CA
ROAS              = CA / Dépense TikTok
Prix vente moyen  = CA / Nombre de commandes
Prix achat moyen  = Coût d'achat / Nombre de commandes
```

## Données importées (année 2026)

- **Juillet** : jours 24 → 31 (21 commandes, 823,66 € de CA).
- **Août** : jours 1 → 18 (72 commandes, 3 031,95 € de CA).

> ⚠️ Anomalie corrigée : dans la sheet, l'onglet « Août » contenait des dates
> recopiées en juillet (01/07 → 18/07) alors que ses totaux correspondaient bien
> à août. L'import rétablit ces jours en **août (01/08 → 18/08)**. L'application
> empêche désormais ce genre d'erreur (une date = une seule saisie).

> ⚠️ Le total annuel de la sheet contenait des `#REF!` faussant « Marge € » et
> « Bénéfice net ». L'app recalcule tout proprement : bénéfice net 2026 = juillet
> (14,88 €) + août (673,91 €).
