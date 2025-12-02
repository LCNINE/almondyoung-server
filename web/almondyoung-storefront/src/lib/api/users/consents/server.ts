"use server"

import { getAccessToken, getCookies } from "@lib/data/cookies"

export const getConsents = async () => {
  const cookies = await getCookies()
  const accessToken = await getAccessToken()

  if (!accessToken) {
    return {}
  }

  const response = await fetch(`${process.env.APP_URL}/api/users/consents`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookies,
    },
  })

  if (!response.ok) {
    const errorData = await response.json()

    throw new Error(
      errorData.error || `Failed to get consents: ${response.status}`
    )
  }

  const data = await response.json()

  return data.data
}
