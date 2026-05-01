import { NextRequest, NextResponse } from "next/server"

/**
 * APick 계좌 조회 API
 * TODO: 추후 백엔드의 wallet service로 이관
 */
export async function POST(req: NextRequest) {
  const { bankCode, accountNumber } = await req.json()

  const response = await fetch("https://apick.app/rest/account_realname", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      CL_AUTH_KEY: process.env.APICK_CL_AUTH_KEY!,
    },
    body: JSON.stringify({ bank_code: bankCode, account_num: accountNumber }),
  })

  const responseData = await response.json()

  if (!response.ok) {
    return NextResponse.json(
      { success: false, error: responseData.data.error },
      { status: response.status }
    )
  }

  return NextResponse.json(responseData)
}
