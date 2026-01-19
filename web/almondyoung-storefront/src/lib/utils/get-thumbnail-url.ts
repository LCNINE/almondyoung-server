/**
 * @description 썸네일 이미지 URL 가져오기
 * 만약 레일웨이를 안쓴다면 백엔드 fs 서버를 켜야함
 */
export const getThumbnailUrl = (thumbnail: string) => {
  if (!thumbnail) return ""

  if (thumbnail.startsWith("http://") || thumbnail.startsWith("https://")) {
    return thumbnail
  }

  const useRailway =
    process.env.NEXT_PUBLIC_USE_RAILWAY_BACKEND === "true" ||
    process.env.USE_RAILWAY_BACKEND === "true"
  const backendUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL

  if (useRailway && backendUrl) {
    return `${backendUrl}/fs/files/public/${thumbnail}`
  } else {
    return `http://localhost:3020/files/public/${thumbnail}`
  }
}
