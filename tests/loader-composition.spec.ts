import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import * as WorkspaceMemory from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('dsh-workspace-memory real Loader composition through cordis.yml', () => {
  it('boots the complete service graph and exposes the curation policy and tool', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-workspace-memory-loader-'))
    await writeFile(join(root, 'AGENTS.md'), 'loader instruction\n', 'utf8')
    await writeFile(join(root, '.dsh-memory.md'), 'loader memory\n', 'utf8')
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-user-questions'",
      "- name: '@deepseek-ai/dsh-fs-local'",
      '  config:',
      `    cwd: ${JSON.stringify(root)}`,
      "- name: 'dsh-workspace-memory'",
      '  config:',
      '    maxBytes: 4096',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-user-questions', UserQuestionService],
      ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
      ['dsh-workspace-memory', WorkspaceMemory],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const assembly = await context.systemPrompt.assemble()
    expect(assembly.sections.find(section => section.name === 'workspace-memory:curation')?.text)
      .toBe(WorkspaceMemory.CURATION_PROMPT)
    expect(assembly.tools.map(tool => tool.name)).toContain('workspace_memory')

    // The runtime-facing injection path is covered with a real agent in
    // workspace-memory.spec.ts; this pins Loader exports, injection names,
    // schema defaults, and the complete service graph.
  })
})
