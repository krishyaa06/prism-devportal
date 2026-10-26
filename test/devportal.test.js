import { test } from "node:test";
import assert from "node:assert/strict";
import { Platform, Cluster, Catalog, scorecard, manifests, validateName, burnRate, errorBudget } from "../src/index.js";

test("scheduler spreads replicas and respects capacity", () => {
  const c = new Cluster({ nodes: 3, cpu: 1000 });
  for (let i = 0; i < 3; i++) c.createPod("a", "1.0.0", { cpu: 300 });
  assert.equal(new Set(c.pods.map((p) => p.node)).size, 3);
  for (let i = 0; i < 6; i++) c.createPod("b", "1.0.0", { cpu: 300 });
  assert.equal(c.pods.filter((p) => p.phase === "Pending").length, 0);
  c.createPod("c", "1.0.0", { cpu: 300 });
  assert.equal(c.pods.at(-1).phase, "Pending");
});
test("node failure evicts and reschedules pods", () => {
  const P = new Platform({ nodes: 3 }); P.provision({ name: "api" });
  for (let i = 0; i < 10; i++) P.tick(0.5);
  P.cluster.killNode("node-1"); for (let i = 0; i < 10; i++) P.tick(0.5);
  assert.equal(P.cluster.running("api").length, 3);
  assert.ok(P.cluster.pods.every((p) => p.node !== "node-1"));
});
test("rolling update replaces all pods without dropping availability", () => {
  const P = new Platform({ nodes: 4 }); P.provision({ name: "api" });
  for (let i = 0; i < 10; i++) P.tick(0.5);
  P.release("api", "1.1.0"); let minReady = 99;
  for (let i = 0; i < 30; i++) { P.tick(0.5); minReady = Math.min(minReady, P.cluster.running("api").length); }
  assert.ok(P.cluster.running("api").every((p) => p.version === "1.1.0"));
  assert.ok(minReady >= 3, "maxUnavailable=0 keeps 3 ready");
});
test("faulty release is auto rolled back by SLO burn alert", () => {
  const P = new Platform({ nodes: 4 }); P.provision({ name: "api" });
  for (let i = 0; i < 12; i++) P.tick(0.5);
  P.release("api", "1.1.0", { faulty: true });
  for (let i = 0; i < 60; i++) P.tick(0.5);
  assert.equal(P.stats.rollbacks, 1); assert.equal(P.deploys.get("api").version, "1.0.0");
  assert.ok(P.cluster.running("api").every((p) => !p.faulty));
});
test("catalog: topo order, cycles, blast radius, scorecards", () => {
  const c = new Catalog(); c.add({ name: "web", deps: ["api"] }); c.add({ name: "api", deps: ["db"] }); c.add({ name: "db" });
  assert.deepEqual(c.order(), ["db", "api", "web"]); assert.deepEqual(c.blastRadius("db"), ["api", "web"]);
  c.get("db").deps = ["web"]; assert.throws(() => c.order(), /cycle/);
  assert.equal(scorecard({ team: "x", docs: 1, oncall: 1, slo: 99.9, coverage: 90, runbook: 1 }).level, "Gold");
  assert.equal(scorecard({}).level, "Needs work");
});
test("manifests + name validation + SLO math", () => {
  const y = manifests({ name: "orders", template: "go-worker", version: "2.0.0" });
  for (const k of ["kind: Deployment", "kind: Service", "kind: HorizontalPodAutoscaler", "kind: PodDisruptionBudget", "ghcr.io/prism/orders:2.0.0", "cpu: 400m"]) assert.ok(y.includes(k), k);
  assert.throws(() => validateName("Bad_Name"), /DNS-1123/);
  assert.ok(Math.abs(burnRate(0.01, 99.9) - 10) < 1e-9);
  assert.ok(Math.abs(errorBudget(99.9).minutes - 43.2) < 1e-6);
});
