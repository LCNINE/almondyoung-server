import { NextResponse } from "next/server"

// POST - 토큰 갱신 (현재는 쿠키 기반이므로 단순히 성공 응답)
export async function POST() {
  try {
    // 현재는 쿠키 기반 인증을 사용하므로 토큰 갱신이 필요 없음
    // 단순히 성공 응답을 반환하여 clientApi의 재시도 로직을 트리거
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("토큰 갱신 에러:", error)
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 })
  }
}
