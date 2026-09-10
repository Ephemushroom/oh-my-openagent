# Upstream sync: Senpi live QA

The evidence directory was resolved with `.agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs --slug 20260910-upstream-sync` against the task-owned worktree.

Surface: real Senpi CLI from the merged workspace's pinned dependency, loading the rebuilt local plugin through `packages/omo-senpi/scripts/qa/drive.mjs`. The driver supplies a local mock provider and owns isolated HOME/XDG and agent directories. It captures protected real-home state and removes its sandbox in `finally`.

Status: Linux live QA and isolation PASS. `drive-linux.json` records result=PASS, ultraworkInjected=true, commentChecker=PASS, isolationCertified=true, realHomeIsolationCertified=true, realSenpiUntouched=true and realOmoUntouched=true.

`drive.json` preserves the initial macOS functional PASS whose isolation certification was unavailable because the directory-identity implementation explicitly requires Linux; it is not represented as certified.

The Linux run used an ephemeral `node:24-bookworm-slim` container named `omo-sync-linux-qa` with `--rm`. Only this evidence directory was bind-mounted. A source snapshot (excluding node_modules, .git, .omo/evidence and .codegraph) was copied into the container; the rebuilt JS plugin artifacts were included. Linux Senpi 2026.9.10 and comment-checker 0.8.0 were installed under `/runtime`, then the existing driver was run against a local mock provider. The host's real agent directories and Docker socket were not mounted. Container execution exited 0, and the container was removed automatically.

The same container ran the unmodified Codex `install-bin-links.test.mjs`: 21 pass, 0 fail, 0 skipped (`codex-bin-links-linux.log`). This proves its genuine no-Bun branches without the host Homebrew Bun interfering. See the parent sync README for the aggregate macOS Codex gate caveat. No real credentials or environment dump were copied.
