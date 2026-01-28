/**
 * @description 썸네일 이미지 URL 가져오기
 * 만약 레일웨이를 안쓴다면 백엔드 fs 서버를 켜야함
 *
 * 참고: 채널 어댑터에서 Medusa에 동기화할 때 thumbnail URL이
 * `{FILE_SERVICE_URL}/files/{fileId}` 형태로 저장되지만,
 * 실제 공개 파일 엔드포인트는 `/files/public/{fileId}`입니다.
 * 이 함수에서 해당 패턴을 감지하여 올바른 경로로 변환합니다.
 */
import { getBackendBaseUrl, isRailwayBackend } from "@/lib/config/backend"

export const getThumbnailUrl = (thumbnail: string) => {
  if (!thumbnail) return ""

  // 이미 전체 URL인 경우
  if (thumbnail.startsWith("http://") || thumbnail.startsWith("https://")) {
    // /files/{fileId} 패턴을 /files/public/{fileId}로 변환
    // (채널 어댑터에서 잘못된 경로로 저장된 경우 보정)
    const corrected = thumbnail.replace(
      /\/files\/([a-f0-9-]{36})$/i,
      "/files/public/$1"
    )
    return corrected
  }

  const useRailway = isRailwayBackend()
  const fileBaseUrl = getBackendBaseUrl("fs")

  if (useRailway && fileBaseUrl) {
    return `${fileBaseUrl}/files/public/${thumbnail}`
  }

  return `http://localhost:3020/files/public/${thumbnail}`
}
