const MAIN_404_URL = 'https://comicine.com/404'
const META_REFRESH = `<meta http-equiv="refresh" content="0;url=${MAIN_404_URL}">`

export async function onRequest({ request, next }) {
  const response = await next()
  if (response.status !== 404) return response

  const contentType = response.headers.get('Content-Type') ?? ''
  if (!contentType.toLowerCase().startsWith('text/html')) return response

  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Robots-Tag', 'noindex, nofollow')
  headers.set('Refresh', `0; url=${MAIN_404_URL}`)

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers
    })
  }

  const html = await response.text()
  const headClose = html.search(/<\/head\s*>/i)
  const body = headClose === -1
    ? `${META_REFRESH}${html}`
    : `${html.slice(0, headClose)}${META_REFRESH}${html.slice(headClose)}`
  headers.delete('Content-Encoding')
  headers.delete('Content-Length')

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}
