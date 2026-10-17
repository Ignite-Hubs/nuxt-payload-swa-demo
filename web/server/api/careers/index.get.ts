// Local equivalent of api/src/functions/careers.ts. Used by `nuxt dev` and while
// prerendering; it is not deployed (Azure Functions serves /api in production).
import { handleListCareers } from '#careers/http'

export default defineEventHandler(async (event) => {
  const result = await handleListCareers(getRequestURL(event).searchParams, process.env)
  setResponseStatus(event, result.status)
  setResponseHeaders(event, result.headers)
  return result.body
})
