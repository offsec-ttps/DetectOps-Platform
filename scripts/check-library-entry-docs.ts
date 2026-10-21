/**
 * Docs drift check for the library-entry feature (Module Builder → "Add technique to a
 * library"). Validates, with the SAME validator the builder uses at publish time:
 *   - every example under docs/simulation/examples/*.yaml
 *   - the starter templates the builder serves (technique + lotl)
 * so the written guide can never describe a document the platform would reject.
 *
 *   npm run docs:check-entries
 *
 * Needs the local DB (target libraries + atomic tests are resolved). Exit code 1 on any
 * invalid document. Run it whenever src/lib/library-entries/schema.ts, a target library,
 * or the examples change.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { validateEntry } from "@/lib/library-entries/store";
import { templateYaml } from "@/lib/library-entries/schema";

const DIR = join(process.cwd(), "docs", "simulation", "examples");
let failed = 0;

async function check(label: string, doc: unknown) {
  const v = await validateEntry(doc, { admin: true });
  const tag = v.ok ? "ok  " : "FAIL";
  console.log(`${tag}  ${label}${v.ok ? (v.warnings.length ? `  (${v.warnings.length} warning(s))` : "") : ""}`);
  if (!v.ok) { failed++; for (const e of v.errors) console.log(`        - ${e}`); }
  for (const w of v.warnings) console.log(`        ~ ${w}`);
}

async function main() {
  for (const f of readdirSync(DIR).filter((x) => /\.ya?ml$/.test(x)).sort()) {
    const parsed: any = yaml.load(readFileSync(join(DIR, f), "utf8"));
    const entries: unknown[] = Array.isArray(parsed?.entries) ? parsed.entries : [parsed];
    for (let i = 0; i < entries.length; i++) await check(`${f}${entries.length > 1 ? ` [#${i + 1}]` : ""}`, entries[i]);
  }
  await check("builder template · technique", yaml.load(templateYaml("technique", "detectops.shellcode-injection-sim")));
  await check("builder template · lotl", yaml.load(templateYaml("lotl", "lotl:lolbas")));
  console.log(failed ? `\n${failed} document(s) invalid — update the docs/examples or the schema.` : "\nAll library-entry docs examples and templates validate.");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
