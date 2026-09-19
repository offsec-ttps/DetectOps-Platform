/**
 * AI reviewer for a submitted module. Reuses the platform LLM dispatcher
 * (runTool, provider auto-selected) to judge safety/scope. Forced tool schema
 * → { verdict, rationale, concerns }. Failures (no provider, network) are
 * caught by the caller and treated as "needs-human".
 */

import { runTool } from "@/lib/llm";
import type { ModuleManifest } from "@/lib/modules/types";
import type { CheckResult } from "./checks";

export interface AiReview { verdict: "approve" | "needs-human" | "reject"; rationale: string; concerns: string[] }

export async function aiReviewModule(manifest: ModuleManifest, checks: CheckResult[]): Promise<{ review: AiReview; costUsd: number }> {
  const summary = checks.map((c) => `- ${c.name}: ${c.status} (${c.detail})`).join("\n");
  const compiledSteps = (manifest.contributes?.scenarios || [])
    .flatMap((s) => s.steps.map((st) => `${s.name} → ${st.framework}${st.refId ? ` ${st.refId}` : ""} ${st.techniqueId || ""}`))
    .join("\n");

  const res = await runTool<AiReview>({
    system:
      "You are a security reviewer for a cyber-simulation marketplace. Modules are DECLARATIVE: they may only orchestrate already-curated Atomic Red Team tests and declared frameworks — they cannot ship arbitrary code. " +
      "Approve only if: the manifest is coherent, the declared permissions match the steps, nothing looks like an attempt to exceed the declared scope, and the automated checks did not fail. " +
      "Return verdict 'reject' for clearly malicious/deceptive intent, 'needs-human' when uncertain or any check failed, 'approve' when confidently safe.",
    user:
      `Module: ${manifest.id}@${manifest.version} (${manifest.category})\n` +
      `Name: ${manifest.name}\nAuthor: ${manifest.author}\nDescription: ${manifest.description}\n\n` +
      `Declared frameworks: ${(manifest.permissions?.frameworks || []).join(", ")}\n` +
      `Declared integrations: ${(manifest.permissions?.integrations || []).join(", ") || "none"}\n\n` +
      `Compiled steps:\n${compiledSteps || "(none)"}\n\n` +
      `Automated checks:\n${summary}`,
    maxTokens: 700,
    tool: {
      name: "module_review",
      description: "Record the safety review verdict for this simulation module.",
      input_schema: {
        type: "object",
        properties: {
          verdict: { type: "string", enum: ["approve", "needs-human", "reject"] },
          rationale: { type: "string", description: "One-paragraph justification." },
          concerns: { type: "array", items: { type: "string" }, description: "Specific concerns, if any." },
        },
        required: ["verdict", "rationale"],
      },
    },
  });

  const data = res.data || ({} as AiReview);
  return {
    review: {
      verdict: data.verdict === "approve" || data.verdict === "reject" ? data.verdict : "needs-human",
      rationale: data.rationale || "",
      concerns: Array.isArray(data.concerns) ? data.concerns : [],
    },
    costUsd: res.costUsd || 0,
  };
}
