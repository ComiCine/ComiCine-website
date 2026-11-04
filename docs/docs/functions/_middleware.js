const MAIN_404_URL = 'https://comicine.com/404'

function isHtmlNavigation(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  if (new URL(request.url).pathname.startsWith('/api/')) return false
  if (
    request.headers.get('Sec-Fetch-Dest') === 'document' ||
    request.headers.get('Sec-Fetch-Mode') === 'navigate'
  ) {
    return true
  }
  return (request.headers.get('Accept') ?? '')
    .split(',')
    .some((value) => value.trim().split(';', 1)[0].toLowerCase() === 'text/html')
}

function notFoundNavigationResponse(request, response) {
  const headers = new Headers(response.headers)
  headers.delete('Location')
  headers.set('Cache-Control', 'no-store')
  headers.set('Content-Type', 'text/html; charset=utf-8')
  headers.set('Refresh', `0; url=${MAIN_404_URL}`)
  headers.set('X-Robots-Tag', 'noindex, nofollow')
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta http-equiv="refresh" content="0; url=${MAIN_404_URL}"><title>Page not found</title></head><body><a href="${MAIN_404_URL}">Continue to ComiCine</a></body></html>`

  return new Response(request.method === 'HEAD' ? null : body, {
    status: 404,
    headers
  })
}

export async function onRequest(context) {
  const response = await context.next()
  if (response.status !== 404 || !isHtmlNavigation(context.request)) return response
  return notFoundNavigationResponse(context.request, response)
}
