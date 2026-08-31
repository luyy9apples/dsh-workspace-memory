/**
 * Workspace-shared instructions and critical memory with confirmed curation.
 *
 * @module dsh-workspace-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { FileSystem, FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-questions'

/** Cordis plugin name and durable message-source owner. */
export const name = 'workspace-memory'

/** Services required by snapshot injection, curation, and the model-facing tool. */
export const inject = ['agents', 'fs', 'sandboxPolicy', 'systemPrompt', 'tools', 'userQuestions']

/** Workspace files, curation behavior, and complete UTF-8 byte budget. */
export interface Config {
  /** Same-directory memory filename resolved against each session cwd. */
  memoryFile?: string
  /** Same-directory shared-instruction filename resolved against each session cwd. */
  instructionFile?: string
  /** Prompt the model to identify reusable user feedback and propose a confirmed update. */
  suggestUpdates?: boolean
  /** Maximum complete size accepted for each file read and replacement. */
  maxBytes: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  memoryFile: z.string().default('.dsh-memory.md'),
  instructionFile: z.string().default('AGENTS.md'),
  suggestUpdates: z.boolean().default(true),
  maxBytes: z.number().required(),
})

type WorkspaceFileKind = 'memory' | 'instruction'

interface WorkspaceFileState {
  readonly target: FsTarget
  readonly info?: FsInfo
  readonly content?: string
}

interface ResolvedConfig {
  readonly memoryFile: string
  readonly instructionFile: string
  readonly suggestUpdates: boolean
  readonly maxBytes: number
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const DIFF_CONTEXT_LINES = 2
const MAX_DIFF_MATRIX_CELLS = 250_000
const MAX_DIFF_PREVIEW_LINES = 80
const MAX_DIFF_PREVIEW_CHARS = 8_000
const MAX_REASON_PREVIEW_CHARS = 240

/** Stable system-prompt policy that lets the model classify reusable feedback. */
export const CURATION_PROMPT = `Workspace knowledge curation:
- Treat a reusable rule about how agents should work, write, format, validate, or use tools as an instruction candidate for AGENTS.md.
- Treat a stable project fact, decision, term, constraint, preference about the project, or unresolved risk as a memory candidate for .dsh-memory.md.
- Treat one-off corrections, current-task requests, conversation history, and transient progress as neither; do not suggest storing them.
- Suggest only high-confidence, durable information that is not already recorded. Do not interrupt the immediate task merely to curate ambiguous feedback.
- Before proposing, read and review the corresponding complete Markdown file as one maintained document. If the candidate is already covered, do not propose an update.
- Integrate the candidate into the most relevant existing section. Preserve correct unrelated content and the file's established language, headings, list style, terminology, and ordering. Create or rename a section only when it materially improves organization.
- Make the smallest semantically complete edit: remove duplication in the affected section, reconcile a superseded statement only when the user's new feedback clearly replaces it, and keep instructions atomic and actionable. Do not append raw conversation text, attribution such as "the user said", timestamps, or proposal rationale to the file.
- Review the resulting complete document for coherence, precision, contradictions, and redundant wording, but do not rewrite unrelated sections merely for style and do not invent project facts.
- Then call workspace_memory with action "propose", the matching kind, the complete replacement Markdown, and a concise one-sentence reason describing the actual change. The tool itself shows a focused diff and asks the user for confirmation. Never write an inferred candidate with "replace", and do not ask for the same confirmation separately.
- workspace_memory is the only tool authorized to apply inferred shared-state updates. If its proposal is declined, denied by policy, or fails for any reason, do not fall back to write, edit, shell, or another tool to modify AGENTS.md or .dsh-memory.md. Leave the file unchanged, continue the immediate task when possible, and report the failure.`

type DiffOperation = {
  readonly kind: 'context' | 'add' | 'remove'
  readonly line: string
}

/** Split text into display lines while retaining a meaningful trailing newline. */
function diffLines(text: string): string[] {
  if (text.length === 0) return []
  return text.replaceAll('\r\n', '\n').split('\n')
}

/** Build a line diff with an LCS for ordinary files and a bounded fallback for large inputs. */
function lineDiff(previous: string, proposed: string): DiffOperation[] {
  const before = diffLines(previous)
  const after = diffLines(proposed)
  if (before.length * after.length > MAX_DIFF_MATRIX_CELLS) {
    let prefix = 0
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
    let suffix = 0
    while (
      suffix < before.length - prefix
      && suffix < after.length - prefix
      && before[before.length - suffix - 1] === after[after.length - suffix - 1]
    ) suffix += 1
    return [
      ...before.slice(0, prefix).map(line => ({ kind: 'context' as const, line })),
      ...before.slice(prefix, before.length - suffix).map(line => ({ kind: 'remove' as const, line })),
      ...after.slice(prefix, after.length - suffix).map(line => ({ kind: 'add' as const, line })),
      ...before.slice(before.length - suffix).map(line => ({ kind: 'context' as const, line })),
    ]
  }

  const lengths = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1))
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i]![j] = before[i] === after[j]
        ? lengths[i + 1]![j + 1]! + 1
        : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!)
    }
  }
  const operations: DiffOperation[] = []
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      operations.push({ kind: 'context', line: before[i]! })
      i += 1
      j += 1
    } else if (j < after.length && (i === before.length || lengths[i]![j + 1]! >= lengths[i + 1]![j]!)) {
      operations.push({ kind: 'add', line: after[j]! })
      j += 1
    } else {
      operations.push({ kind: 'remove', line: before[i]! })
      i += 1
    }
  }
  return operations
}

/** Render only changed lines plus compact surrounding context for the confirmation UI. */
export function renderProposalDiff(previous: string, proposed: string): string {
  if (previous === proposed) return '(no textual change)'
  const operations = lineDiff(previous, proposed)
  const keep = new Uint8Array(operations.length)
  for (let index = 0; index < operations.length; index += 1) {
    if (operations[index]?.kind === 'context') continue
    const start = Math.max(0, index - DIFF_CONTEXT_LINES)
    const end = Math.min(operations.length, index + DIFF_CONTEXT_LINES + 1)
    keep.fill(1, start, end)
  }
  const rendered: string[] = []
  let index = 0
  while (index < operations.length) {
    if (keep[index] === 0) {
      const start = index
      while (index < operations.length && keep[index] === 0) index += 1
      rendered.push(`  … ${index - start} unchanged line${index - start === 1 ? '' : 's'} …`)
      continue
    }
    const operation = operations[index]!
    rendered.push(`${operation.kind === 'add' ? '+' : operation.kind === 'remove' ? '-' : ' '}${operation.line}`)
    index += 1
  }

  let preview = rendered
  let truncated = false
  if (preview.length > MAX_DIFF_PREVIEW_LINES) {
    preview = preview.slice(0, MAX_DIFF_PREVIEW_LINES)
    truncated = true
  }
  let text = preview.join('\n')
  if (text.length > MAX_DIFF_PREVIEW_CHARS) {
    text = `${text.slice(0, MAX_DIFF_PREVIEW_CHARS)}\n… preview truncated …`
    truncated = false
  }
  if (truncated) text += '\n… preview truncated …'
  return text
}

/** Keep the confirmation detail focused even when model-authored rationale is verbose. */
export function renderProposalDetail(reason: string, previous: string, proposed: string): string {
  const normalizedReason = reason.trim().replace(/\s+/g, ' ')
  const reasonPreview = normalizedReason.length > MAX_REASON_PREVIEW_CHARS
    ? `${normalizedReason.slice(0, MAX_REASON_PREVIEW_CHARS)}…`
    : normalizedReason
  const diff = renderProposalDiff(previous, proposed)
  const longestFence = Math.max(3, ...[...diff.matchAll(/`+/g)].map(match => match[0].length + 1))
  const fence = '`'.repeat(longestFence)
  return `**Why this change**\n\n${reasonPreview}\n\n**Proposed changes**\n\n${fence}diff\n${diff}\n${fence}`
}

/** Reject paths and budgets that could escape or make a read unbounded. */
function resolveConfig(config: Config): ResolvedConfig {
  const memoryFile = config.memoryFile ?? '.dsh-memory.md'
  const instructionFile = config.instructionFile ?? 'AGENTS.md'
  for (const [field, value] of [['memoryFile', memoryFile], ['instructionFile', instructionFile]] as const) {
    if (value.length === 0 || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
      throw new TypeError(`workspace-memory: ${field} must be a same-directory filename`)
    }
  }
  if (memoryFile === instructionFile) {
    throw new TypeError('workspace-memory: memoryFile and instructionFile must be different files')
  }
  if (!Number.isSafeInteger(config.maxBytes) || config.maxBytes < 1) {
    throw new TypeError('workspace-memory: maxBytes must be a positive safe integer')
  }
  return {
    memoryFile,
    instructionFile,
    suggestUpdates: config.suggestUpdates ?? true,
    maxBytes: config.maxBytes,
  }
}

/** Resolve one fixed workspace file and reject a symlink final component. */
async function workspaceTarget(
  fs: FileSystem,
  cwd: string,
  file: string,
  signal?: AbortSignal,
): Promise<FsTarget> {
  const pathInfo = await fs.lstat(file, { cwd }, signal)
  if (pathInfo?.type === 'symlink') {
    throw new Error(`workspace-memory: ${file} must not be a symbolic link`)
  }
  return await fs.resolve(file, signal === undefined ? { cwd } : { cwd, signal })
}

/** Read an absent or bounded regular UTF-8 workspace file. */
async function readWorkspaceFile(
  fs: FileSystem,
  cwd: string,
  file: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<WorkspaceFileState> {
  const target = await workspaceTarget(fs, cwd, file, signal)
  const info = await fs.stat(target, signal)
  if (info === undefined) return { target }
  if (info.type !== 'file') throw new Error(`workspace-memory: ${file} must be a regular file`)
  const bytes = await fs.readBytes(target, signal, maxBytes)
  let content: string
  try {
    content = decoder.decode(bytes)
  } catch (error: unknown) {
    throw new Error(`workspace-memory: ${file} must contain valid UTF-8`, { cause: error })
  }
  return { target, info, content }
}

/** Prevent repository text from closing the plugin-owned reminder wrapper. */
function escapeReminder(text: string): string {
  return text.replaceAll('</system-reminder>', '&lt;/system-reminder>')
}

/** Render the complete non-authoritative memory portion of a workspace snapshot. */
export function renderWorkspaceMemory(memoryFile: string, content: string): string {
  const body = content.trim().length === 0
    ? 'No critical workspace memory is currently recorded.'
    : escapeReminder(content)
  return `Critical workspace memory from ${memoryFile} (shared project context, not instruction authority):\n\n${body}`
}

/** Render the complete shared-instruction portion of a workspace snapshot. */
export function renderWorkspaceInstructions(instructionFile: string, content: string): string {
  const body = content.trim().length === 0
    ? 'No shared workspace instructions are currently recorded.'
    : escapeReminder(content)
  return `Shared workspace instructions from ${instructionFile}:\n\n${body}`
}

/** Render one complete snapshot that supersedes all older plugin snapshots. */
export function renderWorkspaceState(
  memoryFile: string,
  memory: string,
  instructionFile: string,
  instructions: string,
): string {
  return '<system-reminder>\n'
    + 'Current workspace-shared state. This complete snapshot supersedes all earlier workspace-memory snapshots.\n\n'
    + `${renderWorkspaceInstructions(instructionFile, instructions)}\n\n`
    + 'Follow these instructions when applicable. They do not override system, developer, or the user\'s current request.\n\n'
    + `${renderWorkspaceMemory(memoryFile, memory)}\n`
    + '</system-reminder>'
}

/** Return the latest still-visible complete snapshot text for change suppression. */
function latestVisibleSnapshot(agent: Agent): string | undefined {
  for (const seq of agent.session.surface.nodes.toReversed()) {
    const event = agent.session.events[seq]
    if (event?.type !== 'user/message') continue
    const source = event.data.source
    if (source.kind !== 'plugin' || source.plugin !== name || source.form !== 'snapshot') continue
    if (source.sections[0]?.name !== 'workspace-state') continue
    return source.sections[0]?.text
  }
  return undefined
}

/** Require an owning agent with a workspace cwd for a workspace-scoped tool call. */
function workspaceCwd(agent: Agent | undefined): string {
  const cwd = agent?.session.header.cwd
  if (cwd === undefined) throw new Error('workspace_memory requires an agent session with a workspace cwd')
  return cwd
}

/** Resolve the configured filename for a tool kind. */
function fileForKind(config: ResolvedConfig, kind: WorkspaceFileKind): string {
  return kind === 'instruction' ? config.instructionFile : config.memoryFile
}

/** Register bounded state injection, curation guidance, and `workspace_memory`. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)

  if (resolved.suggestUpdates) {
    ctx.systemPrompt.section({ name: 'workspace-memory:curation', order: 90, text: CURATION_PROMPT })
  }

  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return decision
    const [memory, instructions] = await Promise.all([
      readWorkspaceFile(ctx.fs, cwd, resolved.memoryFile, resolved.maxBytes, signal),
      readWorkspaceFile(ctx.fs, cwd, resolved.instructionFile, resolved.maxBytes, signal),
    ])
    const text = renderWorkspaceState(
      resolved.memoryFile,
      memory.content ?? '',
      resolved.instructionFile,
      instructions.content ?? '',
    )
    if (text === latestVisibleSnapshot(agent)) return decision
    return {
      kind: 'enter',
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: {
            kind: 'plugin',
            plugin: name,
            form: 'snapshot',
            sections: [{ name: 'workspace-state', text }],
          },
        }),
      ],
    }
  }, { prepend: true })

  ctx.tools.register(defineTool({
    name: 'workspace_memory',
    description: 'Read, explicitly replace, or propose a user-confirmed replacement of workspace-shared state. Use kind "instruction" for reusable agent behavior, writing, formatting, workflow, validation, or tool-use rules in AGENTS.md. Use kind "memory" for stable project facts, decisions, terminology, constraints, and unresolved risks in .dsh-memory.md. Before proposing, review the complete target document and integrate a precise, coherent, non-duplicative edit. For feedback inferred to be reusable, use propose; never replace it without confirmation.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['read', 'replace', 'propose'],
        description: 'read returns the selected file; replace performs an explicitly requested full replacement; propose asks the user before writing a full replacement.',
      },
      kind: {
        type: 'string',
        enum: ['memory', 'instruction'],
        description: 'Target category and file. Defaults to memory for compatibility.',
      },
      content: {
        type: 'string',
        description: 'Complete replacement Markdown after reviewing and precisely integrating the change into the full document. Required for replace and propose; omitted for read.',
      },
      reason: {
        type: 'string',
        description: 'One concise sentence describing what changed and why it belongs in shared state. Required for propose; omitted otherwise.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true, enum: ['read', 'replace', 'propose'] },
          kind: { type: 'string', required: true, enum: ['memory', 'instruction'] },
          outcome: { type: 'string', required: true, enum: ['read', 'replaced', 'accepted', 'declined'] },
          path: { type: 'string', required: true },
          exists: { type: 'boolean', required: true },
          bytes: { type: 'integer', required: true },
          content: { type: 'string', required: true },
        },
      },
      render(_args, value) {
        if (value.outcome === 'declined') {
          return [{ type: 'text', text: `The user declined the proposed ${value.kind} update for ${value.path}; no file was changed.` }]
        }
        if (value.outcome === 'accepted' || value.outcome === 'replaced') {
          return [{ type: 'text', text: `${value.outcome === 'accepted' ? 'Accepted and updated' : 'Replaced'} ${value.kind} at ${value.path} (${value.bytes} UTF-8 bytes).` }]
        }
        const text = value.exists ? value.content : `(no workspace ${value.kind} recorded)`
        return [{ type: 'text', text: `Workspace ${value.kind} at ${value.path}:\n\n${text}` }]
      },
    },
    async execute(args, exec) {
      if (exec.agent === undefined) {
        throw new Error('workspace_memory requires an agent session with a workspace cwd')
      }
      const cwd = workspaceCwd(exec.agent)
      const kind: WorkspaceFileKind = args.kind ?? 'memory'
      const file = fileForKind(resolved, kind)
      const state = await readWorkspaceFile(ctx.fs, cwd, file, resolved.maxBytes, exec.signal)
      const previous = state.content ?? ''
      if (args.action === 'read') {
        if (args.content !== undefined || args.reason !== undefined) {
          throw new Error('workspace_memory read does not accept content or reason')
        }
        return {
          action: 'read' as const,
          kind,
          outcome: 'read' as const,
          path: state.target.displayPath,
          exists: state.info !== undefined,
          bytes: encoder.encode(previous).byteLength,
          content: previous,
        }
      }
      if (args.content === undefined) throw new Error(`workspace_memory ${args.action} requires content`)
      const bytes = encoder.encode(args.content).byteLength
      if (bytes > resolved.maxBytes) {
        throw new Error(`workspace-memory: replacement is ${bytes} bytes; maxBytes is ${resolved.maxBytes}`)
      }

      if (args.action === 'propose') {
        if (args.reason === undefined || args.reason.trim().length === 0) {
          throw new Error('workspace_memory propose requires a non-empty reason')
        }
        if (args.content === previous) {
          throw new Error(`workspace_memory propose must change ${file}; the candidate is already recorded`)
        }
        const reasonBytes = encoder.encode(args.reason).byteLength
        if (reasonBytes > resolved.maxBytes) {
          throw new Error(`workspace-memory: proposal reason is ${reasonBytes} bytes; maxBytes is ${resolved.maxBytes}`)
        }
        const answer = await ctx.userQuestions.ask({
          ...(exec.agent === undefined ? {} : { agent: exec.agent }),
          signal: exec.signal,
          questions: [{
            id: 'workspace-memory-update',
            header: file,
            question: kind === 'instruction'
              ? 'Save this workspace instruction?'
              : 'Save this project memory?',
            detail: renderProposalDetail(args.reason, previous, args.content),
            options: [
              { label: 'Apply', description: `Apply these changes to ${file}.` },
              { label: 'Keep current', description: `Leave ${file} unchanged.` },
            ],
          }],
        })
        const accepted = answer.answers.some(item =>
          item.id === 'workspace-memory-update' && item.selected.includes('Apply'))
        if (!accepted) {
          return {
            action: 'propose' as const,
            kind,
            outcome: 'declined' as const,
            path: state.target.displayPath,
            exists: state.info !== undefined,
            bytes: encoder.encode(previous).byteLength,
            content: previous,
          }
        }
      } else if (args.reason !== undefined) {
        throw new Error('workspace_memory replace does not accept reason')
      }

      await ctx.fs.writeText(
        state.target,
        args.content,
        state.info === undefined
          ? { kind: 'createIfAbsent' }
          : { kind: 'replaceIfVersion', version: state.info.version },
        exec.signal,
        ctx.sandboxPolicy.resolve({ session: exec.agent.session }),
      )
      return {
        action: args.action,
        kind,
        outcome: args.action === 'propose' ? 'accepted' as const : 'replaced' as const,
        path: state.target.displayPath,
        exists: true,
        bytes,
        content: args.content,
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: args.action === 'read'
        ? `Read workspace ${args.kind ?? 'memory'}`
        : args.action === 'propose'
          ? `Review ${fileForKind(resolved, args.kind ?? 'memory')} update`
          : `Replace workspace ${args.kind ?? 'memory'}`,
      kind: args.action === 'read' ? 'read' : 'edit',
      ...(args.action === 'propose' ? {} : { rawInput: args.content }),
      locations: [{ path: fileForKind(resolved, args.kind ?? 'memory') }],
    }),
  }))
}
