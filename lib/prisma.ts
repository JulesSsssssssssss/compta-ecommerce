import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";

// Connexion via l'adaptateur libSQL :
// - en ligne (Vercel)  : base Turso, via TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
// - en local sans Turso : fichier SQLite local prisma/dev.db
const url = process.env.TURSO_DATABASE_URL ?? "file:./prisma/dev.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

// Singleton Prisma pour éviter de multiplier les connexions en dev (hot reload).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaLibSQL({ url, authToken }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
