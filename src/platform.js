// The platform: catalog + golden paths + environments with release history and auto-rollback.
import { Cluster, Deployment } from "./cluster.js";
import { Catalog, scorecard } from "./catalog.js";
import { TEMPLATES, manifests, validateName } from "./templates.js";
import { burnAlert } from "./slo.js";
import { rng } from "./lib/rng.js";

const bump = (v) => { const [a, b, c] = v.split(".").map(Number); return `${a}.${b + 1}.${c}`; };
export class Platform {
  constructor({ nodes = 4, seed = 7, autoRollback = true } = {}) {
    this.cluster = new Cluster({ nodes }); this.catalog = new Catalog(); this.deploys = new Map(); this.history = new Map();
    this.metrics = new Map(); this.r = rng(seed); this.autoRollback = autoRollback; this.time = 0; this.stats = { deploys: 0, rollbacks: 0, provisioned: 0 };
  }
  on(fn) { this.cluster.onEvent = fn; }
  /** Golden path: validate → catalog → manifests → deployment. Returns provisioning steps. */
  provision({ name, template = "node-api", team = "platform", deps = [], ...extra }) {
    validateName(name); const t = TEMPLATES[template]; if (!t) throw new Error(`Unknown template ${template}`);
    const steps = ["Validate name & ownership", "Create repository from template", `Scaffold ${t.files.length} files`, "Configure CI pipeline", "Render Kubernetes manifests", "Register in service catalog", "Deploy v1.0.0 to dev"];
    this.catalog.add({ name, template, team, deps, lang: t.lang, docs: true, oncall: !!extra.oncall, coverage: extra.coverage ?? 72, runbook: !!extra.runbook, ...extra });
    const d = new Deployment(this.cluster, { app: name, replicas: t.replicas, cpu: t.cpu, mem: t.mem });
    this.deploys.set(name, d); this.history.set(name, []); this.metrics.set(name, []);
    this.stats.provisioned++; this.cluster.emit("acc", `Provisioned ${name} from ${template} (${team})`, { app: name });
    this.release(name, "1.0.0");
    return { steps, manifests: manifests({ name, template, team }) };
  }
  release(name, version, { faulty = false } = {}) {
    const d = this.deploys.get(name); if (!d) throw new Error(`Unknown service ${name}`);
    version ||= bump(d.version || "0.9.0");
    const h = this.history.get(name); h.push({ version, at: this.time, faulty, status: "rolling" }); d.rollout(version, { faulty }); this.stats.deploys++;
    return version;
  }
  rollback(name, reason = "manual") {
    const h = this.history.get(name), d = this.deploys.get(name);
    const prev = [...h].reverse().find((x) => x.version !== d.version && x.status !== "rolled-back" && !x.faulty);
    if (!prev) { this.cluster.emit("warn", `No healthy revision to roll back ${name} to`); return null; }
    const cur = h.at(-1); cur.status = "rolled-back"; this.stats.rollbacks++;
    this.cluster.emit("bad", `↩ Rolling back ${name} ${d.version} → ${prev.version} (${reason})`, { app: name });
    h.push({ version: prev.version, at: this.time, faulty: false, status: "rolling", rollbackOf: cur.version }); d.rollout(prev.version);
    return prev.version;
  }
  /** Simulate traffic + reconcile. Faulty pods return ~30% 5xx and 4× latency. */
  tick(dt = 1) {
    this.time += dt; this.cluster.tick(dt);
    for (const [name, d] of this.deploys) {
      d.reconcile();
      const pods = this.cluster.running(name), svc = this.catalog.get(name);
      const rps = pods.length ? 120 + 40 * Math.sin(this.time / 6 + name.length) + this.r() * 20 : 0;
      const bad = pods.filter((p) => p.faulty).length, frac = pods.length ? bad / pods.length : 0;
      const errRatio = pods.length ? 0.002 + frac * 0.3 + this.r() * 0.002 : 0;
      const p95 = 38 + this.r() * 10 + frac * 160;
      const m = this.metrics.get(name); m.push({ t: this.time, rps, p95, errRatio, errors: rps * errRatio * dt, total: Math.max(1, rps * dt) }); if (m.length > 300) m.shift();
      const h = this.history.get(name).at(-1); if (h && h.status === "rolling" && !d.rolling) h.status = "live";
      if (this.autoRollback && pods.length && m.length >= 5) {
        const a = burnAlert(m, svc.slo, { fast: 3, slow: 8 });
        if (a.firing && h?.faulty && h.status !== "rolled-back") this.rollback(name, `SLO burn ${a.fast.toFixed(0)}× budget`);
      }
    }
  }
  snapshot() {
    return this.catalog.list().map((s) => { const m = this.metrics.get(s.name).at(-1) || {}; const d = this.deploys.get(s.name); return { name: s.name, team: s.team, template: s.template, version: d.version, rolling: d.rolling, ready: this.cluster.running(s.name).length, replicas: d.replicas, rps: m.rps || 0, p95: m.p95 || 0, errRatio: m.errRatio || 0, score: scorecard(s) }; });
  }
}
