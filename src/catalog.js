// Service catalog with dependency graph and maturity scorecards.
export const CHECKS = [
  { id: "owner", label: "Has an owning team", w: 15, test: (s) => !!s.team },
  { id: "docs", label: "README + API docs", w: 15, test: (s) => !!s.docs },
  { id: "oncall", label: "On-call rotation", w: 15, test: (s) => !!s.oncall },
  { id: "slo", label: "SLO defined", w: 20, test: (s) => s.slo > 0 },
  { id: "tests", label: "Test coverage ≥ 70%", w: 15, test: (s) => (s.coverage || 0) >= 70 },
  { id: "runbook", label: "Runbook linked", w: 10, test: (s) => !!s.runbook },
  { id: "deps", label: "No deprecated deps", w: 10, test: (s) => !s.deprecatedDeps },
];
export function scorecard(s) {
  const results = CHECKS.map((c) => ({ id: c.id, label: c.label, pass: !!c.test(s), w: c.w }));
  const score = results.reduce((t, r) => t + (r.pass ? r.w : 0), 0);
  const level = score >= 90 ? "Gold" : score >= 70 ? "Silver" : score >= 45 ? "Bronze" : "Needs work";
  return { score, level, results };
}
export class Catalog {
  constructor() { this.services = new Map(); }
  add(s) { if (this.services.has(s.name)) throw new Error(`Service ${s.name} already exists`); const svc = { deps: [], slo: 99.9, ...s }; this.services.set(s.name, svc); return svc; }
  get(n) { return this.services.get(n); }
  list() { return [...this.services.values()]; }
  /** Services that depend on `name` (transitively) — the blast radius of an incident. */
  blastRadius(name) { const out = new Set(), q = [name]; while (q.length) { const x = q.shift(); for (const s of this.services.values()) if (s.deps.includes(x) && !out.has(s.name)) { out.add(s.name); q.push(s.name); } } return [...out]; }
  /** Topological deploy order (dependencies first). Throws on cycles. */
  order() { const seen = new Map(), out = []; const visit = (n, path = []) => { if (seen.get(n) === 1) throw new Error(`Dependency cycle: ${[...path, n].join(" → ")}`); if (seen.get(n) === 2) return; seen.set(n, 1); for (const d of this.services.get(n)?.deps || []) if (this.services.has(d)) visit(d, [...path, n]); seen.set(n, 2); out.push(n); }; for (const n of this.services.keys()) visit(n); return out; }
}
