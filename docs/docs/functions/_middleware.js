export async function onRequest({ request, next }) {
  const response = await next()
  if (response.status !== 404) return response

  const contentType = response.headers.get('Content-Type') ?? ''
  if (!contentType.toLowerCase().startsWith('text/html')) return response

  const headers = new Headers(response.headers)
  const refreshUrl = 'https://comicine.com/404'
  const refreshMeta = `<meta http-equiv="refresh" content="0;url=${refreshUrl}">`
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Robots-Tag', 'noindex, nofollow')
  headers.set('Refresh', `0; url=${refreshUrl}`)
  headers.delete('Content-Length')
  headers.delete('ETag')
  headers.delete('Last-Modified')

  let html = request.method === 'HEAD' ? '' : await response.text()
  if (request.method !== 'HEAD' && !/<meta\s+http-equiv=["']refresh["']/i.test(html)) {
    html = /<head\b[^>]*>/i.test(html)
      ? html.replace(/<head\b[^>]*>/i, match => `${match}${refreshMeta}`)
      : `${refreshMeta}${html}`
  }

  return new Response(request.method === 'HEAD' ? null : html, {
    status: 404,
    headers
  })
}
