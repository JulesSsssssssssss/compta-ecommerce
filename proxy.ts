import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Gate d'accès simple par mot de passe.
// Actif uniquement si la variable d'environnement APP_PASSWORD est définie.
// Sinon (dev local), l'accès est libre.
export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const cookie = request.cookies.get("auth")?.value;
  if (cookie === password) return NextResponse.next();

  const url = new URL("/login", request.url);
  return NextResponse.redirect(url);
}

export const config = {
  // Toutes les routes sauf /login, les assets et les fichiers statiques.
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
