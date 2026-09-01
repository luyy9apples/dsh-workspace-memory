# Changelog

All notable changes to this project are documented here.

## 0.1.0 — 2026-09-01

- Share cwd-level `AGENTS.md` instructions and `.dsh-memory.md` context across sessions.
- Refresh both files before every accepted model step and suppress unchanged snapshots.
- Classify durable user feedback as an instruction, memory, or transient request.
- Review the complete target Markdown and integrate inferred updates precisely instead of appending raw feedback.
- Show a bounded contextual diff and concise reason before writing an inferred update, then require user confirmation.
- Add a dedicated DSH Web review card with line numbers, colored additions and removals, collapsed unchanged sections, and fixed decision actions.
- Ship the browser companion in the same npm Bundle without requiring a DSH Web rebuild.
- Preserve the compact Markdown diff as a fallback for clients that do not load the browser companion.
- Resolve filesystem sandbox policy from the calling session so workspaces outside the DSH startup directory remain writable under `workspace-write`.
- Forbid fallback to generic write, edit, or shell tools when a curated proposal is declined or fails.
- Reject stale concurrent writes, symbolic-link targets, invalid UTF-8, and oversized content.
