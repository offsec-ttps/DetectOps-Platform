import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

function createClient() {
  const dbPath = path.join(process.cwd(), "dev.db");
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
  prismaSchemaVersion: string;
};

// Schema version sentinel: bump whenever new models are added so the dev
// server's HMR cache rebuilds the singleton instead of reusing a stale
// client that doesn't know about the new models.
const SCHEMA_VERSION = "2026-07-12-mcp-server";

if (globalForPrisma.prismaSchemaVersion !== SCHEMA_VERSION) {
  globalForPrisma.prisma = createClient();
  globalForPrisma.prismaSchemaVersion = SCHEMA_VERSION;
}

export const prisma = globalForPrisma.prisma;
