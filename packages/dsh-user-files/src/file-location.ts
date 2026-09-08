import type {} from '@deepseek-ai/dsh-client-ui-chat/client'

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
  interface ChatFileOpenRequest {
    readonly textSelection?: { readonly line: number; readonly column?: number }
  }
}
