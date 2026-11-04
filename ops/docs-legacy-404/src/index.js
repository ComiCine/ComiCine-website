const MAIN_404_URL = "https://comicine.com/404";

function isHtmlNavigation(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (
    request.headers.get("Sec-Fetch-Dest") === "document" ||
    request.headers.get("Sec-Fetch-Mode") === "navigate"
  ) {
    return true;
  }
  return (request.headers.get("Accept") || "")
    .split(",")
    .some((value) =>
      ["text/html", "application/xhtml+xml"].includes(
        value.trim().split(";", 1)[0].toLowerCase(),
      ),
    );
}

function notFoundResponse(request) {
  const htmlNavigation = isHtmlNavigation(request);
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": htmlNavigation
      ? "text/html; charset=utf-8"
      : "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  });

  if (!htmlNavigation) {
    return new Response(request.method === "HEAD" ? null : "Not Found\n", {
      status: 404,
      headers,
    });
  }

  headers.set("Refresh", `0; url=${MAIN_404_URL}`);
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta http-equiv="refresh" content="0; url=${MAIN_404_URL}"><title>Page not found</title></head><body><a href="${MAIN_404_URL}">Continue to ComiCine</a></body></html>`;
  return new Response(request.method === "HEAD" ? null : body, {
    status: 404,
    headers,
  });
}

export default {
  fetch(request) {
    return notFoundResponse(request);
  },
};
