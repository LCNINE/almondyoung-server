"use server"

import { api } from "@lib/api/api"

export interface Cafe24SignupBootstrapPrefill {
  email: string | null
  username: string | null
  birthday: string | null
  phoneNumber: string | null
}

export interface Cafe24SignupBootstrapApiData {
  memberId: string | null
  memberName: string | null
  prefillAvailable: boolean
  prefill: Cafe24SignupBootstrapPrefill
}

export interface Cafe24SignupBootstrapData extends Cafe24SignupBootstrapApiData {
  encryptedIdToken: string
}

interface Cafe24SignupBootstrapRequest {
  encryptedIdToken: string
}

export async function bootstrapCafe24Signup(
  payload: Cafe24SignupBootstrapRequest
): Promise<Cafe24SignupBootstrapApiData> {
  return api<Cafe24SignupBootstrapApiData>(
    "users",
    "/auth/signup/cafe24/bootstrap",
    {
      method: "POST",
      body: payload,
      withAuth: false,
      cache: "no-store",
    }
  )
}
