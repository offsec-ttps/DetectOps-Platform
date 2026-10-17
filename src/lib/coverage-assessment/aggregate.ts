// Three-bucket aggregation for the UI/status payload. Mirrors the markdown
// report's model so the on-screen numbers and the rendered report agree:
// visibility % = visible / (visible + blind); generic-only atomics are excluded
// from the ratio (indeterminate).

export interface ItemLite {
  tech: string; num: number; name: string; tactic: string; library: string;
  status: string; executed: boolean; visBucket: string; indicators: string[];
}
interface Group { atomics: number; executed: number; visible: number; generic: number; absent: number }

export interface Metrics {
  total: number; runnable: number; executed: number;
  visible: number; generic: number; absent: number; na: number; failed: number;
  visibilityPct: number;
  byTactic: Array<{ key: string } & Group & { pct: number }>;
  byLibrary: Array<{ key: string } & Group & { pct: number }>;
  blindSpots: Array<{ tech: string; num: number; name: string; tactic: string; library: string; indicators: string[] }>;
}

function emptyGroup(): Group { return { atomics: 0, executed: 0, visible: 0, generic: 0, absent: 0 }; }
function pct(n: number, d: number): number { return d ? Math.round((100 * n) / d) : 0; }

export function aggregate(items: ItemLite[]): Metrics {
  const total = items.length;
  const na = items.filter((i) => i.status === "n/a").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const runnable = items.filter((i) => i.status !== "n/a" && i.status !== "pending");
  const executed = runnable.filter((i) => i.executed);
  const visible = executed.filter((i) => i.visBucket === "visible").length;
  const generic = executed.filter((i) => i.visBucket === "generic-only").length;
  const absent = executed.filter((i) => i.visBucket === "absent").length;

  const tac = new Map<string, Group>();
  const lib = new Map<string, Group>();
  const bump = (m: Map<string, Group>, key: string, i: ItemLite) => {
    if (!key) return;
    const g = m.get(key) || emptyGroup();
    g.atomics += 1;
    if (i.executed) g.executed += 1;
    if (i.visBucket === "visible") g.visible += 1;
    else if (i.visBucket === "generic-only") g.generic += 1;
    else if (i.visBucket === "absent") g.absent += 1;
    m.set(key, g);
  };
  for (const i of runnable) {
    bump(tac, (i.tactic || "other").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), i);
    bump(lib, i.library || "General", i);
  }
  const toRows = (m: Map<string, Group>) =>
    [...m.entries()]
      .map(([key, g]) => ({ key, ...g, pct: pct(g.visible, g.visible + g.absent) }))
      .sort((a, b) => b.atomics - a.atomics);

  const blindSpots = executed
    .filter((i) => i.visBucket === "absent")
    .map((i) => ({ tech: i.tech, num: i.num, name: i.name, tactic: i.tactic, library: i.library, indicators: i.indicators }));

  return {
    total, runnable: runnable.length, executed: executed.length,
    visible, generic, absent, na, failed,
    visibilityPct: pct(visible, visible + absent),
    byTactic: toRows(tac), byLibrary: toRows(lib), blindSpots,
  };
}
