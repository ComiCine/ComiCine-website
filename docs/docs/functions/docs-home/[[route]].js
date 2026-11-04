import { removedHomeResponse } from '../_lib/removed-home.js'

export function onRequest() {
  return removedHomeResponse()
}
