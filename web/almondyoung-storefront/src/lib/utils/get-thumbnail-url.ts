import { getBackendBaseUrl } from "@/lib/config/backend"

export const getThumbnailUrl = (thumbnail: string) => {
  if (!thumbnail) return ""

  if (thumbnail.startsWith("blob:") || thumbnail.startsWith("data:")) {
    return thumbnail
  }

  const fileBase = getBackendBaseUrl("fs")

  if (thumbnail.startsWith("http://") || thumbnail.startsWith("https://")) {
    const fileIdMatch = thumbnail.match(/\/files\/(?:public\/)?([^/?#\s]+)$/)
    if (fileIdMatch && fileBase) {
      const fileId = fileIdMatch[1]
      return `${fileBase}/files/public/${fileId}`
    }
    return thumbnail
  }

  if (!fileBase) {
    throw new Error(
      "[get-thumbnail-url] file-service base URL이 설정되지 않았습니다. BACKEND_DOMAIN/NEXT_PUBLIC_BACKEND_DOMAIN 또는 로컬 설정을 확인하세요."
    )
  }

  return `${fileBase}/files/public/${thumbnail}`
}
