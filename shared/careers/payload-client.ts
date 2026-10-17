/**
 * Minimal read-only client for the Payload CMS REST API, scoped to the careers
 * collection. Framework-agnostic: used by Azure Functions at runtime and by
 * Nuxt/Nitro at build time (prerendering and route discovery).
 */
import type { Career, PaginatedCareers } from './types'

export interface PayloadConfig {
  baseUrl: string
  collection: string
  /** Filter on `_status = published` (collections with drafts enabled). */
  drafts: boolean
  /** Checkbox field that marks a document as public, e.g. `published`; null disables. */
  publishedField: string | null
  headers: Record<string, string>
  timeoutMs: number
}

type Env = Record<string, string | undefined>

export class PayloadConfigError extends Error {}

export class PayloadRequestError extends Error {
  constructor(readonly status: number) {
    super(`Payload returned HTTP ${status}`)
  }
}

/**
 * Reads configuration from environment variables. The same variable names are
 * used in Azure app settings, GitHub Actions secrets and local `.env` files.
 */
export function payloadConfigFromEnv(env: Env): PayloadConfig {
  const url = env.PAYLOAD_URL?.trim()
  if (!url) {
    throw new PayloadConfigError('PAYLOAD_URL is not configured')
  }

  // Payload API keys are sent as "<auth-collection-slug> API-Key <key>".
  // A user JWT is deliberately not supported: it expires, so it is unsuitable
  // as a long-lived server-side credential.
  const apiKey = env.PAYLOAD_API_KEY?.trim()
  const keyCollection = env.PAYLOAD_API_KEY_COLLECTION?.trim() || 'users'

  return {
    baseUrl: url.replace(/\/+$/, ''),
    collection: env.PAYLOAD_CAREERS_COLLECTION?.trim() || 'careers',
    drafts: env.PAYLOAD_DRAFTS?.trim().toLowerCase() === 'true',
    // Unset means the default `published` checkbox; an empty value disables the filter.
    publishedField: env.PAYLOAD_PUBLISHED_FIELD === undefined ? 'published' : env.PAYLOAD_PUBLISHED_FIELD.trim() || null,
    headers: {
      Accept: 'application/json',
      ...(apiKey ? { Authorization: `${keyCollection} API-Key ${apiKey}` } : {}),
    },
    timeoutMs: Number(env.PAYLOAD_TIMEOUT_MS) || 8000,
  }
}

const SELECTED_FIELDS = ['title', 'slug', 'content'] as const

export const MAX_PAGE_SIZE = 50

function baseQuery(config: PayloadConfig, fields: readonly string[]): Record<string, string> {
  const query: Record<string, string> = { depth: '0' }
  for (const field of fields) {
    query[`select[${field}]`] = 'true'
  }
  if (config.drafts) {
    query['where[_status][equals]'] = 'published'
  }
  if (config.publishedField) {
    query[`where[${config.publishedField}][equals]`] = 'true'
  }
  return query
}

async function request<T>(
  config: PayloadConfig,
  params: Record<string, string>,
  fields: readonly string[] = SELECTED_FIELDS,
): Promise<T> {
  const query = new URLSearchParams({ ...baseQuery(config, fields), ...params })
  const url = `${config.baseUrl}/api/${encodeURIComponent(config.collection)}?${query}`

  const response = await fetch(url, {
    headers: config.headers,
    signal: AbortSignal.timeout(config.timeoutMs),
  })

  if (!response.ok) {
    throw new PayloadRequestError(response.status)
  }

  return (await response.json()) as T
}

/** Projects a Payload document onto the public Career shape (drops unknown fields). */
function toCareer(doc: Career): Career {
  return {
    id: String(doc.id),
    title: doc.title,
    slug: doc.slug,
    content: doc.content ?? null,
  }
}

export async function fetchPublishedCareers(
  config: PayloadConfig,
  { limit, page }: { limit: number; page: number },
): Promise<PaginatedCareers> {
  const result = await request<PaginatedCareers>(config, {
    limit: String(limit),
    page: String(page),
    // Alphabetical, so students can scan the full list of career paths.
    sort: 'title',
  })

  return {
    docs: result.docs.map(toCareer),
    totalDocs: result.totalDocs,
    limit: result.limit,
    totalPages: result.totalPages,
    page: result.page ?? page,
    hasNextPage: result.hasNextPage,
    hasPrevPage: result.hasPrevPage,
  }
}

export async function fetchPublishedCareer(
  config: PayloadConfig,
  slug: string,
): Promise<Career | null> {
  const result = await request<{ docs: Career[] }>(config, {
    limit: '1',
    'where[slug][equals]': slug,
  })
  const doc = result.docs[0]
  return doc ? toCareer(doc) : null
}

/** Every published slug, used at build time to prerender one page per career path. */
export async function fetchAllPublishedSlugs(config: PayloadConfig): Promise<string[]> {
  const slugs: string[] = []
  let page = 1

  for (;;) {
    const result = await request<{ docs: Pick<Career, 'slug'>[]; hasNextPage: boolean }>(
      config,
      { limit: '100', page: String(page) },
      ['slug'],
    )
    slugs.push(...result.docs.map((doc) => doc.slug).filter(Boolean))
    if (!result.hasNextPage) return slugs
    page += 1
  }
}
