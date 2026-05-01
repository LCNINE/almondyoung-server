import { getPinStatus } from "@/lib/api/wallet"
import { ApiAuthError, ApiNetworkError, HttpApiError } from "@/lib/api/api-error"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const data = await getPinStatus()
    return NextResponse.json({ data })
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json(
        { message: error.message ?? "UNAUTHORIZED" },
        { status: 401 }
      )
    }
    if (error instanceof ApiNetworkError) {
      return NextResponse.json(
        { message: error.message ?? "NETWORK_ERROR" },
        { status: 500 }
      )
    }
    if (error instanceof HttpApiError) {
      return NextResponse.json(
        { message: error.message ?? "REQUEST_FAILED" },
        { status: error.status }
      )
    }

    return NextResponse.json(
      { message: "PIN_STATUS_ERROR" },
      { status: 500 }
    )
  }
}
