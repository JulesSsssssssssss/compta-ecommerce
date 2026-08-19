import { login } from "@/lib/auth-actions";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const hasError = params.error != null;

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <span className="grid place-items-center w-12 h-12 rounded-xl bg-brand-600 text-white text-lg mb-3">
            €
          </span>
          <h1 className="text-xl font-semibold">Compta e-commerce</h1>
          <p className="text-sm text-slate-500 mt-1">
            Entre ton mot de passe pour accéder à l&apos;application.
          </p>
        </div>
        <form action={login} className="space-y-3">
          <input
            type="password"
            name="password"
            autoFocus
            placeholder="Mot de passe"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          {hasError && (
            <p className="text-sm text-red-600">Mot de passe incorrect.</p>
          )}
          <button className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700">
            Se connecter
          </button>
        </form>
      </div>
    </div>
  );
}
