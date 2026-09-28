"use server"

import { api } from "@lib/api/api"
import { CreateConsentsDto } from "@lib/types/dto/users"

export const createConsents = async (consents: CreateConsentsDto) => {
  const data = await api("users", "/consents", {
    method: "POST",
    body: consents,
    withAuth: true,
  })

  return data
}

export const getConsents = async () => {
  const data = await api<{ marketingConsent: boolean } | null>(
    "users",
    "/consents",
    {
      method: "GET",
      withAuth: true,
    }
  )

  return data
}

export const updateMarketingConsent = async (enabled: boolean) => {
  return api<{ marketingConsent: boolean; changedAt: string }>(
    "users",
    "/consents/marketing",
    {
      method: "PATCH",
      body: { enabled },
      withAuth: true,
    }
  )
}
