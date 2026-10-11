"use server";

import { revalidatePath } from "next/cache";
import { requestSession, type AdSession } from "./radar-ads";

/** Le bouton « Lancer une veille TikTok » : il dépose la demande, une session
 *  Claude fait le reste (voir scripts/radar-ads.mjs). */
export async function askAdWatch(): Promise<AdSession> {
  const session = await requestSession();
  revalidatePath("/radar");
  revalidatePath("/radar/tiktok");
  return session;
}
