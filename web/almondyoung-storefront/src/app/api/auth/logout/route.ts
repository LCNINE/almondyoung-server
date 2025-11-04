import { NextResponse } from "next/server"
import { removeAuthToken } from "@lib/data/cookies"

export async function POST() {
  const res = NextResponse.json({ ok: true })
  removeAuthToken(res)
  return res
}
