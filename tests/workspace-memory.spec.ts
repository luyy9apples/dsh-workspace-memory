import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRegistry, agentEvents, Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService, { type AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import * as workspaceMemory from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
function testAgent(cwd: string): Agent {
  const id = SessionId('workspace-memory-test')
  const session = Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 0,
    cwd,
  })
  return {
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function prepare(ctx: Context, agent: Agent) {
  const proposed = createUserMessage({
    content: [{ type: 'text', text: 'work' }],
    source: { kind: 'user' },
  })
  return await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [proposed], turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [proposed] }),
  )
}

describe('workspace memory injection', () => {
  it('shares both cwd files and suppresses an unchanged visible snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-memory-'))
    roots.push(root)
    await writeFile(join(root, '.dsh-memory.md'), '- Decision: keep the wire format stable.\n', 'utf8')
    await writeFile(join(root, 'AGENTS.md'), '- Always highlight changed document text.\n', 'utf8')

    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: root })
    workspaceMemory.apply(ctx, { maxBytes: 1024 })
    const agent = testAgent(root)

    const first = await prepare(ctx, agent)
    expect(first.kind).toBe('enter')
    if (first.kind !== 'enter') throw new Error('workspace memory rejected the step')
    expect(first.messages).toHaveLength(2)
    const snapshot = first.messages[1]
    if (snapshot === undefined) throw new Error('missing workspace memory snapshot')
    const block = snapshot.content[0]
    expect(block?.type).toBe('text')
    expect(block?.type === 'text' && block.text).toContain('Decision: keep the wire format stable.')
    expect(block?.type === 'text' && block.text).toContain('Always highlight changed document text.')
    agent.session.append('user/message', snapshot, { surfaceOp: 'append' })

    const second = await prepare(ctx, agent)
    expect(second.kind === 'enter' && second.messages).toHaveLength(1)
  })

  it('refreshes an existing session after AGENTS.md changes externally', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-memory-'))
    roots.push(root)
    await writeFile(join(root, 'AGENTS.md'), 'old instruction\n', 'utf8')
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(UserQuestionService)
    workspaceMemory.apply(ctx, { maxBytes: 1024 })
    const agent = testAgent(root)

    const first = await prepare(ctx, agent)
    if (first.kind !== 'enter') throw new Error('workspace state rejected the step')
    const snapshot = first.messages[1]
    if (snapshot === undefined) throw new Error('missing workspace state snapshot')
    agent.session.append('user/message', snapshot, { surfaceOp: 'append' })
    await writeFile(join(root, 'AGENTS.md'), 'new instruction\n', 'utf8')

    const second = await prepare(ctx, agent)
    expect(second.kind === 'enter' && second.messages).toHaveLength(2)
    const block = second.kind === 'enter' ? second.messages[1]?.content[0] : undefined
    expect(block?.type === 'text' && block.text).toContain('new instruction')
  })
})

async function proposalHarness(answer: 'Apply' | 'Keep current') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-memory-'))
  roots.push(root)
  await writeFile(join(root, 'AGENTS.md'), 'existing rule\n', 'utf8')
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(UserQuestionService)
  const seen: AskUserQuestionRequest[] = []
  ctx.userQuestions.registerProvider({
    async ask(request) {
      seen.push(request)
      return { answers: [{ id: request.questions[0]?.id ?? 'missing', selected: [answer] }] }
    },
  })
  workspaceMemory.apply(ctx, { maxBytes: 4096 })
  const agent = testAgent(root)
  ctx.agents.register(agent)
  return { root, ctx, agent, seen }
}

describe('confirmed workspace curation', () => {
  it('writes an instruction proposal only after the user accepts it', async () => {
    const test = await proposalHarness('Apply')
    const result = await test.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('accept-instruction'),
      name: 'workspace_memory',
      arguments: {
        action: 'propose',
        kind: 'instruction',
        reason: 'The rule should apply to future document edits.',
        content: 'existing rule\nnew durable rule\n',
      },
      agent: test.agent,
    })

    expect(result.isError).toBe(false)
    expect(test.seen[0]?.questions[0]).toMatchObject({
      question: 'Save this workspace instruction?',
      header: 'AGENTS.md',
    })
    expect(test.seen[0]?.questions[0]?.options).toEqual([
      { label: 'Apply', description: 'Apply these changes to AGENTS.md.' },
      { label: 'Keep current', description: 'Leave AGENTS.md unchanged.' },
    ])
    expect(test.seen[0]?.questions[0]?.detail).toContain('**Proposed changes**')
    expect(test.seen[0]?.questions[0]?.detail).toContain('+new durable rule')
    expect(test.seen[0]?.questions[0]?.detail).toContain('new durable rule')
    expect(test.seen[0]?.questions[0]?.detail).not.toContain('Complete proposed content')
    expect(await readFile(join(test.root, 'AGENTS.md'), 'utf8')).toBe('existing rule\nnew durable rule\n')
  })

  it('leaves memory unchanged when the user declines a proposal', async () => {
    const test = await proposalHarness('Keep current')
    const result = await test.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('decline-memory'),
      name: 'workspace_memory',
      arguments: {
        action: 'propose',
        kind: 'memory',
        reason: 'This looks like a stable project decision.',
        content: '- Decision: proposed.\n',
      },
      agent: test.agent,
    })

    expect(result.isError).toBe(false)
    await expect(readFile(join(test.root, '.dsh-memory.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(result.content[0]?.type === 'text' && result.content[0].text).toContain('declined')
  })

  it('rejects a no-op proposal without interrupting the user', async () => {
    const test = await proposalHarness('Apply')
    const result = await test.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('noop-instruction'),
      name: 'workspace_memory',
      arguments: {
        action: 'propose',
        kind: 'instruction',
        reason: 'This rule is already present.',
        content: 'existing rule\n',
      },
      agent: test.agent,
    })

    expect(result.isError).toBe(true)
    expect(test.seen).toHaveLength(0)
    expect(result.content[0]?.type === 'text' && result.content[0].text).toContain('already recorded')
  })
})
