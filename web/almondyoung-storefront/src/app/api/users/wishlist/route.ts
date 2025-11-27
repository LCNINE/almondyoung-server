import { routeHandler } from "@lib/api/api-route-handler"
import { getAccessToken } from "@lib/data/cookies"
import { NextRequest, NextResponse } from "next/server"

export const GET = routeHandler(async (request: NextRequest) => {
  const cookies = request.cookies.toString()

  const res = await fetch(`${process.env.BACKEND_URL}/users/wishlist`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookies,
    },
  })

  const data = await res.json()

  if (!res.ok) {
    return NextResponse.json(
      {
        success: false,
        error: data.message || "Failed to get wishlist",
      },
      { status: res.status }
    )
  }

  return NextResponse.json(data)
})

export const POST = routeHandler(async (request: NextRequest) => {
  const { productId } = await request.json()

  const cookies = request.cookies.toString()

  const res = await fetch(`${process.env.BACKEND_URL}/users/wishlist`, {
    method: "POST",
    body: JSON.stringify({ productId }),
    headers: {
      "Content-Type": "application/json",
      Cookie: cookies,
    },
  })

  const data = await res.json()

  if (!res.ok) {
    return NextResponse.json(
      {
        success: false,
        error: data.message || "Failed to add product to wishlist",
      },
      { status: res.status }
    )
  }

  return NextResponse.json(data)
})
