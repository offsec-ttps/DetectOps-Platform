/**
 * Dispatcher — given (sourceTable, ruleId), fetch from the right Prisma table
 * and return the normalized RuleContext for an LLM generator.
 */

import { prisma } from "@/lib/prisma";
import { parseSigmaRow } from "./sigma";
import { parseSplunkDetectionRow, parseCustomDetectionRow } from "./spl";
import { parseElasticTomlRow } from "./elastic-toml";
import { parseCommunityRuleRow } from "./kql";
import type { RuleContext } from "./shared";

export type RuleSourceTable =
  | "CommunityRule"
  | "CommunitySigmaRule"
  | "CommunityElasticRule"
  | "SplunkDetection"
  | "CustomDetection";

export const SUPPORTED_RULE_SOURCES: RuleSourceTable[] = [
  "CommunityRule",
  "CommunitySigmaRule",
  "CommunityElasticRule",
  "SplunkDetection",
  "CustomDetection",
];

export async function loadRuleContext(
  sourceTable: RuleSourceTable, ruleId: string,
): Promise<RuleContext | null> {
  switch (sourceTable) {
    case "CommunitySigmaRule": {
      const row = await prisma.communitySigmaRule.findUnique({ where: { id: ruleId } });
      return row ? parseSigmaRow(row as any) : null;
    }
    case "SplunkDetection": {
      const row = await prisma.splunkDetection.findUnique({ where: { id: ruleId } });
      return row ? parseSplunkDetectionRow(row as any) : null;
    }
    case "CustomDetection": {
      const row = await prisma.customDetection.findUnique({ where: { id: ruleId } });
      return row ? parseCustomDetectionRow(row as any) : null;
    }
    case "CommunityElasticRule": {
      const row = await prisma.communityElasticRule.findUnique({ where: { id: ruleId } });
      return row ? parseElasticTomlRow(row as any) : null;
    }
    case "CommunityRule": {
      const row = await prisma.communityRule.findUnique({ where: { id: ruleId } });
      return row ? parseCommunityRuleRow(row as any) : null;
    }
    default:
      return null;
  }
}

export type { RuleContext } from "./shared";
