/** Structured, bounded review data shared by the host and browser bundle. */

export type ReviewKind = 'memory' | 'instruction'

export type ReviewRow =
  | {
      readonly kind: 'context' | 'add' | 'remove'
      readonly text: string
      readonly oldLine?: number
      readonly newLine?: number
    }
  | { readonly kind: 'omitted'; readonly count: number }

/** Versioned data embedded in the generic question detail for the Web UI. */
export interface WorkspaceReview {
  readonly version: 1
  readonly kind: ReviewKind
  readonly file: string
  readonly reason: string
  readonly rows: readonly ReviewRow[]
  readonly truncated: boolean
}

const REVIEW_MARKER = 'dsh-workspace-memory-review:v1:'

function base64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64Decode(text: string): string {
  const binary = atob(text)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Encode review data in an HTML comment hidden by ordinary Markdown renderers. */
export function encodeWorkspaceReview(review: WorkspaceReview): string {
  return `<!-- ${REVIEW_MARKER}${base64Encode(JSON.stringify(review))} -->`
}

/** Decode a workspace review marker, returning undefined for unrelated or invalid details. */
export function decodeWorkspaceReview(detail: string): WorkspaceReview | undefined {
  const match = detail.match(new RegExp(`^<!-- ${REVIEW_MARKER}([A-Za-z0-9+/=]+) -->`))
  if (match?.[1] === undefined) return undefined
  try {
    const candidate = JSON.parse(base64Decode(match[1])) as Partial<WorkspaceReview>
    if (candidate.version !== 1) return undefined
    if (candidate.kind !== 'instruction' && candidate.kind !== 'memory') return undefined
    if (typeof candidate.file !== 'string' || typeof candidate.reason !== 'string') return undefined
    if (!Array.isArray(candidate.rows) || !candidate.rows.every(isReviewRow)) return undefined
    if (typeof candidate.truncated !== 'boolean') return undefined
    return candidate as WorkspaceReview
  } catch {
    return undefined
  }
}

function isReviewRow(candidate: unknown): candidate is ReviewRow {
  if (typeof candidate !== 'object' || candidate === null || !('kind' in candidate)) return false
  const row = candidate as Record<string, unknown>
  if (row.kind === 'omitted') {
    return Number.isSafeInteger(row.count) && Number(row.count) > 0
  }
  if (row.kind !== 'context' && row.kind !== 'add' && row.kind !== 'remove') return false
  if (typeof row.text !== 'string') return false
  for (const key of ['oldLine', 'newLine'] as const) {
    if (row[key] !== undefined
      && (!Number.isSafeInteger(row[key]) || Number(row[key]) < 1)) return false
  }
  return true
}
