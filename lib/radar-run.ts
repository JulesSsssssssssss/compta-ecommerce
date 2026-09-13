"use server";

import { refresh } from "next/cache";
import { prisma } from "./prisma";
import {
  buildSiteReport,
  normalizeDomain,
  localTimestamp,
  readableError,
  scanSite,
  today,
  type Report,
  type SiteReport,
  type Snapshot,
} from "./radar-scan";
import { loadTrends } from "./radar-trends";

/**
 * Pilotage d'un scan lancé depuis l'application.
 *
 * Le scan avance **un site par appel** : le navigateur enchaîne les étapes et
 * dessine la barre de progression au fur et à mesure. Ce découpage n'est pas
 * cosmétique — il garde chaque requête courte, donc à l'abri de la limite de
 * durée des fonctions serverless, et donne une progression réelle plutôt
 * qu'une animation qui fait semblant.
 */

/** Ce que le client a besoin de connaître pour dessiner la barre. */
export type ScanState = {
  id: string;
  status: "running" | "done" | "error";
  total: number;
  done: number;
  /** Domaine en cours de scan, ou le dernier terminé. */
  current: string | null;
  /** Nombre de sites tombés en échec, connu en fin de parcours. */
  failed: number;
  error: string | null;
};

/** Un scan interrompu (onglet fermé, réseau coupé) ne doit pas bloquer les
 *  suivants indéfiniment : au-delà de ce délai sans progression, on repart. */
const STALE_MS = 10 * 60 * 1000;

type RunRow = {
  id: string;
  status: string;
  domains: string;
  done: number;
  results: string;
  current: string | null;
  error: string | null;
  startedAt: Date;
};

function toState(run: RunRow): ScanState {
  const domains = JSON.parse(run.domains) as string[];
  const results = JSON.parse(run.results) as SiteReport[];
  return {
    id: run.id,
    status: run.status as ScanState["status"],
    total: domains.length,
    done: run.done,
    current: run.current,
    failed: results.filter((s) => s.error).length,
    error: run.error,
  };
}

/** La liste des boutiques à scanner. La table fait autorité ; si elle est vide
 *  ou injoignable, on retombe sur les domaines du dernier rapport plutôt que
 *  de ne rien scanner du tout. */
async function domainsToScan(): Promise<string[]> {
  const tracked = await prisma.radarSite
    .findMany({ orderBy: { domain: "asc" } })
    .catch(() => [] as { domain: string }[]);
  const domains: string[] = [];
  for (const t of tracked) {
    const d = normalizeDomain(t.domain);
    if (d && !domains.includes(d)) domains.push(d);
  }
  if (domains.length > 0) return domains;

  const last = await latestReport();
  for (const s of last?.sites ?? []) {
    const d = normalizeDomain(s.domain);
    if (d && !domains.includes(d)) domains.push(d);
  }
  return domains;
}

/** Le rapport le plus récent enregistré en base, s'il existe. */
async function latestReport(): Promise<Report | null> {
  const row = await prisma.radarReport
    .findFirst({ orderBy: { generatedAt: "desc" } })
    .catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as Report;
  } catch {
    return null;
  }
}

/**
 * Démarre un scan. Si un scan est déjà en cours (lancé depuis un autre
 * appareil), on rend celui-là au lieu d'en ouvrir un second : deux scans
 * simultanés se marcheraient dessus en écrivant le même snapshot du jour.
 */
export async function startRadarScan(): Promise<ScanState> {
  const running = await prisma.radarRun.findFirst({
    where: { status: "running" },
    orderBy: { startedAt: "desc" },
  });
  if (running) {
    if (Date.now() - running.startedAt.getTime() < STALE_MS) {
      return toState(running);
    }
    await prisma.radarRun.update({
      where: { id: running.id },
      data: { status: "error", error: "scan interrompu", endedAt: new Date() },
    });
  }

  const domains = await domainsToScan();
  const run = await prisma.radarRun.create({
    data: {
      domains: JSON.stringify(domains),
      current: domains[0] ?? null,
      status: domains.length > 0 ? "running" : "error",
      endedAt: domains.length > 0 ? null : new Date(),
      error: domains.length > 0 ? null : "aucune boutique à scanner",
    },
  });
  return toState(run);
}

/**
 * Scanne la boutique suivante du scan `runId` et renvoie l'avancement. Le
 * client rappelle cette fonction tant que le statut vaut "running".
 */
export async function stepRadarScan(runId: string): Promise<ScanState> {
  const run = await prisma.radarRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("scan introuvable");
  if (run.status !== "running") return toState(run);

  const domains = JSON.parse(run.domains) as string[];
  const results = JSON.parse(run.results) as SiteReport[];
  const domain = domains[run.done];
  if (!domain) return await finish(run.id, domains, results);

  const day = today();
  let site: SiteReport;
  try {
    const snap = await scanSite(domain);
    const prev = await previousSnapshot(domain, day);
    site = buildSiteReport(snap, prev, day);
    // Un second scan le même jour remplace le précédent : garder les deux
    // fausserait le diff de demain, qui se comparerait à quelques heures près.
    await prisma.radarSnapshot.upsert({
      where: { domain_date: { domain, date: day } },
      update: { payload: JSON.stringify(snap), scannedAt: new Date() },
      create: { domain, date: day, payload: JSON.stringify(snap) },
    });
  } catch (e) {
    site = { domain, error: readableError(e) };
  }

  results.push(site);
  const done = run.done + 1;
  if (done >= domains.length) return await finish(run.id, domains, results);

  const next = await prisma.radarRun.update({
    where: { id: run.id },
    data: { done, results: JSON.stringify(results), current: domains[done] },
  });
  return toState(next);
}

/** Le dernier snapshot d'un autre jour : la référence du diff. */
async function previousSnapshot(
  domain: string,
  day: string,
): Promise<Snapshot | null> {
  const row = await prisma.radarSnapshot.findFirst({
    where: { domain, date: { not: day } },
    orderBy: { date: "desc" },
  });
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as Snapshot;
  } catch {
    return null;
  }
}

/** Assemble le rapport, l'enregistre et rafraîchit la page. */
async function finish(
  runId: string,
  domains: string[],
  results: SiteReport[],
): Promise<ScanState> {
  const day = today();
  // Calculé une fois par scan plutôt qu'à chaque affichage : l'historique pèse
  // plusieurs mégaoctets, la page n'a besoin que de sa lecture.
  const trends = await loadTrends(
    results.filter((s) => !s.error).map((s) => s.domain),
    day,
  );
  const report: Report = {
    date: day,
    generated_at: localTimestamp(),
    n_sites: domains.length,
    n_strong: results.reduce((n, s) => n + (s.strong?.length ?? 0), 0),
    sites: results,
    trends,
  };
  const payload = JSON.stringify(report);
  await prisma.radarReport.upsert({
    where: { date: day },
    update: { payload, generatedAt: new Date() },
    create: { date: day, payload },
  });
  const run = await prisma.radarRun.update({
    where: { id: runId },
    data: {
      status: "done",
      done: domains.length,
      results: JSON.stringify(results),
      current: null,
      endedAt: new Date(),
    },
  });
  refresh();
  return toState(run);
}
