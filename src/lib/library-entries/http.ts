import yaml from "js-yaml";
import { requireUser } from "@/lib/auth-guard";
import type { Actor } from "./store";

const MAX_BYTES = 256 * 1024;

/** Parse a request body carrying either { yaml: "<text>" } or { doc: {...} } (JSON text also accepted). */
export function parseEntryInput(body: any): { ok: true; value: unknown } | { ok: false; error: string } {
  if (body && typeof body === "object" && body.doc && typeof body.doc === "object") return { ok: true, value: body.doc };
  const text = typeof body?.yaml === "string" ? body.yaml : typeof body?.text === "string" ? body.text : "";
  if (!text.trim()) return { ok: false, error: "provide { yaml: \"...\" } or { doc: {...} }" };
  if (text.length > MAX_BYTES) return { ok: false, error: "document too large (max 256 KB)" };
  try {
    // js-yaml 4 `load` uses the safe default schema (no code execution); JSON is valid YAML.
    return { ok: true, value: yaml.load(text) };
  } catch (e: any) {
    return { ok: false, error: `YAML/JSON parse error: ${String(e?.message || e).split("\n")[0]}` };
  }
}

export function toYaml(doc: unknown): string {
  return yaml.dump(doc, { lineWidth: 100, noRefs: true, sortKeys: false });
}

export async function authedActor(): Promise<{ ok: true; actor: Actor } | { ok: false; response: Response }> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, response: auth.response };
  return { ok: true, actor: { email: auth.user.email, admin: auth.user.role === "admin" } };
}
