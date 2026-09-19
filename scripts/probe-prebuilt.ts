import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
const dbPath = path.join(process.cwd(), "dev.db");
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${dbPath}` }) });
(async () => {
  const r = await prisma.buildRepo.findUnique({ where: { name: "Flangvik/SharpCollection" } });
  console.log("fields on row:", r ? Object.keys(r).filter(k => /prebuilt|category|mitre|risk/i.test(k)) : "null");
  console.log("prebuiltInfo raw:", r?.prebuiltInfo);
  await prisma.$disconnect();
})();
