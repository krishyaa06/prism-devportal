import { Platform, TEMPLATES, manifests, burnAlert } from "../src/index.js";
import { $, h, esc, fmt, toast, Loop, bindLoop, LogView, Kpis, Chart, fit, css, hexA, sleep } from "./pro.js";

const P = new Platform({ nodes: 5, seed: 11 });
const log = new LogView($("#log")), steps = new LogView($("#steps"), 40);
const tone = { ok: "ok", bad: "bad", warn: "warn", acc: "acc", info: "dim" };
P.on((e) => log.push(e.msg, tone[e.type] || ""));
const COLORS = ["#7c5cff", "#00d2ff", "#22e3a1", "#ffb547", "#ff5c8a", "#4f8bff", "#c06bff", "#5ce1e6"];
const color = (app) => COLORS[[...P.deploys.keys()].indexOf(app) % COLORS.length];

for (const [k, t] of Object.entries(TEMPLATES)) $("#tpl").append(h("option", { value: k }, t.label));
const seed = [["identity", "node-api", "platform", [], { oncall: true, runbook: true, coverage: 88 }], ["payments-api", "node-api", "payments", ["identity"], { oncall: true, runbook: true }], ["ledger-worker", "go-worker", "payments", ["payments-api"], { oncall: true, coverage: 64 }], ["storefront", "react-web", "growth", ["payments-api", "identity"], { runbook: true }], ["recs-ml", "python-ml", "data", ["identity"], { coverage: 41 }]];
for (const [name, template, team, deps, extra] of seed) P.provision({ name, template, team, deps, ...extra });
const refreshSel = () => { const s = $("#svc"), v = s.value; s.innerHTML = ""; for (const n of P.deploys.keys()) s.append(h("option", { value: n }, n)); s.value = v || "payments-api"; };
refreshSel();
const sel = () => $("#svc").value;

const kp = new Kpis($("#kpis"), [
  { key: "svc", label: "Services", tone: "acc" }, { key: "pods", label: "Pods ready" }, { key: "util", label: "CPU allocated", fmt: fmt.pct },
  { key: "dep", label: "Deploys" }, { key: "rb", label: "Auto rollbacks", tone: "warn" }, { key: "err", label: "Fleet error rate", fmt: (v) => (v * 100).toFixed(2) + "%" },
]);
const ch1 = new Chart($("#ch1"), { series: [{ label: "error %", color: "--bad" }, { label: "SLO budget", color: "#ffffff44" }], min: 0, fmtY: (v) => v.toFixed(1) + "%" });
const ch2 = new Chart($("#ch2"), { series: [{ label: "p95 ms", color: "--accent" }, { label: "rps", color: "--accent2" }], min: 0 });

function drawCluster() {
  const { ctx, w, h: H } = fit($("#cv")); ctx.clearRect(0, 0, w, H);
  const ns = P.cluster.nodes, cols = Math.min(ns.length, w < 600 ? 2 : 5), rows = Math.ceil(ns.length / cols);
  const pad = 14, top = 34, nw = (w - pad * (cols + 1)) / cols, nh = (H - top - pad * (rows + 1)) / rows;
  ns.forEach((n, i) => {
    const x = pad + (i % cols) * (nw + pad), y = top + pad + Math.floor(i / cols) * (nh + pad), u = P.cluster.used(n);
    ctx.fillStyle = n.ready ? "#0d1430" : "#2a0f18"; ctx.strokeStyle = n.ready ? "#2a3560" : "#ff5c8a"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, nw, nh, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = n.ready ? "#c9d1f0" : "#ff8fab"; ctx.font = "600 11px JetBrains Mono, monospace"; ctx.textAlign = "left"; ctx.fillText(n.name + (n.ready ? "" : " · NotReady"), x + 10, y + 18);
    const cu = u.cpu / n.cpu; ctx.fillStyle = "#ffffff12"; ctx.fillRect(x + 10, y + 26, nw - 20, 4); ctx.fillStyle = cu > 0.85 ? "#ff5c8a" : css("--accent"); ctx.fillRect(x + 10, y + 26, (nw - 20) * cu, 4);
    ctx.fillStyle = "#5f6884"; ctx.font = "10px JetBrains Mono, monospace"; ctx.fillText(`cpu ${(cu * 100).toFixed(0)}% · ${u.pods} pods`, x + 10, y + 44);
    const pods = P.cluster.pods.filter((p) => p.node === n.name), s = 22, per = Math.max(1, Math.floor((nw - 20) / (s + 6)));
    pods.forEach((p, j) => {
      const px = x + 10 + (j % per) * (s + 6) + s / 2, py = y + 62 + Math.floor(j / per) * (s + 6) + s / 2, c = color(p.app);
      const a = p.phase === "Running" ? 1 : p.phase === "Terminating" ? 0.25 : 0.25 + 0.5 * Math.abs(Math.sin(P.time * 4));
      ctx.globalAlpha = a; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(px, py, s / 2 - 2, 0, 7); ctx.fill();
      if (p.faulty) { ctx.strokeStyle = "#ff5c8a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, s / 2, 0, 7); ctx.stroke(); }
      else if (p.version !== "1.0.0") { ctx.strokeStyle = "#ffffffaa"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(px, py, s / 2, 0, 7); ctx.stroke(); }
      ctx.globalAlpha = 1;
    });
  });
  const pend = P.cluster.pods.filter((p) => p.phase === "Pending").length;
  let lx = 14; ctx.font = "10px JetBrains Mono, monospace";
  for (const n of P.deploys.keys()) { ctx.fillStyle = color(n); ctx.beginPath(); ctx.arc(lx + 4, H - 10, 4, 0, 7); ctx.fill(); ctx.fillStyle = "#8d94ad"; ctx.fillText(n, lx + 12, H - 7); lx += ctx.measureText(n).width + 30; if (lx > w - 90) break; }
  if (pend) { ctx.fillStyle = "#ffb547"; ctx.textAlign = "right"; ctx.fillText(`${pend} pending`, w - 14, 20); }
}

let acc = 0, lastHist = "";
function render() {
  const snap = P.snapshot(), pods = P.cluster.pods.filter((p) => p.phase === "Running").length;
  const tot = snap.reduce((a, s) => a + s.rps, 0), err = tot ? snap.reduce((a, s) => a + s.rps * s.errRatio, 0) / tot : 0;
  kp.set({ svc: snap.length, pods, util: P.cluster.utilization(), dep: P.stats.deploys, rb: P.stats.rollbacks, err });
  kp.tone("err", err > 0.01 ? "bad" : "ok");
  $("#cat tbody").innerHTML = snap.map((s) => `<tr><td><b>${esc(s.name)}</b><br><small class="dim">${s.template}</small></td><td>${s.team}</td><td><span class="pill ${s.rolling ? "warn" : "dim"}">v${s.version}${s.rolling ? " ⟳" : ""}</span></td><td class="r">${s.ready}/${s.replicas}</td><td class="r">${s.rps.toFixed(0)}</td><td class="r">${s.p95.toFixed(0)}ms</td><td class="r ${s.errRatio > 0.01 ? "bad" : ""}">${(s.errRatio * 100).toFixed(2)}%</td><td><span class="pill ${s.score.level === "Gold" ? "ok" : s.score.level === "Silver" ? "info" : s.score.level === "Bronze" ? "warn" : "bad"}">${s.score.level} ${s.score.score}</span></td></tr>`).join("");
  const m = P.metrics.get(sel()) || [], svc = P.catalog.get(sel());
  ch1.set([m.map((x) => x.errRatio * 100), m.map(() => (100 - svc.slo) * 14.4)]); ch2.set([m.map((x) => x.p95), m.map((x) => x.rps)]);
  const a = burnAlert(m, svc.slo, { fast: 3, slow: 8 }); const b = $("#burn"); b.textContent = `burn ${a.fast.toFixed(1)}×`; b.className = "pill " + (a.firing ? "bad" : a.fast > 2 ? "warn" : "ok");
  const hs = P.history.get(sel()).slice(-8).reverse().map((r) => `<div><span class="t">t+${r.at.toFixed(0)}s </span><span class="${r.status === "rolled-back" ? "bad" : r.status === "live" ? "ok" : "warn"}">v${r.version}</span> <span class="dim">${r.status}${r.faulty ? " · faulty build" : ""}${r.rollbackOf ? " · rollback of v" + r.rollbackOf : ""}</span></div>`).join("");
  if (hs !== lastHist) { $("#hist").innerHTML = hs; lastHist = hs; }
  drawCluster();
}
function showYaml(name) { const s = P.catalog.get(name); $("#yaml").textContent = manifests({ name, template: s.template, team: s.team, version: P.deploys.get(name).version }); }
$("#ord").textContent = "deploy order: " + P.catalog.order().join(" → ");
$("#svc").addEventListener("change", () => { showYaml(sel()); lastHist = ""; render(); });

const loop = new Loop((dt) => { acc += dt; while (acc >= 0.5) { acc -= 0.5; P.tick(0.5); } render(); });
bindLoop(loop, $("#sim"));
$("#deploy").onclick = () => { const v = P.release(sel()); toast(`Deploying ${sel()}@${v}`); if (!loop.running) loop.start(); };
$("#bad").onclick = () => { const v = P.release(sel(), null, { faulty: true }); toast(`Shipping faulty ${sel()}@${v} — watch the SLO burn`); if (!loop.running) loop.start(); };
$("#rollback").onclick = () => P.rollback(sel());
$("#scale").onclick = () => { const d = P.deploys.get(sel()); d.scale(d.replicas + 1); };
$("#kill").onclick = () => { const up = P.cluster.nodes.filter((n) => n.ready); if (up.length <= 2) return toast("Keeping at least 2 nodes alive"); const n = up[Math.floor(Math.random() * up.length)]; P.cluster.killNode(n.name); setTimeout(() => P.cluster.healNode(n.name), 9000); };
$("#create").onclick = async () => {
  const name = $("#nm").value.trim();
  try {
    const r = P.provision({ name, template: $("#tpl").value, team: $("#team").value, deps: ["identity"] });
    steps.clear(); for (const s of r.steps) { steps.push("✓ " + s, "ok"); await sleep(140); }
    refreshSel(); $("#svc").value = name; showYaml(name); $("#ord").textContent = "deploy order: " + P.catalog.order().join(" → ");
    $("#nm").value = name.replace(/-?\d*$/, "") + "-" + (P.stats.provisioned + 1); if (!loop.running) loop.start();
  } catch (e) { steps.push("✗ " + e.message, "bad"); }
};
showYaml(sel());
for (let i = 0; i < 24; i++) P.tick(0.5);
render(); loop.start();
setTimeout(() => P.release("payments-api", null, { faulty: true }), 2500);
addEventListener("resize", render);
