/**
 * Mode C — AI phishing-content generation for AUTHORIZED security-awareness
 * simulation. Reuses the platform LLM dispatcher (runTool). Produces a training
 * lure (subject/body/landing copy) plus the detection indicators it should
 * exercise. Gated at the campaign level (approval before launch); every prompt
 * is logged for audit. Best-effort: returns null on no-provider/failure.
 */

import { runTool } from "@/lib/llm";

export interface GeneratedLure {
  subject: string;
  body: string;
  landingCopy: string;
  indicators: string[];     // observable artifacts a defender should detect
  techniques: string[];     // ATT&CK ids the lure exercises
}

export async function generateLure(input: { scenario: string; targetPersona: string; company?: string }): Promise<{ ok: boolean; lure?: GeneratedLure; error?: string }> {
  try {
    const res = await runTool<GeneratedLure>({
      system:
        "You generate phishing-simulation content for an AUTHORIZED security-awareness and detection-engineering program (internal, consented, audited). " +
        "Produce a realistic but clearly training-grade lure. Use placeholder tokens like {Name}, {Company}, {link} rather than real targets or real malicious URLs. " +
        "Do NOT include working exploit code, real credential-harvesting backends, or real malware. Also list the observable detection indicators and ATT&CK techniques the lure exercises so defenders can validate coverage.",
      user:
        `Scenario: ${input.scenario}\nTarget persona: ${input.targetPersona}\nCompany: ${input.company || "{Company}"}\n` +
        `Return an email subject, an email body (HTML with placeholders), short landing-page copy, the detection indicators, and the ATT&CK technique IDs (e.g. T1566.002).`,
      maxTokens: 1100,
      tool: {
        name: "phishing_lure",
        description: "A training phishing lure for authorized simulation + the detection indicators it exercises.",
        input_schema: {
          type: "object",
          properties: {
            subject: { type: "string" },
            body: { type: "string", description: "HTML with {placeholders}; no real malicious URLs" },
            landingCopy: { type: "string" },
            indicators: { type: "array", items: { type: "string" } },
            techniques: { type: "array", items: { type: "string" } },
          },
          required: ["subject", "body"],
        },
      },
    });
    const d = res.data || ({} as GeneratedLure);
    return { ok: true, lure: {
      subject: d.subject || "", body: d.body || "", landingCopy: d.landingCopy || "",
      indicators: Array.isArray(d.indicators) ? d.indicators : [],
      techniques: (Array.isArray(d.techniques) ? d.techniques : []).filter((t) => /^T\d{4}(\.\d{3})?$/.test(t)),
    } };
  } catch (e: any) {
    return { ok: false, error: e?.message || "AI generation unavailable" };
  }
}
