# Changelog

All notable changes to this project are documented here.

## 0.1.0 — 2026-08-31

- Share cwd-level `AGENTS.md` instructions and `.dsh-memory.md` context across sessions.
- Refresh both files before every accepted model step and suppress unchanged snapshots.
- Classify durable user feedback as an instruction, memory, or transient request.
- Require user confirmation before writing an inferred update.
- Reject stale concurrent writes, symbolic-link targets, invalid UTF-8, and oversized content.
