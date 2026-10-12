import { isPublicResource, queryPublic } from "../../../../lib/beautytop/public-query"

export const runtime = "nodejs"

const STATUS = { INVALID_QUERY: 400, NOT_CONFIGURED: 503, SOURCE_UNAVAILABLE: 503, BUSY: 503 } as const

export async function GET(request: Request) {
  const url = new URL(request.url)
  const resource = url.searchParams.get("resource") ?? ""
  if (!isPublicResource(resource)) {
    return Response.json({ error: "INVALID_QUERY" }, { status: 400 })
  }
  const result = await queryPublic(resource, Object.fromEntries(url.searchParams))
  if (!result.ok) {
    const headers: Record<string, string> = { "Cache-Control": "no-store" }
    if (result.retryAfterMs !== undefined) headers["Retry-After"] = String(Math.ceil(result.retryAfterMs / 1000))
    return Response.json({ error: result.error }, { status: STATUS[result.error], headers })
  }
  return Response.json(
    { data: result.data },
    { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } }
  )
}
