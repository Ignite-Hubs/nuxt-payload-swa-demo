import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions'
import { handleListCareers } from '../../../shared/careers/http'

export async function careers(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const { status, body, headers } = await handleListCareers(request.query, process.env, (message, error) =>
    context.error(message, error),
  )
  return { status, jsonBody: body, headers }
}

app.http('careers', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'careers',
  handler: careers,
})
