import { NextResponse } from "next/server"
import { getAllCategoriesCached } from "@lib/services/pim/category/getCategory"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const data = await getAllCategoriesCached()
  const res = NextResponse.json({ categories: data })
  // 브라우저 새로고침시 캐시 무효화
  res.headers.set("Cache-Control", "no-cache, no-store, must-revalidate")
  res.headers.set("Pragma", "no-cache")
  res.headers.set("Expires", "0")
  return res
}