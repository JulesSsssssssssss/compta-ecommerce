import { redirect } from "next/navigation";

export default function SaisieRedirect() {
  const now = new Date();
  redirect(`/mois/${now.getUTCFullYear()}/${now.getUTCMonth() + 1}`);
}
