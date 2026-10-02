import { requireBackendBaseUrl } from "@/lib/config/backend"
import { FILE_IMAGE_REF } from "@/domains/almond-template/lib/image-ref"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!FILE_IMAGE_REF.test(`file:${id}`))
    return new Response(null, { status: 404 })

  const upstream = await fetch(
    `${requireBackendBaseUrl("fs")}/files/public/${id}`,
    { next: { revalidate: 86400 } }
  )

  const type = upstream.headers.get("content-type") ?? ""

  if (!upstream.ok || !type.startsWith("image/"))
    return new Response(null, { status: 404 })

  return new Response(upstream.body, {
    headers: {
      "content-type": type,
      "cache-control": "public, max-age=86400, immutable",
      "x-content-type-options": "nosniff",
    },
  })
}
