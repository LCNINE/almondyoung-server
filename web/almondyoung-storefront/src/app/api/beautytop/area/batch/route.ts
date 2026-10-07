import { decodeBatchItem } from "../../../../../lib/beautytop/batch-item"
import { MAX_BATCH, queryPublicBatch } from "../../../../../lib/beautytop/public-query"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const items = new URL(request.url).searchParams.getAll("q")
  if (items.length === 0 || items.length > MAX_BATCH) {
    return Response.json({ error: "INVALID_QUERY" }, { status: 400 })
  }
  // An item that does not decode is answered as INVALID_QUERY, like any unknown resource.
  const results = await queryPublicBatch(items.map((q) => decodeBatchItem(q) ?? ""))
  // Only a fully answered batch may be shared by the CDN; a BUSY item must be asked again.
  const complete = results.every((r) => r.ok)
  return Response.json(
    {
      results: results.map((r) =>
        r.ok
          ? { data: r.data }
          : r.retryAfterMs !== undefined
            ? { error: r.error, retryAfter: Math.ceil(r.retryAfterMs / 1000) }
            : { error: r.error }
      ),
    },
    { headers: { "Cache-Control": complete ? "public, max-age=300, stale-while-revalidate=3600" : "no-store" } }
  )
}
