#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Platform, Catalog, scorecard, manifests, catalogInfo, TEMPLATES } from "../src/index.js";
import { c, table, header, fail } from "../src/lib/cli.js";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n, d) => { const i = rest.indexOf("--" + n); return i >= 0 ? rest[i + 1] : d; };
const HELP = `${c.bold("idp")} — Prism DevPortal CLI

  idp templates                         list golden-path templates
  idp new <name> [--template node-api] [--team t] [--env dev]
                                        render k8s manifests + catalog-info.yaml
  idp catalog <catalog.json>            scorecards, deploy order, blast radius
  idp simulate [--seconds 40]           good deploy → bad deploy → SLO auto-rollback
`;
try {
  if (!cmd || cmd === "--help" || cmd === "-h") console.log(HELP);
  else if (cmd === "templates") { console.log(header("Golden-path templates") + "\n"); console.log(table(Object.entries(TEMPLATES).map(([k, t]) => [c.accent(k), t.label, t.lang, `${t.cpu}m / ${t.mem}Mi`, t.replicas]), { head: ["id", "template", "lang", "requests", "replicas"] })); }
  else if (cmd === "new") {
    const name = rest.find((x) => !x.startsWith("--") && rest[rest.indexOf(x) - 1]?.startsWith("--") !== true); if (!name) fail("usage: idp new <name>");
    const o = { name, template: flag("template", "node-api"), team: flag("team", "platform"), env: flag("env", "dev") };
    console.log(manifests(o)); console.log("---\n# catalog-info.yaml\n" + catalogInfo(o));
  } else if (cmd === "catalog") {
    const file = rest[0]; if (!file) fail("usage: idp catalog <catalog.json>");
    const cat = new Catalog(); for (const s of JSON.parse(readFileSync(file, "utf8"))) cat.add(s);
    console.log(header("Service scorecards") + "\n");
    console.log(table(cat.list().map((s) => { const sc = scorecard(s); const col = sc.level === "Gold" ? c.green : sc.level === "Silver" ? c.cyan : sc.level === "Bronze" ? c.yellow : c.red; return [c.bold(s.name), s.team || c.red("—"), col(sc.level), sc.score, sc.results.filter((r) => !r.pass).map((r) => r.id).join(", ") || c.green("all checks")]; }), { head: ["service", "team", "level", "score", "failing"] }));
    console.log("\n" + c.dim("deploy order: ") + cat.order().join(c.dim(" → ")));
    const core = cat.list()[0].name; console.log(c.dim(`blast radius of ${core}: `) + (cat.blastRadius(core).join(", ") || "none"));
  } else if (cmd === "simulate") {
    const secs = +flag("seconds", 40), P = new Platform({ nodes: 4, seed: 3 });
    P.on((e) => console.log(c.dim(`t+${String(P.time.toFixed(1)).padStart(5)}s `) + ({ ok: c.green, bad: c.red, warn: c.yellow, acc: c.accent }[e.type] || ((x) => x))(e.msg)));
    P.provision({ name: "payments-api", template: "node-api", team: "payments", oncall: true, runbook: true });
    for (let t = 0; t < secs; t += 0.5) { P.tick(0.5); if (t === 6) P.release("payments-api"); if (t === 16) P.release("payments-api", null, { faulty: true }); }
    const s = P.snapshot()[0]; console.log("\n" + header("Result") + "\n");
    console.log(table([["live version", "v" + s.version], ["ready", `${s.ready}/${s.replicas}`], ["deploys", P.stats.deploys], ["auto rollbacks", P.stats.rollbacks], ["error ratio", (s.errRatio * 100).toFixed(2) + "%"]]));
  } else fail(`unknown command "${cmd}"\n\n${HELP}`);
} catch (e) { fail(e.message); }
