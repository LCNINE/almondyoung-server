import { revalidateTag } from "next/cache"
import { NextRequest, NextResponse } from "next/server"
import { cookies as nextCookies } from "next/headers"

export async function PUT(request: NextRequest) {
  const cookieStore = await nextCookies()
  const cookieHeader = cookieStore.toString()

  const profileData = await request.json()

  const res = await fetch(`${process.env.BACKEND_URL}/users/users/me`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
    body: JSON.stringify(profileData),
  })

  const data = await res.json()

  if (!res.ok) {
    return NextResponse.json(
      {
        success: false,
        error: data.message || "Failed to update profile",
      },
      { status: res.status }
    )
  }

  return NextResponse.json(data)
}
