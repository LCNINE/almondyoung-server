// A batch item is itself a query string ("resource=market&sido=..."). Nested inside the
// outer query it gets decoded once on the way to the server function, and its "&" then
// splits the filters out of the item. base64url has no characters any hop decodes.

const MAX_ENCODED_LENGTH = 1000

export function encodeBatchItem(item: string): string {
  const bytes = new TextEncoder().encode(item)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function decodeBatchItem(value: string): string | null {
  if (!value || value.length > MAX_ENCODED_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}
