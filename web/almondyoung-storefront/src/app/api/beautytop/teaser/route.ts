import { getSignedInMemberId } from "../../../../lib/beautytop/session"
import { getTeaserSummary, normalizeSearchArea, normalizeSearchTerm, parseShopId, searchTeaserShops } from "../../../../lib/beautytop/teaser"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const headers = { "Cache-Control": "private, no-store" }
const STATUS = { INVALID_QUERY: 400, NOT_CONFIGURED: 503, SOURCE_UNAVAILABLE: 503, BUSY: 503 } as const

// Signed-in visitors only: previews share one server-side quota at the source.
export async function GET(request: Request) {
  let member: string | null
  try {
    member = await getSignedInMemberId()
  } catch {
    return Response.json({ error: "LOGIN_SERVICE_UNAVAILABLE" }, { status: 503, headers })
  }
  if (!member) return Response.json({ error: "LOGIN_REQUIRED" }, { status: 401, headers })

  const url = new URL(request.url)
  const search = url.searchParams.get("search")
  const id = url.searchParams.get("id")
  if ((search === null) === (id === null)) return Response.json({ error: "INVALID_QUERY" }, { status: 400, headers })

  const result = search !== null
    ? await (async () => {
        const term = normalizeSearchTerm(search)
        const area = normalizeSearchArea(url.searchParams.get("sido"), url.searchParams.get("gugun"))
        return term && area ? searchTeaserShops(term, area) : ({ ok: false, error: "INVALID_QUERY" } as const)
      })()
    : await (async () => {
        const shopId = parseShopId(id)
        return shopId ? getTeaserSummary(shopId) : ({ ok: false, error: "INVALID_QUERY" } as const)
      })()

  if (!result.ok) return Response.json({ error: result.error }, { status: STATUS[result.error], headers })
  return Response.json({ data: result.data }, { headers })
}
