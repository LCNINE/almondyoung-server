import { NextRequest, NextResponse } from "next/server"

type RouteHandlerFunction<T = any> = (
  request: NextRequest,
  context: { params: Promise<any> }
) => Promise<T>

export function routeHandler(handler: RouteHandlerFunction) {
  return async (request: NextRequest, context: { params: Promise<any> }) => {
    try {
      return await handler(request, context)
    } catch (error) {
      console.error("Route handler error:", error)

      if (error && typeof error === "object" && "statusCode" in error) {
        const statusCode = (error as any).statusCode

        // error.tsx에서 처리
        if (statusCode === 401) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        return NextResponse.json(
          { error: (error as any).message || "Request failed" },
          { status: statusCode }
        )
      }

      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      )
    }
  }
}
