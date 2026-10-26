# Prism DevPortal — Usage

## Install

```bash
npm install github:krishyaa06/prism-devportal
# or run the CLI directly
npx github:krishyaa06/prism-devportal --help
```

## JavaScript API

```js
import { Platform, manifests } from "prism-devportal";

const p = new Platform({ nodes: 4 });
p.on((e) => console.log(e.type, e.msg));

// golden path: catalog + manifests + v1.0.0
const { steps, manifests: yaml } = p.provision({
  name: "payments-api", template: "node-api", team: "payments", oncall: true,
});

for (let i = 0; i < 10; i++) p.tick(0.5);   // pods become Ready
p.release("payments-api", "1.1.0");           // rolling update
p.release("payments-api", null, { faulty: true }); // bad build…
for (let i = 0; i < 40; i++) p.tick(0.5);   // …SLO burn → auto-rollback

console.log(p.snapshot()[0].version, p.stats.rollbacks); // 1.1.0 1
```

| Export | What it does |
|---|---|
| `new Platform({ nodes, seed, autoRollback })` | Full platform: catalog + cluster + releases + SLO |
| `platform.provision({ name, template, team, deps, ...checks })` | Golden path; returns `{ steps, manifests }` |
| `platform.release(name, version?, { faulty })` | Rolling update (version auto-bumps minor) |
| `platform.rollback(name, reason)` | Roll back to last healthy revision |
| `platform.tick(dt)` | Advance simulated time (seconds) |
| `platform.snapshot()` | Per-service version, readiness, rps, p95, error ratio, scorecard |
| `new Cluster({ nodes, cpu, mem })` / `Deployment` | Scheduler and rolling-update controller on their own |
| `new Catalog()` · `order()` · `blastRadius(name)` | Dependency graph |
| `scorecard(service)` | `{ score, level, results }` |
| `manifests(opts)` / `catalogInfo(opts)` | Kubernetes YAML / Backstage `catalog-info.yaml` |
| `burnRate(errRatio, slo)` · `burnAlert(samples, slo)` · `errorBudget(slo)` | SLO math |

## CLI

```bash
$ npx github:krishyaa06/prism-devportal templates
$ npx github:krishyaa06/prism-devportal new orders --template go-worker --team payments > orders.yaml
$ npx github:krishyaa06/prism-devportal catalog examples/catalog.json
$ npx github:krishyaa06/prism-devportal simulate --seconds 40
```

| Command | Description |
|---|---|
| `idp templates` | List golden-path templates |
| `idp new <name> [--template] [--team] [--env]` | Print Kubernetes manifests + `catalog-info.yaml` |
| `idp catalog <file.json>` | Scorecards, deploy order and blast radius |
| `idp simulate [--seconds 40]` | Scripted good deploy → bad deploy → auto-rollback timeline |

## Live simulator

Open [https://krishyaa06.github.io/prism-devportal/](https://krishyaa06.github.io/prism-devportal/) or serve the repo root locally (`npx serve .`). The simulator imports the same modules from `src/`.
