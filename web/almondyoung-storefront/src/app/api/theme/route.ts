import { NextRequest, NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({
    themes: [
      { id: "light", name: "라이트", description: "기본 라이트 테마" },
      {
        id: "black-friday",
        name: "블랙프라이데이",
        description: "블랙프라이데이 특별 테마",
      },
      { id: "valentine", name: "발렌타인", description: "발렌타인 특별 테마" },
      {
        id: "christmas",
        name: "크리스마스",
        description: "크리스마스 특별 테마",
      },
    ],
  })
}

export async function POST(request: NextRequest) {
  try {
    const { theme } = await request.json()

    const validThemes = ["light", "black-friday", "valentine", "christmas"]

    if (!theme || !validThemes.includes(theme)) {
      return NextResponse.json(
        { error: "유효하지 않은 테마입니다." },
        { status: 400 }
      )
    }

    // 여기서는 클라이언트에서 처리하도록 안내
    return NextResponse.json({
      success: true,
      message: "테마가 변경되었습니다.",
      theme,
    })
  } catch (error) {
    return NextResponse.json(
      { error: "테마 변경 중 오류가 발생했습니다." },
      { status: 500 }
    )
  }
}
