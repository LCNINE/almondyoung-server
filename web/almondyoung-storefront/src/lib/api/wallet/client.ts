"use client"

import type { PinStatus } from "@/lib/api/wallet"
import { HttpApiError } from "@/lib/api/api-error"

const unwrapData = <T>(payload: any): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data as T
  }
  return payload as T
}

export async function getPinStatusClient(): Promise<PinStatus> {
  const res = await fetch("/api/wallet/pin/status", {
    method: "GET",
    credentials: "include",
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new HttpApiError(
      error.message || "PIN 상태 조회 실패",
      res.status,
      res.statusText,
      error
    )
  }

  const payload = await res.json()
  return unwrapData<PinStatus>(payload)
}
