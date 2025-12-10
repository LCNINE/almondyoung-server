import { routeHandler } from "@lib/api/api-route-handler"
import { cookies as nextCookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"

export const GET = routeHandler(async (request: NextRequest) => {
  const cookieStore = await nextCookies()
  const cookieHeader = cookieStore.toString()

  const res = await fetch(`${process.env.BACKEND_URL!}/users/users/detail`, {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
  })

  const data = await res.json()

  if (!res.ok) {
    // routeHandler의 catch 블록으로 전달하기 위해 에러를 throw
    // statusCode를 포함한 에러 객체를 던지면 routeHandler가 처리
    throw {
      statusCode: res.status,
      message: data.message || "Failed to fetch user detail",
    }
  }

  return NextResponse.json(data)
})
