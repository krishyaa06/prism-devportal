# Contributing to prism-devportal

Thanks for taking the time to contribute! prism-devportal is a command-line tool by [Prism Protocol](https://github.com/krishyaa06) — Prism DevPortal is an Internal Developer Platform engine: service catalog with scorecards, golden-path templates that render real Kubernetes manifests, a kube-scheduler-style cluster simulator, rolling updates and SLO burn-rate auto-rollback.

## Getting started

```bash
git clone https://github.com/krishyaa06/prism-devportal.git
cd prism-devportal
npm start
```

## Before you open a pull request

Make sure everything passes locally:

```bash
npm test
```

## Guidelines

- **Zero dependencies.** Please don't add runtime dependencies — use Node.js built-ins (`node:fs`, `node:path`, `node:test`, …).
- **No build step, no frameworks.** Keep it plain HTML, CSS and JavaScript so it runs straight from GitHub Pages.
- **Everything stays in the browser.** Don't send user data to any server.
- Keep pull requests small and focused — one feature or fix per PR.
- Update the README when you change behaviour, flags or options.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add --json output
fix: handle empty input
docs: clarify install steps
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`. Add a short entry under **[Unreleased]** in [CHANGELOG.md](CHANGELOG.md) for user-facing changes.

## Reporting bugs & ideas

Open an [issue](https://github.com/krishyaa06/prism-devportal/issues) with:

- what you expected vs. what happened
- steps to reproduce
- your OS, browser or Node.js version

**Security issues:** please don't open a public issue — contact the maintainer privately via [GitHub](https://github.com/krishyaa06).

## License

By contributing, you agree that your contributions will be licensed under the project's [license](LICENSE).
