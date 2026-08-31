import { describe, expect, it } from 'vitest'
import {
  CURATION_PROMPT,
  renderProposalDetail,
  renderProposalDiff,
  renderWorkspaceMemory,
  renderWorkspaceState,
} from '../src/index.ts'

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
    expect(CURATION_PROMPT).toContain('review the corresponding complete Markdown file')
    expect(CURATION_PROMPT).toContain('most relevant existing section')
    expect(CURATION_PROMPT).toContain('remove duplication in the affected section')
    expect(CURATION_PROMPT).toContain('do not rewrite unrelated sections')
    expect(CURATION_PROMPT).toContain('action "propose"')
    expect(CURATION_PROMPT).toContain('shows a focused diff')
    expect(CURATION_PROMPT).toContain('do not fall back to write, edit, shell')
  })

  it('renders a focused contextual diff instead of the complete document', () => {
    const before = ['# Rules', '', '- Keep this.', '', '# Unchanged', '', 'a', 'b', 'c', 'd', ''].join('\n')
    const after = ['# Rules', '', '- Keep this.', '- Run tests.', '', '# Unchanged', '', 'a', 'b', 'c', 'd', ''].join('\n')
    const diff = renderProposalDiff(before, after)

    expect(diff).toContain('+- Run tests.')
    expect(diff).toContain('unchanged line')
    expect(diff).not.toContain(' a\n b\n c\n d')
  })

  it('keeps proposal details concise and hides the complete replacement', () => {
    const detail = renderProposalDetail(
      `  Add a durable rule. ${'extra '.repeat(80)}`,
      '# Rules\n\n- Existing.\n',
      '# Rules\n\n- Existing.\n- Run tests.\n',
    )

    expect(detail).toContain('**Why this change**')
    expect(detail).toContain('**Proposed changes**')
    expect(detail).toContain('+- Run tests.')
    expect(detail).toContain('…')
    expect(detail).not.toContain('Complete proposed content')
  })
})
