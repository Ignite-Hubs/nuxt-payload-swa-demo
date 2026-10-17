// Local equivalent of api/src/functions/career-by-slug.ts (see index.get.ts).
import { handleGetCareer } from '#careers/http'

export default defineEventHandler(async (event) => {
  const result = await handleGetCareer(getRouterParam(event, 'slug', { decode: true }), process.env)
  setResponseStatus(event, result.status)
  setResponseHeaders(event, result.headers)
  return result.body
})
