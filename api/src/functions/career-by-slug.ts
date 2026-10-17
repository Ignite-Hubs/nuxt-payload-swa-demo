import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions'
import { handleGetCareer } from '../../../shared/careers/http'

export async function careerBySlug(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const { status, body, headers } = await handleGetCareer(request.params.slug, process.env, (message, error) =>
    context.error(message, error),
  )
  return { status, jsonBody: body, headers }
}

app.http('career-by-slug', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'careers/{slug}',
  handler: careerBySlug,
})
