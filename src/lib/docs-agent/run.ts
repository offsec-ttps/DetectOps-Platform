import { analyzeProject } from "./analyzer";
import { generateDocs } from "./generator";

console.log("📄 Docs Agent — Analyzing project...\n");

const analysis = analyzeProject();

console.log(`  Found ${analysis.pageCount} pages`);
console.log(`  Found ${analysis.apiCount} API endpoints`);
console.log(`  Found ${analysis.componentCount} components`);
console.log(`  Found ${analysis.typeCount} type definitions`);
console.log(`  Found ${analysis.dataFlows.length} data flow edges\n`);

console.log("📝 Generating documentation...\n");

const files = generateDocs(analysis);

for (const f of files) {
  console.log(`  ✓ docs/generated/${f}`);
}

console.log(`\n✅ Done — ${files.length} docs generated at docs/generated/`);
