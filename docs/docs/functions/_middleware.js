export async function onRequest({ request, next }) {
  const response = await next()
  if (response.status !== 404) return response

  const contentType = response.headers.get('Content-Type') ?? ''
  if (!contentType.toLowerCase().startsWith('text/html')) return response

  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Robots-Tag', 'noindex, nofollow')
  headers.delete('Refresh')

  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}
