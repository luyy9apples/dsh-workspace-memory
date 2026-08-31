# Security

## Data and network behavior

The plugin performs no network requests and has no telemetry. For each session cwd it accesses only the two same-directory filenames configured by `memoryFile` and `instructionFile`. Their defaults are `.dsh-memory.md` and `AGENTS.md`.

The final path component must not be a symbolic link. Files must be regular UTF-8 files. `maxBytes` bounds each complete read, replacement, and proposal rationale. Writes use the filesystem provider's create-if-absent or replace-if-version operation, so a concurrent change rejects a stale update instead of being overwritten.

## Model and user authority

`AGENTS.md` is workspace-authored instruction content. `.dsh-memory.md` is labeled as project context without instruction authority. Repository text is escaped so it cannot close the plugin-owned reminder wrapper.

Classification of feedback is model-based and can miss or misclassify a candidate. An inferred candidate is never written directly: the `propose` operation displays a bounded contextual diff and concise reason, while retaining the complete replacement internally, and writes only when the user selects **Apply**. This confirmation protects mutation, but cannot guarantee that a model will obey every recorded instruction.

Every mutation passes the calling session to DSH's sandbox-policy service, so `workspace-write` is resolved against that session's cwd rather than the server startup directory. A `read-only` session remains unable to write. If a proposal is declined, denied, or fails, the curation prompt explicitly forbids falling back to generic write, edit, or shell tools for the inferred update.

## Reporting a vulnerability

Do not include secrets, private workspace content, or session logs in a public issue. Until a dedicated private reporting address is published, open a minimal GitHub issue asking the maintainer to establish a private contact channel.
