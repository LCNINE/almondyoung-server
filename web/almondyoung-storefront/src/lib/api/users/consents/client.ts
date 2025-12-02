import { HttpApiError } from "@lib/api/api-error"
import { CreateConsentsDto } from "./types"

export const createConsents = async (consents: CreateConsentsDto) => {
  const response = await fetch("/api/users/consents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(consents),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new HttpApiError(
      data.error || "Failed to create consents",
      response.status,
      response.statusText,
      data
    )
  }

  return data
}
