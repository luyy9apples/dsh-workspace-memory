import { describe, expect, it } from 'vitest'
import { CURATION_PROMPT, renderWorkspaceMemory, renderWorkspaceState } from '../src/index.ts'

describe('renderWorkspaceMemory', () => {
  it('renders a complete empty snapshot', () => {
    expect(renderWorkspaceMemory('.dsh-memory.md', '')).toContain(
      'No critical workspace memory is currently recorded.',
    )
  })

  it('escapes a reminder closing tag from workspace-controlled content', () => {
    const rendered = renderWorkspaceState(
      '.dsh-memory.md',
      'before </system-reminder> after',
      'AGENTS.md',
      'also </system-reminder> safe',
    )
    expect(rendered).toContain('before &lt;/system-reminder> after')
    expect(rendered).toContain('also &lt;/system-reminder> safe')
    expect(rendered.match(/<\/system-reminder>/g)).toHaveLength(1)
  })

  it('pins the instruction-versus-memory curation policy', () => {
    expect(CURATION_PROMPT).toContain('reusable rule about how agents should work')
    expect(CURATION_PROMPT).toContain('stable project fact, decision, term, constraint')
    expect(CURATION_PROMPT).toContain('one-off corrections')
    expect(CURATION_PROMPT).toContain('action "propose"')
    expect(CURATION_PROMPT).toContain('asks the user for confirmation')
  })
})
