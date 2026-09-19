-- CreateTable
CREATE TABLE "community_elastic_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "severity" TEXT NOT NULL DEFAULT '',
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT '',
    "query" TEXT NOT NULL DEFAULT '',
    "index" TEXT NOT NULL DEFAULT '[]',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "threat" TEXT NOT NULL DEFAULT '[]',
    "mitreTechniques" TEXT NOT NULL DEFAULT '[]',
    "mitreTactics" TEXT NOT NULL DEFAULT '[]',
    "author" TEXT NOT NULL DEFAULT '[]',
    "references" TEXT NOT NULL DEFAULT '[]',
    "falsepositives" TEXT NOT NULL DEFAULT '[]',
    "note" TEXT NOT NULL DEFAULT '',
    "setup" TEXT NOT NULL DEFAULT '',
    "ruleContent" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "repositoryUrl" TEXT NOT NULL DEFAULT '',
    "platform" TEXT NOT NULL DEFAULT '',
    "maturity" TEXT NOT NULL DEFAULT '',
    "integration" TEXT NOT NULL DEFAULT '[]',
    "createdDate" TEXT NOT NULL DEFAULT '',
    "updatedDate" TEXT NOT NULL DEFAULT '',
    "changeStatus" TEXT NOT NULL DEFAULT 'new',
    "importStatus" TEXT NOT NULL DEFAULT 'not_imported',
    "contentHash" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sourceId" TEXT NOT NULL,
    CONSTRAINT "community_elastic_rules_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "community_sources" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "community_elastic_rules_ruleId_idx" ON "community_elastic_rules"("ruleId");

-- CreateIndex
CREATE INDEX "community_elastic_rules_name_idx" ON "community_elastic_rules"("name");

-- CreateIndex
CREATE INDEX "community_elastic_rules_severity_idx" ON "community_elastic_rules"("severity");

-- CreateIndex
CREATE INDEX "community_elastic_rules_changeStatus_idx" ON "community_elastic_rules"("changeStatus");

-- CreateIndex
CREATE INDEX "community_elastic_rules_importStatus_idx" ON "community_elastic_rules"("importStatus");

-- CreateIndex
CREATE INDEX "community_elastic_rules_platform_idx" ON "community_elastic_rules"("platform");

-- CreateIndex
CREATE INDEX "community_elastic_rules_type_idx" ON "community_elastic_rules"("type");

-- CreateIndex
CREATE UNIQUE INDEX "community_elastic_rules_sourceId_filePath_key" ON "community_elastic_rules"("sourceId", "filePath");
