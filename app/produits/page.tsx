import { getProducts } from "@/lib/data";
import { createProduct, updateProduct, deleteProduct } from "@/lib/actions";
import { Card } from "@/app/components/ui";

// Toujours refléter l'état actuel de la base (pas de mise en cache statique).
export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const products = await getProducts();

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Produits</h1>
        <p className="text-sm text-slate-500">
          Ton catalogue avec le prix d&apos;achat (coût) de chaque article.
        </p>
      </div>

      {/* Ajouter un produit */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">
          Ajouter un produit
        </h2>
        <form
          action={createProduct}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1 flex-1 min-w-48">
            <span className="text-xs text-slate-500">Nom de l&apos;article</span>
            <input
              name="name"
              required
              placeholder="Ex. Ensemble Anabelle"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Prix d&apos;achat (€)</span>
            <input
              name="costPrice"
              type="number"
              step="0.01"
              min="0"
              placeholder="0,00"
              className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Ajouter
          </button>
        </form>
      </Card>

      {/* Liste des produits */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700">
            {products.length} produit{products.length > 1 ? "s" : ""}
          </h2>
        </div>
        {products.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-400 text-center">
            Aucun produit pour l&apos;instant. Ajoute ton premier article
            ci-dessus.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {products.map((p) => (
              <li
                key={p.id}
                className="px-5 py-3 flex flex-wrap items-center gap-3"
              >
                <form
                  action={updateProduct}
                  className="flex flex-wrap items-center gap-3 flex-1"
                >
                  <input type="hidden" name="id" value={p.id} />
                  <input
                    name="name"
                    defaultValue={p.name}
                    className="flex-1 min-w-40 rounded-lg border border-transparent hover:border-slate-200 px-2 py-1.5 text-sm font-medium focus:border-brand-500 focus:outline-none"
                  />
                  <div className="flex items-center gap-1">
                    <input
                      name="costPrice"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={p.costPrice}
                      className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                    />
                    <span className="text-sm text-slate-400">€</span>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      name="active"
                      defaultChecked={p.active}
                      className="rounded"
                    />
                    Actif
                  </label>
                  <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                    Enregistrer
                  </button>
                </form>
                <form action={deleteProduct}>
                  <input type="hidden" name="id" value={p.id} />
                  <button className="text-xs text-slate-400 hover:text-red-600">
                    Supprimer
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <p className="px-5 py-3 border-t border-slate-100 text-xs text-slate-400">
          Le prix d&apos;achat sert de référence pour calculer ta marge. Le
          rattachement produit ↔ vente arrivera avec l&apos;automatisation.
        </p>
      </Card>
    </div>
  );
}
