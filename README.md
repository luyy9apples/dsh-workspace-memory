# dsh-workspace-memory

> An approval-gated assistant for maintaining shared workspace instructions and project memory.

![DSH Bundle](https://img.shields.io/badge/DSH-Bundle-5b5bd6.svg)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%5E22.19%20%7C%7C%20%3E%3D24-339933.svg)](package.json)

English | [简体中文](README.zh-CN.md)

`dsh-workspace-memory` helps users deliberately maintain two kinds of context shared by conversations in the same workspace.

Reusable working agreements can be curated in `AGENTS.md`, while stable project facts and decisions are kept separately in `.dsh-memory.md`. This separation helps keep behavioral instructions focused while preserving factual context that later conversations may need.

When the model identifies a possible long-term instruction or memory, it can propose a precise update to the existing document. The user reviews a focused diff and decides whether the change should be applied.

| File | What belongs there |
|---|---|
| `AGENTS.md` | Reusable rules for how agents should work, write, format, validate, and use tools |
| `.dsh-memory.md` | Stable facts, decisions, terminology, constraints, and unresolved risks that agents should know but not treat as behavioral rules |

Both are ordinary Markdown files in the session's current working directory. They remain readable, reviewable, and versionable without a database, embeddings, or a cloud service.

## See it in one minute

The demo follows the complete workflow: save a reusable working rule to `AGENTS.md`, record a stable project decision in `.dsh-memory.md`, then open another conversation in the same workspace and verify that it receives both. Every inferred update is shown as a focused diff and written only after approval.

![Workspace instructions and memory shared across DSH conversations](https://raw.githubusercontent.com/luyy9apples/dsh-workspace-memory/main/docs/assets/workspace-memory-demo.gif)

Try the same flow after installing:

1. **Workspace instruction:** “Whenever you change files here, finish by summarizing what changed and what you verified. Apply this rule to future conversations too.”
2. **Project memory:** “This project prioritizes backward compatibility over adopting new APIs. Preserve this decision for future conversations.”
3. **New conversation:** “What instructions should you follow here, and what project decisions should you keep in mind?”

Rules the agent should repeatedly follow belong in `AGENTS.md`; stable facts and decisions it should know belong in `.dsh-memory.md`. One-off requests are not stored.

## Install

Requires DeepSeek Harness `0.1.1-rc.2` and Node.js `^22.19.0 || >=24.0.0`.

```sh
dsh plugin --profile web add dsh-workspace-memory
dsh --profile web
```

That is all. This package declares `dsh.bundle`, so DSH adds its configuration layer to the `web` profile automatically. No profile file needs to be edited by hand. Restart an already running profile after installing or updating the package.

```sh
# Update
dsh plugin --profile web update dsh-workspace-memory@latest

# Remove
dsh plugin --profile web remove dsh-workspace-memory
```

## Why use it?

- **Assist with shared instruction maintenance** — reusable feedback can be reviewed and integrated into the existing `AGENTS.md`.
- **Separate instructions from factual context** — behavioral rules stay in `AGENTS.md`, while facts and decisions go to `.dsh-memory.md`.
- **Concurrent conversations stay aligned** — already-open conversations reread the latest workspace context before their next model step.
- **No silent inferred writes** — when the model identifies durable feedback, it shows a focused diff and asks before writing.
- **Stale updates cannot overwrite newer work** — a proposal based on an older file version is rejected if another conversation changed the file first.
- **Purpose-built Web review** — DSH Web shows line numbers, colored additions and removals, and collapsed unchanged sections; other clients retain a Markdown fallback.
- **Sandbox-aware** — writes use the calling session's workspace policy and cwd, not the directory where the DSH server was started.
- **Local and inspectable** — no network requests, telemetry, database, or hidden memory store.

## How it works

```text
durable user feedback
        |
        +-- reusable agent behavior ----------> AGENTS.md
        |
        +-- stable factual project context ----> .dsh-memory.md
        |
        `-- one-off request or progress --------> not stored

candidate -> complete-file merge -> user confirmation -> version-guarded write
```

Before every accepted model step, the plugin injects one current snapshot of the two files. Unchanged visible content is not appended repeatedly; empty and deleted files are represented explicitly so stale content is superseded. Refresh happens before each model step; it is not real-time broadcasting, and conflicting proposals are rejected rather than merged automatically.

The model decides whether durable feedback is a reusable behavior rule, factual project context, or neither. Before proposing, it is instructed to review the complete target document, integrate the smallest coherent edit into the relevant section, remove affected-section duplication, and preserve unrelated content and structure. The `workspace_memory` tool enforces the write boundary: inferred feedback must use `propose`, and a proposal is written only after the user approves it. The observed file version must still match at write time.

This works alongside DSH's standard `agent-instructions` loader. DSH retains responsibility for discovering and applying `AGENTS.md`; `dsh-workspace-memory` assists users in maintaining the cwd-level file and stores factual context separately in `.dsh-memory.md`.

The npm Bundle contains both plugin halves. The Host half keeps the complete proposed replacement and performs the guarded write. The optional Web half receives only a bounded structured diff and renders the review card through DSH's client module system, so installing the Bundle does not require rebuilding the DSH Web application.

This mechanism improves continuity; it does not guarantee that a model will always classify, remember, or follow every instruction correctly.

## Defaults and configuration

The Bundle installs this configuration:

```yaml
memoryFile: .dsh-memory.md
instructionFile: AGENTS.md
suggestUpdates: true
maxBytes: 32768
```

To override it, add a later row to `$DSH_HOME/profiles/web/cordis.patch.yml`. DSH replaces the complete `config` value, so restate every field:

```yaml
- id: workspace-memory
  config:
    memoryFile: .dsh-memory.md
    instructionFile: AGENTS.md
    suggestUpdates: false
    maxBytes: 65536
```

The filenames must be distinct, same-directory names without path separators. `maxBytes` applies separately to each complete file and to the proposal rationale. Existing files must be regular UTF-8 files; symbolic links at the final path component are rejected.

## Safety model

| Boundary | Behavior |
|---|---|
| Storage scope | Only the two configured files in the exact session cwd |
| Model-inferred changes | Require interactive confirmation |
| Concurrent changes | Stale whole-file replacements are rejected |
| Sandbox boundary | The calling session's policy and cwd are enforced; read-only remains read-only |
| Failed or declined proposal | The agent is instructed not to bypass `workspace_memory` with another write tool |
| Symbolic links | Rejected at the final path component |
| Network and telemetry | None |
| Database and embeddings | None |

See [SECURITY.md](SECURITY.md) for the complete authority and write-safety model.

## Compatibility and limitations

| Environment | Status |
|---|---|
| DSH Web `0.1.1-rc.2` | Tested |
| Windows x64 | Tested |
| Ubuntu with Node.js 22 and 24 | CI target |
| macOS | Not yet verified |
| Headless profile | Use `suggestUpdates: false`; an interactive confirmation provider is normally unavailable |

- Workspace identity is the session's exact cwd. Parent directories and sibling or child directories do not automatically share a memory file.
- This plugin synchronizes only the cwd-level `AGENTS.md`. Global, ancestor, and nested instruction discovery remains the responsibility of DSH's standard agent-instructions plugin.
- Classification is model-based and can miss or misclassify feedback. Confirmation prevents silent inferred writes; it does not guarantee perfect classification or instruction compliance.
- Whole-file replacement is intentional. The caller merges complete content, while the plugin rejects stale writes instead of attempting an unsafe automatic merge.

## Troubleshooting

### The Bundle does not appear in the profile

```sh
dsh --profile web --dump-config
```

Look for a `# == dsh-workspace-memory` layer and an entry with `id: workspace-memory`. If both are present, restart the profile.

### No update question appears

Check that `suggestUpdates` is `true` and that the feedback is durable rather than a one-off task. For a deterministic test, explicitly say that the rule or decision should apply to future conversations.

### A confirmed write fails

Another conversation may have changed the file while the confirmation dialog was open. Read the current content, merge the candidate again, and submit a new proposal.

## Development

```sh
pnpm install
pnpm run verify
pnpm pack
```

Install a local checkout into DSH:

```sh
pnpm run build
dsh plugin --profile web add "link:/absolute/path/to/dsh-workspace-memory"
dsh --profile web
```

Release history is maintained in [CHANGELOG.md](CHANGELOG.md). Contributions and reproducible bug reports are welcome.
