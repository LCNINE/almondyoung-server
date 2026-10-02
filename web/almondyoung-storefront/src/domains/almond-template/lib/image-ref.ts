import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"

export const ALMOND_TEMPLATE_IMAGE_CONTEXT_ID = "almond-template-image"
export const FILE_IMAGE_REF =
  /^file:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

export const fileImageRef = (fileId: string) => `file:${fileId}`

export const imageFileId = (value: string | undefined) =>
  value?.match(FILE_IMAGE_REF)?.[1]

export function imageSrc(value: string) {
  const fileId = imageFileId(value)
  return fileId ? getThumbnailUrl(fileId) : value
}

export async function imageBlob(value: string) {
  const fileId = imageFileId(value)
  const response = await fetch(
    fileId ? `/api/almond-template/image/${fileId}` : value
  )
  if (!response.ok) throw new Error("이미지를 불러오지 못했습니다.")
  return response.blob()
}
