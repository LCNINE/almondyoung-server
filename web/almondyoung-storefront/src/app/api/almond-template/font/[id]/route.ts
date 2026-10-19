import { requireBackendBaseUrl } from "@/lib/config/backend"
import { FILE_IMAGE_REF } from "@/domains/almond-template/lib/image-ref"

// file-service 는 CORS 를 내주지 않고 S3 로 302 만 한다. FontFace 는 CORS 로 읽으므로 같은 출처에서
// S3 주소(GET 은 모든 출처 허용)로 넘긴다. 본문(최대 50MB)은 Lambda 를 지나지 않는다
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!FILE_IMAGE_REF.test(`file:${id}`))
    return new Response(null, { status: 404 })

  const upstream = await fetch(
    `${requireBackendBaseUrl("fs")}/files/public/${id}`,
    { redirect: "manual", next: { revalidate: 86400 } }
  )
  const location = upstream.headers.get("location")
  if (upstream.status < 300 || upstream.status >= 400 || !location)
    return new Response(null, { status: 404 })

  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": "public, max-age=86400",
    },
  })
}
