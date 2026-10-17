import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleGetCareer, handleListCareers, isValidSlug, parsePagination } from '../../shared/careers/http'
import { fetchAllPublishedSlugs, payloadConfigFromEnv } from '../../shared/careers/payload-client'
import { parseHtml, safeUrl, toExcerpt, toNodes, toPlainText } from '../../shared/careers/rich-text'

const env = { PAYLOAD_URL: 'https://cms.example.com/', PAYLOAD_API_KEY: 'secret' }
const silent = () => {}

function mockFetch(...responses: Array<{ status?: number; body?: unknown }>) {
  const fn = vi.fn()
  for (const { status = 200, body = {} } of responses) {
    fn.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }))
  }
  vi.stubGlobal('fetch', fn)
  return fn
}

function requestedUrl(fn: ReturnType<typeof vi.fn>, call = 0) {
  return new URL(fn.mock.calls[call]![0] as string)
}

afterEach(() => vi.unstubAllGlobals())

describe('payloadConfigFromEnv', () => {
  it('requires PAYLOAD_URL', () => {
    expect(() => payloadConfigFromEnv({})).toThrow('PAYLOAD_URL')
  })

  it('builds an API-key header and strips trailing slashes', () => {
    const config = payloadConfigFromEnv({ ...env, PAYLOAD_API_KEY_COLLECTION: 'service-accounts' })
    expect(config.baseUrl).toBe('https://cms.example.com')
    expect(config.headers.Authorization).toBe('service-accounts API-Key secret')
  })

  it('defaults to the `published` checkbox and no drafts', () => {
    const config = payloadConfigFromEnv({ PAYLOAD_URL: 'http://x' })
    expect(config.headers.Authorization).toBeUndefined()
    expect(config.drafts).toBe(false)
    expect(config.publishedField).toBe('published')
  })

  it('honours PAYLOAD_DRAFTS=true and a custom or empty PAYLOAD_PUBLISHED_FIELD', () => {
    expect(payloadConfigFromEnv({ ...env, PAYLOAD_DRAFTS: 'true' }).drafts).toBe(true)
    expect(payloadConfigFromEnv({ ...env, PAYLOAD_PUBLISHED_FIELD: 'isLive' }).publishedField).toBe('isLive')
    expect(payloadConfigFromEnv({ ...env, PAYLOAD_PUBLISHED_FIELD: '' }).publishedField).toBeNull()
  })
})

describe('parsePagination', () => {
  it('clamps and defaults values', () => {
    expect(parsePagination(new URLSearchParams())).toEqual({ limit: 10, page: 1 })
    expect(parsePagination(new URLSearchParams('limit=500&page=0'))).toEqual({ limit: 50, page: 1 })
    expect(parsePagination(new URLSearchParams('limit=abc&page=3'))).toEqual({ limit: 10, page: 3 })
  })
})

describe('isValidSlug', () => {
  it.each([
    ['software-developer', true],
    ['role-2', true],
    ['Bad Slug', false],
    ['../etc', false],
    ['a'.repeat(201), false],
    [undefined, false],
  ])('%s -> %s', (slug, expected) => {
    expect(isValidSlug(slug)).toBe(expected)
  })
})

describe('handleListCareers', () => {
  it('filters on _status instead when drafts are enabled', async () => {
    const fetchFn = mockFetch({ body: { docs: [], totalDocs: 0, limit: 10, totalPages: 0, page: 1 } })
    await handleListCareers(new URLSearchParams(), { ...env, PAYLOAD_DRAFTS: 'true', PAYLOAD_PUBLISHED_FIELD: '' }, silent)
    const url = requestedUrl(fetchFn)
    expect(url.searchParams.get('where[_status][equals]')).toBe('published')
    expect(url.searchParams.get('where[published][equals]')).toBeNull()
  })

  it('queries published careers with selection, sort and pagination', async () => {
    const fetchFn = mockFetch({
      body: {
        docs: [{ id: 1, title: 'Electrician', slug: 'electrician', internalNotes: 'hidden' }],
        totalDocs: 1, limit: 20, totalPages: 1, page: 2, hasNextPage: false, hasPrevPage: true,
      },
    })

    const result = await handleListCareers(new URLSearchParams('limit=20&page=2'), env, silent)

    expect(result.status).toBe(200)
    const url = requestedUrl(fetchFn)
    expect(url.pathname).toBe('/api/careers')
    expect(url.searchParams.get('where[published][equals]')).toBe('true')
    expect(url.searchParams.get('where[_status][equals]')).toBeNull()
    expect(url.searchParams.get('sort')).toBe('title')
    expect(url.searchParams.get('limit')).toBe('20')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('select[title]')).toBe('true')
    expect(url.searchParams.get('depth')).toBe('0')
    expect(fetchFn.mock.calls[0]![1].headers.Authorization).toBe('users API-Key secret')

    const body = result.body as unknown as { docs: Record<string, unknown>[] }
    expect(body.docs[0]).toMatchObject({ id: '1', title: 'Electrician' })
    expect(Object.keys(body.docs[0]!).sort()).toEqual(['content', 'id', 'slug', 'title'])
  })

  it('returns 502 when Payload fails', async () => {
    mockFetch({ status: 503 })
    const result = await handleListCareers(new URLSearchParams(), env, silent)
    expect(result).toMatchObject({ status: 502, headers: { 'Cache-Control': 'no-store' } })
  })

  it('returns 500 when misconfigured', async () => {
    const result = await handleListCareers(new URLSearchParams(), {}, silent)
    expect(result.status).toBe(500)
  })
})

describe('handleGetCareer', () => {
  it('rejects invalid slugs without calling Payload', async () => {
    const fetchFn = mockFetch()
    const result = await handleGetCareer('Not Valid!', env, silent)
    expect(result.status).toBe(400)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('returns 404 when no published career matches', async () => {
    const fetchFn = mockFetch({ body: { docs: [] } })
    const result = await handleGetCareer('missing-role', env, silent)
    expect(result.status).toBe(404)
    expect(requestedUrl(fetchFn).searchParams.get('where[slug][equals]')).toBe('missing-role')
  })

  it('returns the career', async () => {
    mockFetch({ body: { docs: [{ id: 'abc', title: 'Nurse', slug: 'nurse' }] } })
    const result = await handleGetCareer('nurse', env, silent)
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ id: 'abc', title: 'Nurse', slug: 'nurse', content: null })
  })
})

describe('fetchAllPublishedSlugs', () => {
  it('follows pagination and selects only the slug', async () => {
    const fetchFn = mockFetch(
      { body: { docs: [{ slug: 'a' }, { slug: 'b' }], hasNextPage: true } },
      { body: { docs: [{ slug: 'c' }], hasNextPage: false } },
    )
    const slugs = await fetchAllPublishedSlugs(payloadConfigFromEnv(env))
    expect(slugs).toEqual(['a', 'b', 'c'])
    expect(requestedUrl(fetchFn, 1).searchParams.get('page')).toBe('2')
    expect(requestedUrl(fetchFn).searchParams.get('select[title]')).toBeNull()
  })
})

describe('rich text helpers', () => {
  const lexical = {
    root: {
      type: 'root',
      children: [
        { type: 'heading', tag: 'h2', children: [{ type: 'text', text: 'About' }] },
        { type: 'paragraph', children: [{ type: 'text', text: 'Help people every day.' }] },
      ],
    },
  }

  it('flattens Lexical to plain text', () => {
    expect(toPlainText(lexical)).toBe('About Help people every day.')
    expect(toPlainText('  plain   text ')).toBe('plain text')
    expect(toPlainText(null)).toBe('')
  })

  it('builds excerpts from the first paragraph', () => {
    expect(toExcerpt(lexical, 100)).toBe('Help people every day.')
    expect(toExcerpt('plain', 100)).toBe('plain')
  })

  it('truncates on a word boundary', () => {
    expect(toPlainText('one two three four five six', 14)).toBe('one two three…')
  })

  describe('HTML content', () => {
    const html = '\n<h2>Explore a Career as a Nurse</h2>\n\n<p>Nurses <strong>care</strong> for patients &amp; families.</p>\n<ul><li>Assess</li><li>Treat</li></ul>'

    it('parses allow-listed HTML into nodes', () => {
      expect(parseHtml(html)).toEqual([
        { type: 'heading', tag: 'h2', children: [{ type: 'text', text: 'Explore a Career as a Nurse', format: 0 }] },
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'Nurses ', format: 0 },
            { type: 'text', text: 'care', format: 1 },
            { type: 'text', text: ' for patients & families.', format: 0 },
          ],
        },
        {
          type: 'list',
          listType: 'bullet',
          children: [
            { type: 'listitem', children: [{ type: 'text', text: 'Assess', format: 0 }] },
            { type: 'listitem', children: [{ type: 'text', text: 'Treat', format: 0 }] },
          ],
        },
      ])
    })

    it('uses the first paragraph for excerpts and flattens to text', () => {
      expect(toExcerpt(html, 100)).toBe('Nurses care for patients & families.')
      expect(toPlainText(html)).toBe('Explore a Career as a Nurse Nurses care for patients & families. Assess Treat')
    })

    it('drops scripts, styles and attributes, and unwraps unknown tags', () => {
      const nodes = parseHtml('<div onclick="x()"><script>alert(1)</script><style>p{}</style><p class="a">Hi <span>there</span><img src=x onerror=alert(1)></p></div>')
      expect(nodes).toEqual([{ type: 'paragraph', children: [{ type: 'text', text: 'Hi ', format: 0 }, { type: 'text', text: 'there', format: 0 }] }])
      expect(JSON.stringify(nodes)).not.toMatch(/alert|onclick|onerror|class/)
    })

    it('keeps link hrefs for safeUrl to check later', () => {
      const [p] = parseHtml('<p><a href="javascript:alert(1)">bad</a> <a href=\'https://ok.example\' target="_blank">ok</a></p>')
      const links = p!.children!.filter((n) => n.type === 'link')
      expect(links.map((l) => safeUrl(l.fields?.url))).toEqual([undefined, 'https://ok.example'])
      expect(links[1]!.fields?.newTab).toBe(true)
    })

    it('treats tag-free strings as plain paragraphs', () => {
      expect(toNodes('One.\n\nTwo 1 < 2.')).toHaveLength(2)
    })
  })

  it('only allows safe URLs', () => {
    expect(safeUrl('https://example.com')).toBe('https://example.com')
    expect(safeUrl('/careers')).toBe('/careers')
    expect(safeUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeUrl('//evil.com')).toBeUndefined()
  })
})
