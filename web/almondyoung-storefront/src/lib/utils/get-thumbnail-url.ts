/**
 * @description 썸네일 이미지 URL 가져오기
 * 만약 레일웨이를 안쓴다면 백엔드 fs 서버를 켜야함
 */
export const getThumbnailUrl = (thumbnail: string) => {
  if (process.env.USE_RAILWAY_BACKEND === "true") {
    return `${process.env.BACKEND_URL}/fs/files/public/${thumbnail}`
  } else {
    return `http://localhost:3020/files/public/${thumbnail}`
  }
}
