import { isRailwayBackend } from "@/lib/config/backend"

// 일단은
const FILE_SERVER_URL = "https://file.almondyoung-next.com"

export const getThumbnailUrl = (thumbnail: string) => {
  if (!thumbnail) return ""

  if (thumbnail.startsWith("http://") || thumbnail.startsWith("https://")) {
    const fileIdMatch = thumbnail.match(
      /\/files\/(?:public\/)?([a-f0-9-]{36})$/i
    )
    if (fileIdMatch) {
      const fileId = fileIdMatch[1]
      return `${FILE_SERVER_URL}/files/public/${fileId}`
    }
    return thumbnail
  }

  const useRailway = isRailwayBackend()

  if (useRailway) {
    return `${FILE_SERVER_URL}/files/public/${thumbnail}`
  }

  return `http://localhost:3020/files/public/${thumbnail}`
}
