import { removedHomeResponse } from './_lib/removed-home.js'

export function onRequest(context) {
  return removedHomeResponse(context)
}
