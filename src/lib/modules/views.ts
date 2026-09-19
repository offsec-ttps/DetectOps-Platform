/**
 * Built-in rich module views. A module manifest may declare
 * `contributes.view = "<id>"` to render one of these instead of the default
 * scenario list. Keeps modules declarative while allowing first-party rich UIs
 * (ransomware intelligence today; phishing-intel etc. later).
 *
 * The id list is the source of truth for manifest validation; the catch-all
 * module page maps the id → component (client-side, to avoid bundling all view
 * components on the server).
 */

export const BUILTIN_MODULE_VIEW_IDS = ["ransomware-intel", "technique-catalog", "phishing-sim"] as const;
export type BuiltinModuleViewId = (typeof BUILTIN_MODULE_VIEW_IDS)[number];

export function isBuiltinModuleView(id: string | undefined): id is BuiltinModuleViewId {
  return !!id && (BUILTIN_MODULE_VIEW_IDS as readonly string[]).includes(id);
}
