"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function login(formData: FormData) {
  const password = process.env.APP_PASSWORD;
  const entered = String(formData.get("password") || "");

  // Pas de mot de passe configuré → on laisse entrer (dev local).
  if (password && entered !== password) {
    redirect("/login?error=1");
  }

  const store = await cookies();
  store.set("auth", password ?? "ok", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 jours
  });
  redirect("/");
}

export async function logout() {
  const store = await cookies();
  store.delete("auth");
  redirect("/login");
}
