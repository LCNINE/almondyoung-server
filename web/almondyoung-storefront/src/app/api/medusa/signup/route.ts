import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const { email, first_name, last_name, almond_user_id, almond_login_id } =
    await request.json()

  const res = await fetch(
    `${process.env.BACKEND_URL}/medusa/auth/customer/my-auth/register`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: email,
        first_name: first_name,
        last_name: last_name,
        almond_user_id: almond_user_id,
        almond_login_id: almond_login_id,
      }),
    }
  )

  if (!res.ok) {
    const result = await res.json()
    return NextResponse.json(
      {
        success: false,
        error: result.error,
        message: result.message || "Medusa signup failed",
      },
      { status: res.status }
    )
  }

  const result = await res.json()

  return NextResponse.json({
    success: true,
    data: result,
  })
}
