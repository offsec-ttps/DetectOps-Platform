import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { requireUser } from "@/lib/auth-guard";
import { randomUUID } from "node:crypto";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  // Pagination
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("page_size") || "50", 10)));

  // Filters
  const search = searchParams.get("search") || "";
  const techniqueId = searchParams.get("technique_id") || "";
  const tactic = searchParams.get("tactic") || "";
  const platform = searchParams.get("platform") || "";
  const executor = searchParams.get("executor") || "";
  const elevation = searchParams.get("elevation"); // "true" | "false" | null
  const sortBy = searchParams.get("sort_by") || "techniqueId";
  const sortDir = searchParams.get("sort_dir") === "desc" ? "desc" : "asc";

  // Build where clause
  const where: Record<string, unknown> = {};

  if (search) {
    where.OR = [
      { testName: { contains: search } },
      { testDescription: { contains: search } },
      { techniqueId: { contains: search } },
      { techniqueName: { contains: search } },
    ];
  }
  if (techniqueId) where.techniqueId = { contains: techniqueId };
  if (tactic) where.tactic = tactic;
  if (platform) where.platforms = { contains: platform };
  if (executor) where.executorName = executor;
  if (elevation === "true") where.elevationRequired = true;
  if (elevation === "false") where.elevationRequired = false;

  const [tests, total] = await Promise.all([
    prisma.atomicTest.findMany({
      where: where as any,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.atomicTest.count({ where: where as any }),
  ]);

  // Parse JSON fields
  const items = tests.map((t) => ({
    ...t,
    platforms: JSON.parse(t.platforms),
    inputArguments: JSON.parse(t.inputArguments),
    dependencies: JSON.parse(t.dependencies),
  }));

  // Aggregate stats (only on first page to avoid extra queries)
  let stats = null;
  if (page === 1) {
    const [totalTests, techniques, tactics, platforms, executors] =
      await Promise.all([
        prisma.atomicTest.count(),
        prisma.atomicTest.groupBy({ by: ["techniqueId"], _count: true }),
        prisma.atomicTest.groupBy({ by: ["tactic"], _count: true }),
        prisma.atomicTest.findMany({
          select: { platforms: true },
          distinct: ["platforms"],
        }),
        prisma.atomicTest.groupBy({ by: ["executorName"], _count: true }),
      ]);

    // Extract unique platforms from JSON arrays
    const platformSet = new Set<string>();
    for (const p of platforms) {
      for (const val of JSON.parse(p.platforms)) {
        if (val) platformSet.add(val);
      }
    }

    const lastSync = await prisma.atomicSyncMeta.findFirst({
      where: { status: "completed" },
      orderBy: { completedAt: "desc" },
    });

    stats = {
      totalTests,
      totalTechniques: techniques.length,
      tactics: tactics
        .filter((t) => t.tactic)
        .map((t) => ({ name: t.tactic, count: t._count }))
        .sort((a, b) => b.count - a.count),
      platforms: Array.from(platformSet).sort(),
      executors: executors
        .filter((e) => e.executorName)
        .map((e) => ({ name: e.executorName, count: e._count }))
        .sort((a, b) => b.count - a.count),
      lastSyncAt: lastSync?.completedAt?.toISOString() || null,
      lastSyncCommit: lastSync?.commitSha || null,
    };
  }

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    stats,
  });
}

/**
 * POST /api/atomic-tests
 *
 * Save a *custom* atomic test (authored in the AtomicBuilder) into the
 * library. Distinguished from upstream rows via `source="custom"`. The
 * `[techniqueId, testNumber]` unique key is honoured — we pick the next
 * free testNumber for the technique so custom rows can sit alongside
 * upstream rows under the same T-ID.
 *
 * Body shape mirrors AtomicYamlInput. JSON fields are re-stringified for
 * SQLite storage.
 */
export async function POST(req: NextRequest) {
  // Custom atomic tests carry executable command/cleanup strings that are
  // later run on lab hosts, so writing to the shared library requires a session
  // (enforced in production / AUTH_ENFORCE=1).
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));

  // Minimal validation — mirror the form-level rules. Technique IDs are
  // upper-cased so a custom test authored as `t1059.001` groups under the same
  // key as upstream `T1059.001` rows (SQLite equality is case-sensitive).
  const attack_technique = String(body.attack_technique || "").trim().toUpperCase();
  const display_name = String(body.display_name || "").trim();
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim();
  const supported_platforms = Array.isArray(body.supported_platforms)
    ? body.supported_platforms.map(String).filter(Boolean) : [];
  const executor = body.executor && typeof body.executor === "object" ? body.executor : {};
  const executorName = String(executor.name || "").trim();
  const command = String(executor.command || "");
  const cleanup = String(executor.cleanup_command || "");
  const steps = String(executor.steps || "");
  const elevation = !!executor.elevation_required;
  const input_arguments = Array.isArray(body.input_arguments) ? body.input_arguments : [];
  const dependencies = Array.isArray(body.dependencies) ? body.dependencies : [];

  if (!/^T\d{4}(\.\d{3})?$/i.test(attack_technique)) {
    return NextResponse.json({ error: "attack_technique must be T#### or T####.###" }, { status: 400 });
  }
  if (!display_name || !name || !description) {
    return NextResponse.json({ error: "display_name, name, and description are required" }, { status: 400 });
  }
  if (supported_platforms.length === 0) {
    return NextResponse.json({ error: "at least one supported_platforms entry is required" }, { status: 400 });
  }
  if (!executorName) {
    return NextResponse.json({ error: "executor.name is required" }, { status: 400 });
  }
  if (executorName !== "manual" && !command) {
    return NextResponse.json({ error: "executor.command is required for non-manual executors" }, { status: 400 });
  }
  if (executorName === "manual" && !steps) {
    return NextResponse.json({ error: "executor.steps is required for manual executor" }, { status: 400 });
  }

  // Pick the next free testNumber for this technique
  const last = await prisma.atomicTest.findFirst({
    where: { techniqueId: attack_technique },
    orderBy: { testNumber: "desc" },
    select: { testNumber: true },
  });
  const testNumber = (last?.testNumber ?? 0) + 1;

  // Normalise input_arguments: schema column is a JSON OBJECT keyed by name
  // (matches the original ART YAML), but the builder ships an array.
  const ia: Record<string, { description: string; type: string; default: string }> = {};
  for (const a of input_arguments) {
    if (!a?.name) continue;
    ia[String(a.name)] = {
      description: String(a.description || ""),
      type: String(a.type || "string"),
      default: a.default == null ? "" : String(a.default),
    };
  }

  // Filter empty dependency rows
  const deps = dependencies
    .filter((d: any) => d && (d.description || d.prereq_command))
    .map((d: any) => ({
      description: String(d.description || ""),
      prereq_command: String(d.prereq_command || ""),
      get_prereq_command: String(d.get_prereq_command || ""),
    }));

  // Generate a v4 GUID if the caller didn't provide one
  const incomingGuid = typeof body.auto_generated_guid === "string" && body.auto_generated_guid
    ? body.auto_generated_guid
    : "";
  const testGuid = incomingGuid || randomUUID();

  const sessionUser = auth.user;

  try {
    const row = await prisma.atomicTest.create({
      data: {
        techniqueId: attack_technique,
        techniqueName: display_name,
        testNumber,
        testGuid,
        testName: name,
        testDescription: description,
        platforms: JSON.stringify(supported_platforms),
        elevationRequired: elevation,
        executorName,
        command: executorName === "manual" ? "" : command,
        cleanupCommand: cleanup,
        inputArguments: JSON.stringify(ia),
        dependencies: JSON.stringify(deps),
        tactic: String(body.tactic || ""),
        sourceUrl: "",
        contentHash: "",
        source: "custom",
        createdBy: sessionUser?.id || "",
      },
    });

    void logEvent({
      category: "usecase", action: "atomic-test.library.create",
      actor: sessionUser?.email || "anonymous", status: "ok",
      targetType: "AtomicTest", targetId: row.id,
      message: `${attack_technique} · ${name} (testNumber=${testNumber})`,
      details: { techniqueId: attack_technique, testNumber, executor: executorName, platforms: supported_platforms.length },
    });

    return NextResponse.json({
      id: row.id, techniqueId: row.techniqueId, testNumber: row.testNumber,
      testGuid: row.testGuid, testName: row.testName, source: row.source,
    });
  } catch (err: any) {
    // SQLite reports unique-violation via err.code = "P2002"
    if (err?.code === "P2002") {
      return NextResponse.json({
        error: `A test for ${attack_technique} with testNumber ${testNumber} already exists. Try again.`,
      }, { status: 409 });
    }
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
