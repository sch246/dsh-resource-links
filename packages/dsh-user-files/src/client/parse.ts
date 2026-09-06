/** Candidate recognition only; existence and canonical identity belong to the file manager. */
export interface Candidate {
  readonly start: number
  readonly end: number
  readonly target: string
  readonly label?: string
}

/** @param target Complete destination. @returns Session id for an explicit session reference. */
export function sessionTarget(target: string): string | undefined {
  return /^dsh-session:([^\s/?#]+)$/u.exec(target)?.[1]
}

/** @param target Exact destination, including optional source position. @param allowBasename Whether explicit destinations may name extensionless files/directories. @returns Local path, or undefined for unsupported/ambiguous destinations. */
export function filesystemTarget(target: string, allowBasename = true): string | undefined {
  let path = target.replace(/(?::[1-9]\d*(?::[1-9]\d*)?|#L[1-9]\d*(?:C[1-9]\d*)?(?:-L?[1-9]\d*(?:C[1-9]\d*)?)?)$/u, '')
  if (path.startsWith('file:')) {
    try {
      const url = new URL(path)
      if (url.protocol !== 'file:' || (url.hostname !== '' && url.hostname !== 'localhost') || url.search !== '' || url.hash !== '') return undefined
      path = decodeURIComponent(url.pathname)
    } catch { return undefined }
  } else if (/^[a-z][a-z\d+.-]*:/iu.test(path)) return undefined
  if (path === '' || /[\u0000-\u001f\u007f]/u.test(path) || path.includes('://') || /^[^/\s]+@[^/\s]+\.[^/\s]+/u.test(path) || path.startsWith('//')) return undefined
  if (path === '.' || path === '..' || path.startsWith('/') || path.startsWith('./') || path.startsWith('../')) return path
  if (path.includes('/') || /^[^\s.][^/]*\.[\p{L}\p{N}_-]+$/u.test(path)) return path
  return allowBasename ? path : undefined
}

function candidate(target: string, start: number, end: number, label?: string, allowFilesystem = false): Candidate | undefined {
  if (sessionTarget(target) === undefined && (!allowFilesystem || filesystemTarget(target) === undefined)) return undefined
  return { start, end, target, ...(label === undefined ? {} : { label }) }
}

/** @param text Displayed source. @param mode Parsed inline code permits filesystem discovery; prose and authored destinations only permit explicit session references. @param limit Candidate budget. @returns Ordered non-overlapping UTF-16 ranges. */
export function candidates(text: string, mode: 'text' | 'inline-code' | 'target', limit: number): readonly Candidate[] {
  if (limit <= 0) return []
  if (mode !== 'text') {
    const found = candidate(text, 0, text.length, undefined, mode === 'inline-code')
    return found === undefined ? [] : [found]
  }
  const result: Candidate[] = []
  // Session references retain their labels and prose delimiters in text mode.
  const tokens = /@\[([^\]\n]+)\]\((dsh-session:[^\s)]+)\)|"([^"\n]+)"|'([^'\n]+)'|[^\s<>"'`，。；！？、]+/gu
  for (const match of text.matchAll(tokens)) {
    if (result.length >= limit) break
    if (match[2] !== undefined) {
      const found = candidate(match[2], match.index, match.index + match[0].length, match[1])
      if (found !== undefined) result.push(found)
      continue
    }
    const quoted = match[3] ?? match[4]
    let token = quoted ?? match[0]
    let start = match.index + (quoted === undefined ? 0 : 1)
    if (quoted === undefined) {
      const leading = /^[([{]+/u.exec(token)?.[0].length ?? 0
      start += leading
      token = token.slice(leading).replace(/[.,;!?]+$/u, '')
      for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
        while (token.endsWith(close) && token.split(close).length > token.split(open).length) token = token.slice(0, -1)
      }
    }
    const found = candidate(token, start, start + token.length)
    if (found !== undefined) result.push(found)
  }
  return result
}
