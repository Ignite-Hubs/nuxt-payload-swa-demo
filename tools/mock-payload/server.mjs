#!/usr/bin/env node
/**
 * Zero-dependency mock of the Payload CMS REST API for the `careers`
 * collection. Implements just enough of the query syntax used by the app:
 * limit, page, sort=<field>|-<field>, select[...], where[<field>][equals].
 *
 *   node tools/mock-payload/server.mjs            # http://localhost:3001
 *   PORT=4000 MOCK_PAYLOAD_API_KEY=secret node tools/mock-payload/server.mjs
 *
 * When MOCK_PAYLOAD_API_KEY is set, requests must send
 * "Authorization: users API-Key <key>".
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const PORT = Number(process.env.PORT) || 3001
const API_KEY = process.env.MOCK_PAYLOAD_API_KEY
const careers = JSON.parse(readFileSync(new URL('./careers.json', import.meta.url), 'utf8'))

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function project(doc, select) {
  if (!select.length) return doc
  return Object.fromEntries(Object.entries(doc).filter(([key]) => key === 'id' || select.includes(key)))
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  console.log(`${req.method} ${url.pathname}${url.search}`)

  if (req.method !== 'GET' || url.pathname !== '/api/careers') {
    return send(res, 404, { errors: [{ message: 'Not Found' }] })
  }
  if (API_KEY && req.headers.authorization !== `users API-Key ${API_KEY}`) {
    return send(res, 403, { errors: [{ message: 'You are not allowed to perform this action.' }] })
  }

  const q = url.searchParams
  const select = [...q.keys()].map((k) => /^select\[(\w+)\]$/.exec(k)?.[1]).filter(Boolean)

  let docs = careers
  for (const [key, value] of q) {
    const field = /^where\[(\w+)\]\[equals\]$/.exec(key)?.[1]
    // Query values are strings; compare as strings so `published=true` matches a boolean.
    if (field) docs = docs.filter((d) => String(d[field]) === value)
  }
  const sort = q.get('sort')
  if (sort) {
    const desc = sort.startsWith('-')
    const field = desc ? sort.slice(1) : sort
    docs = [...docs].sort((a, b) => String(a[field] ?? '').localeCompare(String(b[field] ?? '')) * (desc ? -1 : 1))
  }

  const limit = Number(q.get('limit')) || 10
  const page = Number(q.get('page')) || 1
  const totalDocs = docs.length
  const totalPages = Math.max(1, Math.ceil(totalDocs / limit))

  send(res, 200, {
    docs: docs.slice((page - 1) * limit, page * limit).map((d) => project(d, select)),
    totalDocs,
    limit,
    totalPages,
    page,
    pagingCounter: (page - 1) * limit + 1,
    hasPrevPage: page > 1,
    hasNextPage: page < totalPages,
    prevPage: page > 1 ? page - 1 : null,
    nextPage: page < totalPages ? page + 1 : null,
  })
})

server.listen(PORT, () => {
  console.log(`Mock Payload CMS listening on http://localhost:${PORT} (${careers.length} careers)`)
})
