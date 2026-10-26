// Kubernetes-style cluster simulator: nodes, pods, a filter+score scheduler and rolling updates.
let podSeq = 0;
export class Cluster {
  constructor({ nodes = 4, cpu = 4000, mem = 8192 } = {}) {
    this.nodes = Array.from({ length: nodes }, (_, i) => ({ name: `node-${i + 1}`, cpu, mem, ready: true }));
    this.pods = []; this.events = [];
  }
  emit(type, msg, data = {}) { const e = { t: Date.now(), type, msg, ...data }; this.events.push(e); if (this.events.length > 500) this.events.shift(); this.onEvent?.(e); return e; }
  used(node) { const ps = this.pods.filter((p) => p.node === node.name && p.phase !== "Terminated"); return { cpu: ps.reduce((s, p) => s + p.cpu, 0), mem: ps.reduce((s, p) => s + p.mem, 0), pods: ps.length }; }
  /** kube-scheduler style: filter nodes that fit, score by least-allocated + spread of the same app. */
  schedule(pod) {
    const fits = this.nodes.filter((n) => { if (!n.ready) return false; const u = this.used(n); return u.cpu + pod.cpu <= n.cpu && u.mem + pod.mem <= n.mem; });
    if (!fits.length) return null;
    const score = (n) => { const u = this.used(n); const free = ((n.cpu - u.cpu - pod.cpu) / n.cpu + (n.mem - u.mem - pod.mem) / n.mem) / 2; const same = this.pods.filter((p) => p.node === n.name && p.app === pod.app && p.phase !== "Terminated").length; return free * 100 - same * 25; };
    return fits.sort((a, b) => score(b) - score(a))[0];
  }
  createPod(app, version, { cpu = 250, mem = 256, faulty = false } = {}) {
    const pod = { id: `${app}-${version.replace(/\./g, "")}-${(++podSeq).toString(36).padStart(4, "0")}`, app, version, cpu, mem, faulty, phase: "Pending", node: null, age: 0, restarts: 0 };
    const n = this.schedule(pod);
    if (!n) { this.pods.push(pod); this.emit("warn", `FailedScheduling ${pod.id}: insufficient cpu/memory`, { app }); return pod; }
    pod.node = n.name; pod.phase = "ContainerCreating"; this.pods.push(pod); return pod;
  }
  /** Advance time: pods become Running/Ready, pending pods retry scheduling. */
  tick(dt) {
    for (const p of this.pods) {
      p.age += dt;
      if (p.phase === "Pending") { const n = this.schedule(p); if (n) { p.node = n.name; p.phase = "ContainerCreating"; p.age = 0; } }
      else if (p.phase === "ContainerCreating" && p.age > 0.8) p.phase = "Running";
      else if (p.phase === "Terminating" && p.age > 0.6) p.phase = "Terminated";
    }
    this.pods = this.pods.filter((p) => p.phase !== "Terminated");
  }
  running(app, version) { return this.pods.filter((p) => p.app === app && (!version || p.version === version) && p.phase === "Running"); }
  live(app) { return this.pods.filter((p) => p.app === app && p.phase !== "Terminating"); }
  terminate(pod) { if (pod.phase !== "Terminating") { pod.phase = "Terminating"; pod.age = 0; } }
  killNode(name) {
    const n = this.nodes.find((x) => x.name === name); if (!n) return;
    n.ready = false; this.emit("bad", `${name} NotReady — evicting pods`);
    for (const p of this.pods.filter((q) => q.node === name)) { p.node = null; p.phase = "Pending"; p.age = 0; p.restarts++; }
  }
  healNode(name) { const n = this.nodes.find((x) => x.name === name); if (n && !n.ready) { n.ready = true; this.emit("ok", `${name} Ready`); } }
  utilization() { const tot = this.nodes.filter((n) => n.ready).reduce((s, n) => s + n.cpu, 0) || 1; return this.nodes.filter((n) => n.ready).reduce((s, n) => s + this.used(n).cpu, 0) / tot; }
}

/** Rolling update controller (maxSurge / maxUnavailable), reconciled every tick. */
export class Deployment {
  constructor(cluster, { app, replicas = 3, cpu = 250, mem = 256, maxSurge = 1, maxUnavailable = 0 }) {
    Object.assign(this, { cluster, app, replicas, cpu, mem, maxSurge, maxUnavailable }); this.version = null; this.faulty = false; this.rolling = false;
  }
  rollout(version, { faulty = false } = {}) { this.version = version; this.faulty = faulty; this.rolling = true; this.cluster.emit("info", `Rolling out ${this.app}@${version}`, { app: this.app }); }
  scale(n) { this.replicas = Math.max(0, n); this.cluster.emit("info", `Scaled ${this.app} to ${this.replicas}`, { app: this.app }); }
  reconcile() {
    if (!this.version) return;
    const c = this.cluster, live = c.live(this.app), cur = live.filter((p) => p.version === this.version), old = live.filter((p) => p.version !== this.version);
    const ready = c.running(this.app).length, readyNew = cur.filter((p) => p.phase === "Running").length;
    // surge new pods
    const maxTotal = this.replicas + this.maxSurge;
    for (let i = cur.length; i < this.replicas && live.length + (i - cur.length) < maxTotal; i++) c.createPod(this.app, this.version, { cpu: this.cpu, mem: this.mem, faulty: this.faulty });
    // retire old pods while keeping availability
    const minAvail = this.replicas - this.maxUnavailable; let canKill = ready - minAvail;
    for (const p of old) { const wasRunning = p.phase === "Running"; if (wasRunning && canKill <= 0) continue; c.terminate(p); if (wasRunning) canKill--; }
    // scale down extras of current version
    const extra = cur.length - this.replicas; for (const p of cur.slice(0, Math.max(0, extra))) c.terminate(p);
    if (this.rolling && !old.length && readyNew >= this.replicas) { this.rolling = false; c.emit("ok", `${this.app}@${this.version} rolled out (${readyNew}/${this.replicas} ready)`, { app: this.app }); }
  }
}
