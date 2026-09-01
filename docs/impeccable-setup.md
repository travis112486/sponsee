# Impeccable (design skill for agents) — SPO-259

[Impeccable](https://github.com/pbakaus/impeccable) is a design skill for AI coding agents: one skill with
23 sub-commands (`shape`, `critique`, `audit`, `polish`, `harden`, `animate`, …) plus 61 deterministic
detector rules that catch AI-generated UI tells (Inter everywhere, purple→blue gradients, cards nested in
cards, gray text on colored backgrounds, bounce easing).

Installed version: **4.1.2** (skill), CLI `impeccable@3.6.x` via `npx`.

## Where it lives

| Scope | Path | Who gets it |
|---|---|---|
| Repo (committed) | `.claude/skills/impeccable`, `.claude/agents/impeccable-*.md`, `.claude/settings.json` | Any agent or human running Claude Code with this repo as the project dir; includes the design hooks |
| Machine (not committed) | `~/.claude/skills/impeccable` | Every Paperclip agent session on the host, regardless of cwd — installed with `--no-hooks` so it never double-fires with the repo hooks |

The repo copy is vendored on purpose: agents get worktrees created fresh off `origin/main`, and the skill has
to exist on disk before the session starts to be loadable. It is not installed via `pnpm install`.

## Usage

Inside an agent session (not a terminal):

```
/impeccable critique apps/web/src/routes/deals
/impeccable audit apps/marketing            # a11y, perf, responsive
/impeccable polish apps/web/src/components/Navbar.tsx
/impeccable harden checkout
```

Deterministic detector from the shell (no LLM, no API key):

```bash
npx impeccable detect apps/web/src         # file, dir, or URL
npx impeccable ignores                     # manage rule/file/value ignores
```

`/impeccable init` writes a root `PRODUCT.md` (durable product truth) and `/impeccable document` writes
`DESIGN.md` from existing code. Neither has been run yet — first agent doing substantial UI work on Sponsee
should run `init`, since every other command reads it.

## Hooks

`.claude/settings.json` registers two hooks that run `.claude/skills/impeccable/scripts/hook.mjs`:

- `PostToolUse` on `Edit|Write` (5s timeout) — immediate-tier detector checks on UI files.
- `Stop` (30s timeout) — full-rule deep pass at the end of a turn.

Measured on this repo: ~0.2s and silent on non-UI files (e.g. `api/src/*.ts`), ~0.2s with an
`additionalContext` note on `.tsx` files. To disable, delete the `hooks` block from `.claude/settings.json`.

`.claude/settings.local.json` is git-ignored — the Paperclip runtime rewrites it per worktree, so shared
config belongs in `.claude/settings.json`.

## Updating

```bash
npx impeccable update            # repo copy, from repo root
cd ~ && npx impeccable update    # machine copy
```

## Why not a Paperclip-managed skill

`POST /api/companies/{id}/skills/import` rejects it: `scripts_executables_blocked` — Paperclip's skill
library only accepts markdown-only skills, and Impeccable ships ~3MB of detector/live-mode scripts. The two
install paths above are the supported alternative; Paperclip lists it as a user-installed skill in the
agent's skill inventory.

## Possible follow-ups (not done)

- Wire `npx impeccable detect` into CI as a non-blocking report on changed frontend files.
- Run `/impeccable init` + `/impeccable document` to commit `PRODUCT.md` and `DESIGN.md`.
