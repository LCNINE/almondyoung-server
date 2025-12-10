import {
  BusinessInfoResponseDto,
  UserDetailsResponseDto,
} from "@lib/types/dto/users"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  const cookieHeader = cookieStore.toString()

  const meRes = await fetch(`${process.env.BACKEND_URL}/users/users/detail`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
  })

  if (!meRes.ok) {
    return NextResponse.json(
      { error: "Failed to fetch me information" },
      { status: meRes.status }
    )
  }

  const meData: UserDetailsResponseDto = await meRes.json()

  const businessRes = await fetch(
    `${process.env.BACKEND_URL}/users/business-licenses/me`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
    }
  )

  if (!businessRes.ok) {
    return NextResponse.json(
      { error: "Failed to fetch business information" },
      { status: businessRes.status }
    )
  }

  const businessData: BusinessInfoResponseDto = await businessRes.json()

  const verificationStatus = {
    birthDate: meData.data.profile?.birthDate ? "verified" : "none",
    phone: meData.data.profile?.phoneNumber ? "verified" : "none",
    business: {
      status:
        businessData.data.status === "approved"
          ? "verified"
          : businessData.data.status === "rejected"
            ? "rejected"
            : businessData.data.status === "under_review"
              ? "under_review"
              : "none",
      rejectionReason: businessData.data.reviewComment ?? null,
    },
    // todo : account 상태 추가
  }

  return NextResponse.json(verificationStatus)
}
