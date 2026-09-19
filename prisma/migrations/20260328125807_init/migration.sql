-- CreateTable
CREATE TABLE "community_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "lastSyncAt" DATETIME,
    "totalRules" INTEGER NOT NULL DEFAULT 0,
    "importedRulesCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "community_sigma_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sigmaId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "level" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "logsourceCategory" TEXT NOT NULL DEFAULT '',
    "logsourceProduct" TEXT NOT NULL DEFAULT '',
    "logsourceService" TEXT NOT NULL DEFAULT '',
    "detectionYaml" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "repositoryUrl" TEXT NOT NULL DEFAULT '',
    "author" TEXT NOT NULL DEFAULT '',
    "date" TEXT NOT NULL DEFAULT '',
    "modified" TEXT NOT NULL DEFAULT '',
    "falsepositives" TEXT NOT NULL DEFAULT '[]',
    "references" TEXT NOT NULL DEFAULT '[]',
    "mitreTechniques" TEXT NOT NULL DEFAULT '[]',
    "changeStatus" TEXT NOT NULL DEFAULT 'new',
    "importStatus" TEXT NOT NULL DEFAULT 'not_imported',
    "upstreamLastModifiedAt" DATETIME,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sourceId" TEXT NOT NULL,
    CONSTRAINT "community_sigma_rules_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "community_sources" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "modifiedCount" INTEGER NOT NULL DEFAULT 0,
    "deletedCount" INTEGER NOT NULL DEFAULT 0,
    "totalAfterSync" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "community_sources_name_key" ON "community_sources"("name");

-- CreateIndex
CREATE INDEX "community_sigma_rules_sigmaId_idx" ON "community_sigma_rules"("sigmaId");

-- CreateIndex
CREATE INDEX "community_sigma_rules_title_idx" ON "community_sigma_rules"("title");

-- CreateIndex
CREATE INDEX "community_sigma_rules_level_idx" ON "community_sigma_rules"("level");

-- CreateIndex
CREATE INDEX "community_sigma_rules_changeStatus_idx" ON "community_sigma_rules"("changeStatus");

-- CreateIndex
CREATE INDEX "community_sigma_rules_importStatus_idx" ON "community_sigma_rules"("importStatus");

-- CreateIndex
CREATE INDEX "community_sigma_rules_logsourceProduct_idx" ON "community_sigma_rules"("logsourceProduct");

-- CreateIndex
CREATE UNIQUE INDEX "community_sigma_rules_sourceId_filePath_key" ON "community_sigma_rules"("sourceId", "filePath");
