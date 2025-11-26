import { NextRequest, NextResponse } from 'next/server'

const PIM_BASE_URL = process.env.PIM_SERVICE_URL || process.env.BACKEND_URL || 'http://localhost:3020'

/**
 * 카테고리 경로 조회
 * GET /api/pim/categories/[id]/path
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    const response = await fetch(`${PIM_BASE_URL}/categories/${id}/path`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        { message: data.message || '카테고리 경로 조회에 실패했습니다.' },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('[PIM Category Path API] Error:', error)
    return NextResponse.json(
      { message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

