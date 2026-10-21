import { NextResponse } from "next/server";
import { analyzeProject } from "@/lib/docs-agent/analyzer";
import { generateDocs } from "@/lib/docs-agent/generator";
import { requireRole } from "@/lib/auth-guard";

export async function POST() {
  // Internet-fetching / bulk-rewriting maintenance op: admin only (dev: open).
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  try {
    const analysis = analyzeProject();
    const files = generateDocs(analysis);

    return NextResponse.json({
      status: "completed",
      timestamp: analysis.timestamp,
      stats: {
        pages: analysis.pageCount,
        apiEndpoints: analysis.apiCount,
        components: analysis.componentCount,
        types: analysis.typeCount,
        dataFlows: analysis.dataFlows.length,
      },
      filesGenerated: files,
    });
  } catch (err) {
    return NextResponse.json(
      { status: "failed", error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const analysis = analyzeProject();

    return NextResponse.json({
      timestamp: analysis.timestamp,
      stats: {
        pages: analysis.pageCount,
        apiEndpoints: analysis.apiCount,
        components: analysis.componentCount,
        types: analysis.typeCount,
        dataFlows: analysis.dataFlows.length,
        dependencies: Object.keys(analysis.dependencies).length,
      },
      routes: analysis.routes,
      apiEndpoints: analysis.apiEndpoints,
      components: analysis.components,
      types: analysis.types,
      dataFlows: analysis.dataFlows,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
