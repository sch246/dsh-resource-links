import type {} from '@deepseek-ai/dsh-client-ui-chat/client'

/**
 * Presentation intent for one workspace-file destination.
 * `replace: 'current'` asks a handler that owns `viewId` to move that tab instead of adding one;
 * `sourceInstanceId` names the sidebar instance a click started from.
 */
export interface WorkspaceFileOpenIntent {
  readonly viewId?: string
  readonly replace?: 'current'
  readonly sourceInstanceId?: string
}

/** @param path Complete destination. @returns Path without location and optional one-based editor selection. */
export function parseFileLocation(path: string): { path: string; textSelection?: { line: number; column?: number } } {
  const match = /(?::([1-9]\d*)(?::([1-9]\d*))?|#L([1-9]\d*)(?:C([1-9]\d*))?)(?:-L?[1-9]\d*(?:C[1-9]\d*)?)?$/u.exec(path)
  if (match === null) return { path }
  const line = Number(match[1] ?? match[3])
  const column = match[2] === undefined && match[4] === undefined ? undefined : Number(match[2] ?? match[4])
  if (!Number.isSafeInteger(line) || (column !== undefined && !Number.isSafeInteger(column))) return { path }
  return { path: path.slice(0, match.index), textSelection: { line, ...(column === undefined ? {} : { column }) } }
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatFileOpenRequest extends WorkspaceFileOpenIntent {
    readonly textSelection?: { readonly line: number; readonly column?: number }
  }
}
