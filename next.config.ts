import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Ancre Turbopack à ce projet (évite qu'il remonte vers un lockfile parent).
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Paquets à ne pas bundler côté serveur (bindings natifs de libSQL/Prisma).
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-libsql",
    "@libsql/client",
    "libsql",
  ],
};

export default nextConfig;
