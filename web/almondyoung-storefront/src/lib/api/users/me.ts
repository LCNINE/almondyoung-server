"use server"

import { getCookies } from "@lib/data/cookies"
import { UserDetail } from "domains/auth/types"
import { cache } from "react"

export const fetchMe = cache(async (): Promise<UserDetail> => {
  const cookieString = await getCookies()

  const response = await fetch(`${process.env.APP_URL}/api/users/detail`, {
    cache: "no-store",
    headers: {
      Cookie: cookieString,
    },
  })

  console.log("response::::::::", response)

  // 라우트 핸들러에서 401 에러를 반환하면 error.tsx로 전파
  if (!response.ok) {
    const errorData = await response.json()
    console.log("errorData::::::::", errorData)
    throw new Error(errorData.error || `Failed to fetch me: ${response.status}`)
  }

  const data = await response.json()
  console.log("data::::::::", data)
  return data.data
})
