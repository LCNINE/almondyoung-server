export const getApiUrl = (path: string) => {
  // 서버 사이드인지 확인
  if (typeof window === "undefined") {
    // 서버 컴포넌트/서버 사이드
    return `${process.env.NEXT_PUBLIC_BACKEND_URL}${path}`
  }
  // 클라이언트 사이드
  return `/api${path}`
}
