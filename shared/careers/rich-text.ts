/**
 * Helpers for career content. The content field may be:
 *   - an HTML string (e.g. a Payload textarea/code field holding "<h2>…</h2><p>…</p>"),
 *   - a plain string (paragraphs separated by blank lines), or
 *   - Payload Lexical rich text: { root: { children: [...] } }.
 * All three are normalised to the same Lexical-shaped node tree, so rendering,
 * excerpts and plain text share one code path.
 */

export interface LexicalNode {
  type: string
  text?: string
  format?: number | string
  tag?: string
  listType?: 'bullet' | 'number' | 'check'
  url?: string
  fields?: { url?: string; newTab?: boolean; linkType?: string }
  children?: LexicalNode[]
  [key: string]: unknown
}

/** Lexical text format bit flags. */
export const TEXT_FORMAT = { bold: 1, italic: 2, strikethrough: 4, underline: 8, code: 16, subscript: 32, superscript: 64 }

export function isLexical(value: unknown): value is { root: LexicalNode } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'root' in value &&
    Array.isArray((value as { root?: LexicalNode }).root?.children)
  )
}

const looksLikeHtml = (value: string) => /<\/?[a-z][a-z0-9]*\b[^>]*>/i.test(value)

// --- HTML → node tree -------------------------------------------------------
// A deliberately small, allow-list based parser. It never produces raw HTML:
// unknown tags are unwrapped (their text kept), <script>/<style> are dropped,
// attributes are ignored except a link's href (checked again by safeUrl).

const BLOCK_TAGS: Record<string, (attrs: string) => LexicalNode> = {
  p: () => ({ type: 'paragraph' }),
  h1: () => ({ type: 'heading', tag: 'h1' }),
  h2: () => ({ type: 'heading', tag: 'h2' }),
  h3: () => ({ type: 'heading', tag: 'h3' }),
  h4: () => ({ type: 'heading', tag: 'h4' }),
  h5: () => ({ type: 'heading', tag: 'h5' }),
  h6: () => ({ type: 'heading', tag: 'h6' }),
  ul: () => ({ type: 'list', listType: 'bullet' }),
  ol: () => ({ type: 'list', listType: 'number' }),
  li: () => ({ type: 'listitem' }),
  blockquote: () => ({ type: 'quote' }),
  a: (attrs) => {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs)
    const target = /\btarget\s*=\s*["']?_blank/i.test(attrs)
    return { type: 'link', fields: { url: decodeEntities(href?.[1] ?? href?.[2] ?? href?.[3] ?? ''), newTab: target } }
  },
}

const FORMAT_TAGS: Record<string, number> = {
  strong: TEXT_FORMAT.bold, b: TEXT_FORMAT.bold,
  em: TEXT_FORMAT.italic, i: TEXT_FORMAT.italic,
  u: TEXT_FORMAT.underline,
  s: TEXT_FORMAT.strikethrough, del: TEXT_FORMAT.strikethrough, strike: TEXT_FORMAT.strikethrough,
  code: TEXT_FORMAT.code,
  sub: TEXT_FORMAT.subscript, sup: TEXT_FORMAT.superscript,
}

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr', 'area', 'col', 'embed'])
const SKIP_CONTENT_TAGS = new Set(['script', 'style', 'template', 'iframe', 'object', 'noscript'])
// Containers where whitespace-only text between children is insignificant.
const STRUCTURAL = new Set(['root', 'list'])

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match
  })
}

interface Frame {
  tag: string
  node: LexicalNode
  format: number
}

export function parseHtml(html: string): LexicalNode[] {
  const root: LexicalNode = { type: 'root', children: [] }
  const stack: Frame[] = [{ tag: '#root', node: root, format: 0 }]
  const top = () => stack[stack.length - 1]!
  const append = (node: LexicalNode) => (top().node.children ??= []).push(node)

  const token = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)|</g
  let skipUntil: string | null = null

  for (let m = token.exec(html); m; m = token.exec(html)) {
    const [whole, closing, rawTag, attrs = '', text] = m
    const tag = rawTag?.toLowerCase()

    if (skipUntil) {
      if (closing && tag === skipUntil) skipUntil = null
      continue
    }

    if (text !== undefined || whole === '<') {
      const value = decodeEntities(text ?? '<').replace(/\s+/g, ' ')
      if (value.trim() || !STRUCTURAL.has(top().node.type)) {
        if (value) append({ type: 'text', text: value, format: top().format })
      }
      continue
    }
    if (!tag) continue // comment

    if (closing) {
      // Pop to the matching open element; ignore stray closing tags.
      const index = stack.findLastIndex((frame) => frame.tag === tag)
      if (index > 0) stack.length = index
      continue
    }

    if (SKIP_CONTENT_TAGS.has(tag)) {
      if (!/\/\s*$/.test(attrs)) skipUntil = tag
      continue
    }
    if (tag === 'br') {
      append({ type: 'linebreak' })
      continue
    }
    if (tag === 'hr') {
      append({ type: 'horizontalrule' })
      continue
    }
    if (VOID_TAGS.has(tag)) continue

    const format = top().format | (FORMAT_TAGS[tag] ?? 0)
    const make = BLOCK_TAGS[tag]
    if (make) {
      const node: LexicalNode = { ...make(attrs), children: [] }
      append(node)
      stack.push({ tag, node, format })
    } else {
      // Inline formatting or an unknown wrapper (div, span, section…): keep
      // its content in the current parent.
      stack.push({ tag, node: top().node, format })
    }
  }

  // Trim whitespace that only separated blocks at the edges of each block.
  const trimEdges = (nodes: LexicalNode[] = []) => {
    for (const node of nodes) {
      if (node.type !== 'text' && node.children?.length) {
        const first = node.children[0]!
        const last = node.children[node.children.length - 1]!
        if (first.type === 'text') first.text = first.text?.trimStart()
        if (last.type === 'text') last.text = last.text?.trimEnd()
        node.children = node.children.filter((child) => child.type !== 'text' || child.text)
        trimEdges(node.children)
      }
    }
  }
  trimEdges(root.children)
  return root.children ?? []
}

// --- Normalisation ----------------------------------------------------------

/** Converts any supported content value to a list of block nodes (empty if none). */
export function toNodes(value: unknown): LexicalNode[] {
  if (isLexical(value)) return value.root.children ?? []
  if (typeof value !== 'string') return []
  if (looksLikeHtml(value)) return parseHtml(value)
  return value
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ type: 'paragraph', children: [{ type: 'text', text: p }] }))
}

const BLOCK_TYPES = new Set(['paragraph', 'heading', 'listitem', 'quote'])

function collectText(node: LexicalNode, out: string[]) {
  if (node.type === 'text' && node.text) out.push(node.text)
  if (node.type === 'linebreak') out.push(' ')
  node.children?.forEach((child) => collectText(child, out))
  if (BLOCK_TYPES.has(node.type)) out.push(' ')
}

function truncate(text: string, maxLength?: number): string {
  if (!maxLength || text.length <= maxLength) return text
  const cut = text.slice(0, maxLength - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

function nodesToText(nodes: LexicalNode[]): string {
  const parts: string[] = []
  nodes.forEach((node) => collectText(node, parts))
  return parts.join('').replace(/\s+/g, ' ').trim()
}

/** Flattens content to plain text, optionally truncated on a word boundary. */
export function toPlainText(value: unknown, maxLength?: number): string {
  return truncate(nodesToText(toNodes(value)), maxLength)
}

/** Short summary for cards and meta tags: the first paragraph of the content. */
export function toExcerpt(value: unknown, maxLength: number): string {
  const nodes = toNodes(value)
  const first = nodes.find((node) => node.type === 'paragraph')
  return truncate(nodesToText(first ? [first] : nodes), maxLength)
}

/** Allows only http(s), mailto, tel and site-relative URLs (blocks javascript: etc.). */
export function safeUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined
  const trimmed = url.trim()
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed
  if (trimmed.startsWith('#')) return trimmed
  return undefined
}
