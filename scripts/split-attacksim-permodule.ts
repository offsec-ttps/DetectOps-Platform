/**
 * Split the combined attack-sim coverage sweep into ONE assessment + report per
 * module/library, reusing the results already collected (no re-detonation), so
 * each module shows up separately under Reporting with its own coverage + gaps.
 */
import { prisma } from "@/lib/prisma";
import { resolveScope, listLibraries } from "@/lib/coverage-assessment/scope";
import { aggregate, type ItemLite } from "@/lib/coverage-assessment/aggregate";
import { renderReport, renderBrandedReport, type RenderItem } from "@/lib/coverage-assessment/render";
import { randomUUID } from "node:crypto";

const SRC = process.argv[2] || "fcc15fc3-caae-442c-ad8b-46d84426bb89";

(async () => {
  const src = await prisma.coverageAssessment.findUnique({ where: { id: SRC } });
  if (!src) { console.error("source assessment not found"); process.exit(1); }
  const srcItems = await prisma.coverageAssessmentItem.findMany({ where: { assessmentId: SRC } });
  const byKey = new Map(srcItems.map((i) => [`${i.tech}#${i.num}`, i]));
  const libs = await listLibraries();

  for (const lib of libs) {
    const atoms = await resolveScope({ mode: "libraries", libraries: [lib.moduleId] });
    // Only the atoms actually tested in the combined sweep (installed on host).
    const tested = atoms.filter((a) => byKey.has(`${a.tech}#${a.num}`));
    if (!tested.length) { console.log(`${lib.label}: no tested atoms — skipped`); continue; }

    const id = randomUUID();
    const itemsData = tested.map((a, idx) => {
      const s = byKey.get(`${a.tech}#${a.num}`)!;
      return {
        assessmentId: id, tech: a.tech, num: a.num, name: a.name, tactic: a.tactic, library: lib.label, order: idx,
        status: s.status, executed: s.executed, observed: s.observed, visBucket: s.visBucket, obsCount: s.obsCount,
        indicators: s.indicators, obsEventCodes: s.obsEventCodes, obsSources: s.obsSources, tail: s.tail,
        processedAt: s.processedAt ?? new Date(),
      };
    });

    await prisma.coverageAssessment.create({ data: {
      id, name: `${lib.label} (module coverage) — Fleet 192.168.56.14`,
      assessor: src.assessor, client: src.client, lab: src.lab,
      environmentId: src.environmentId, siemConnectionId: src.siemConnectionId,
      scope: JSON.stringify({ mode: "libraries", libraries: [lib.moduleId] }), detectionNote: src.detectionNote || "",
      status: "rendering", atomicsTotal: itemsData.length, processed: itemsData.length,
      executedCount: 0, visibleCount: 0, genericCount: 0, absentCount: 0, naCount: 0, failedCount: 0,
      snapshotRequested: false, snapshotName: "", metrics: "{}", reportMd: "", reportPaths: "{}",
      ownerId: src.ownerId, actor: src.actor, startedAt: src.startedAt ?? src.createdAt,
    } });
    await prisma.coverageAssessmentItem.createMany({ data: itemsData });

    const items = await prisma.coverageAssessmentItem.findMany({ where: { assessmentId: id }, orderBy: { order: "asc" } });
    const J = (s: string) => { try { return JSON.parse(s || "[]"); } catch { return []; } };
    const exe = items.filter((i) => i.status === "executed").length;
    const fail = items.filter((i) => i.status === "failed").length;
    const na = items.filter((i) => i.status === "n/a").length;
    const vis = items.filter((i) => i.visBucket === "visible").length;
    const gen = items.filter((i) => i.visBucket === "generic-only").length;
    const abs = items.filter((i) => i.visBucket === "absent").length;
    const lite: ItemLite[] = items.map((i) => ({ tech: i.tech, num: i.num, name: i.name, tactic: i.tactic, library: i.library, status: i.status, executed: i.executed, visBucket: i.visBucket, indicators: J(i.indicators) }));
    const metrics = aggregate(lite);
    const renderItems: RenderItem[] = items.map((i) => ({ tech: i.tech, num: i.num, name: i.name, tactic: i.tactic, status: i.status, executed: i.executed, observed: i.observed, vis_bucket: i.visBucket, vis_count: i.obsCount, indicators: J(i.indicators), tail: i.tail, event_codes: J(i.obsEventCodes), sources: J(i.obsSources) }));

    const reportPaths: Record<string, unknown> = {};
    let reportMd = "";
    try {
      const r = await renderReport({ assessmentId: id, assessor: src.assessor, client: src.client, lab: src.lab, brand: src.assessor || "RuSecure", siem: "splunk", detectionNote: src.detectionNote || "", items: renderItems });
      reportMd = r.markdown;
      Object.assign(reportPaths, { executive: r.executive, technical: r.technical, ...r.technical });
    } catch (e: any) { reportMd = `render failed: ${e?.message || e}`; }

    await prisma.coverageAssessment.update({ where: { id }, data: {
      status: "completed", completedAt: new Date(), executedCount: exe, failedCount: fail, naCount: na,
      visibleCount: vis, genericCount: gen, absentCount: abs, metrics: JSON.stringify(metrics), reportMd, reportPaths: JSON.stringify(reportPaths),
    } });

    try {
      const b = await renderBrandedReport(id);
      if (b.pdf || b.html) { if (b.pdf) (reportPaths as any).branded = { pdf: b.pdf, ...(b.html ? { html: b.html } : {}) };
        await prisma.coverageAssessment.update({ where: { id }, data: { reportPaths: JSON.stringify(reportPaths) } }); }
    } catch { /* branded best-effort */ }

    console.log(`${lib.label}: id=${id.slice(0, 8)} atoms=${items.length} exe=${exe} vis=${vis} gen=${gen} abs=${abs} fail=${fail} na=${na}`);
  }
  process.exit(0);
})();
