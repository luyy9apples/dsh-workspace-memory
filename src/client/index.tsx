/** Browser companion that renders workspace-memory proposals as focused diff reviews. */

import { useState } from 'react'
import type { ClientContext, PendingWait } from '@deepseek-ai/dsh-client-runtime/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { decodeWorkspaceReview, type WorkspaceReview } from '../review.ts'

type QuestionWait = PendingWait<'question'>

interface MatchedReview {
  readonly wait: QuestionWait
  readonly review: WorkspaceReview
  readonly question: string
  readonly approve: string
  readonly decline: string
}

const STYLE_ID = 'dsh-workspace-memory-review-style'
const styles = `
.wmr-frame{display:flex;justify-content:center;padding:6px calc(var(--dsh-composer-side-clearance) + 16px) 10px}.wmr-card{display:flex;overflow:hidden;flex-direction:column;width:100%;max-width:var(--dsh-chat-content-width);max-height:min(62vh,560px);border:1px solid var(--dsw-alias-state-warn-secondary);border-radius:20px;background:var(--dsw-specific-input-major);box-shadow:var(--dsw-shadow-lv2);color:var(--dsw-alias-label-primary)}.wmr-card,.wmr-card *{box-sizing:border-box}.wmr-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:14px 16px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}.wmr-heading{min-width:0}.wmr-kicker{margin-bottom:3px;color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:17px}.wmr-title{margin:0;font-size:15px;line-height:22px;font-weight:600}.wmr-reason{overflow:hidden;margin:3px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}.wmr-file{flex-shrink:0;padding:4px 9px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font:12px/18px ui-monospace,SFMono-Regular,Consolas,monospace}.wmr-diff{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 0;background:var(--dsw-specific-input-major);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}.wmr-row{display:grid;grid-template-columns:42px 42px 22px minmax(0,1fr);min-height:24px;font:12px/24px ui-monospace,SFMono-Regular,Consolas,monospace}.wmr-row.context{color:var(--dsw-alias-label-secondary)}.wmr-row.add{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-label-primary)}.wmr-row.remove{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-label-primary)}.wmr-line{padding-right:8px;color:var(--dsw-alias-label-tertiary);text-align:right;user-select:none}.wmr-sign{text-align:center;user-select:none}.wmr-row.add .wmr-sign{color:var(--dsw-alias-state-success-primary)}.wmr-row.remove .wmr-sign{color:var(--dsw-alias-state-error-primary)}.wmr-code{overflow-wrap:anywhere;padding-right:16px;white-space:pre-wrap}.wmr-omitted{padding:6px 16px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;text-align:center}.wmr-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px 12px;border-top:1px solid var(--dsw-alias-border-l1)}.wmr-feedback{min-height:16px;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px}.wmr-actions{display:flex;flex-shrink:0;gap:8px}.wmr-button{min-height:32px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:30px;cursor:pointer}.wmr-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.wmr-button.primary{border-color:var(--dsw-alias-button-primary-fill);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}.wmr-button.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}.wmr-button:disabled{cursor:default;opacity:.55}@media(max-width:720px){.wmr-card{border-radius:16px}.wmr-header{padding:12px}.wmr-file{display:none}.wmr-row{grid-template-columns:34px 34px 18px minmax(0,1fr)}.wmr-footer{padding:9px 12px 10px}}
`

function selectWorkspaceReview({ interactions }: ComposerChainProps): MatchedReview | null {
  for (const interaction of interactions) {
    if (interaction.kind !== 'question' || interaction.payload.questions.length !== 1) continue
    const question = interaction.payload.questions[0]
    if (question?.id !== 'workspace-memory-update' || question.detail === undefined || question.multiSelect === true) continue
    const review = decodeWorkspaceReview(question.detail)
    if (review === undefined) continue
    const options = question.options ?? []
    const approve = options.find(option => option.label === 'Apply')?.label
    const decline = options.find(option => option.label === 'Keep current')?.label
    if (approve === undefined || decline === undefined) continue
    return { wait: interaction, review, question: question.question, approve, decline }
  }
  return null
}

function WorkspaceReviewPanel({ matched }: { readonly matched: MatchedReview }) {
  const { wait, review } = matched
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const title = review.kind === 'instruction' ? '更新工作区指令' : '更新工作区记忆'
  const category = review.kind === 'instruction' ? '后续会话共同遵循' : '后续会话共享参考'
  const answer = (label: string): void => {
    setBusy(true)
    setError(null)
    void wait.respond({
      ok: true,
      value: {
        sessionId: wait.sessionId,
        answer: { answers: [{ id: 'workspace-memory-update', selected: [label] }] },
      },
    }).then((receipt) => {
      if (!receipt.accepted) throw new Error(`提交失败：${receipt.reason}`)
    }).catch((cause: unknown) => {
      setBusy(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  return (
    <div className="wmr-frame" data-workspace-memory-review={wait.key}>
      <section className="wmr-card" aria-label={matched.question}>
        <header className="wmr-header">
          <div className="wmr-heading">
            <div className="wmr-kicker">{category}</div>
            <h2 className="wmr-title">{title}</h2>
            <p className="wmr-reason" title={review.reason}>{review.reason}</p>
          </div>
          <span className="wmr-file">{review.file}</span>
        </header>
        <div className="wmr-diff" aria-label="修改内容">
          {review.rows.map((row, index) => row.kind === 'omitted' ? (
            <div className="wmr-omitted" key={`omitted-${index}`}>⋯ 省略 {row.count} 行未修改内容 ⋯</div>
          ) : (
            <div className={`wmr-row ${row.kind}`} key={`${row.kind}-${index}`}>
              <span className="wmr-line">{row.oldLine ?? ''}</span>
              <span className="wmr-line">{row.newLine ?? ''}</span>
              <span className="wmr-sign">{row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ''}</span>
              <code className="wmr-code">{row.text || ' '}</code>
            </div>
          ))}
          {review.truncated && <div className="wmr-omitted">预览内容较长，后续修改已折叠</div>}
        </div>
        <footer className="wmr-footer">
          <div className="wmr-feedback" role="status">{error}</div>
          <div className="wmr-actions">
            <button className="wmr-button" disabled={busy} onClick={() => { answer(matched.decline) }}>保持原文</button>
            <button className="wmr-button primary" disabled={busy} onClick={() => { answer(matched.approve) }}>应用修改</button>
          </div>
        </footer>
      </section>
    </div>
  )
}

/** Services required by the browser companion. */
export const inject = ['slots']

/** Register the focused review before the generic question composer. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    document.getElementById(STYLE_ID)?.remove()
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = 'dsh-workspace-memory'
    tag.textContent = styles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'workspace-memory: review styles')
  ctx.slots.inject('conversation.composer', () => ctx.slots.register(
    { name: 'conversation.composer', select: selectWorkspaceReview, priority: -1 },
    WorkspaceReviewPanel,
  ))
}
