export async function removedHomeResponse(context) {
  const assetUrl = new URL('/404.html', context.request.url)
  let page = null
  try {
    if (context.env.ASSETS) page = await context.env.ASSETS.fetch(assetUrl)
  } catch {
    page = null
  }
  const headers = new Headers(page?.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Robots-Tag', 'noindex, nofollow')
  headers.set('Content-Type', page?.headers.get('Content-Type') ?? 'text/html; charset=utf-8')
  const body = page?.ok
    ? page.body
    : '<!doctype html><html lang="en"><meta charset="utf-8"><title>404</title><body><main><h1>404</h1><p>Page not found</p><a href="https://comicine.com/">ComiCine</a></main></body></html>'

  return new Response(context.request.method === 'HEAD' ? null : body, {
    status: 404,
    headers
  })
}
