"use server"

import { api, type ApiResponse } from "@lib/api/api"
import { ApiNetworkError, HttpApiError } from "@lib/api/api-error"

export type Cafe24MigrationKey = "email" | "name" | "birthday" | "phone"
export type Cafe24MigrationStatus = "synced" | "out_of_sync" | "missing"

export interface Cafe24LinkResult {
  linkId: string
  mallId: string | null
  cafe24MemberId: string | null
  linkedAt: string
}

export interface Cafe24MigrationItem {
  key: Cafe24MigrationKey
  status: Cafe24MigrationStatus
  cafe24Value: string | null
  userValue: string | null
}

export async function linkCafe24(cafe24_link_token: string) {
  return await api<Cafe24LinkResult>("users", "/cafe24/link", {
    method: "POST",
    body: { cafe24_link_token },
    withAuth: true,
  })
}

export async function getCafe24Migration(): Promise<
  ApiResponse<Cafe24MigrationItem[]>
> {
  try {
    const data = await api<{ items: Cafe24MigrationItem[] }>(
      "users",
      "/cafe24/migration",
      {
        method: "GET",
        withAuth: true,
        cache: "no-store",
      }
    )

    return { data: data.items ?? [] }
  } catch (error) {
    if (error instanceof HttpApiError) {
      return { error: { message: error.message, status: error.status } }
    }

    if (error instanceof ApiNetworkError) {
      return {
        error: { message: "네트워크 오류가 발생했습니다.", status: 500 },
      }
    }

    return {
      error: { message: "알 수 없는 오류가 발생했습니다.", status: 500 },
    }
  }
}

export async function getCafe24MigrationItem(
  key: Cafe24MigrationKey
): Promise<ApiResponse<Cafe24MigrationItem>> {
  try {
    const data = await api<Cafe24MigrationItem>(
      "users",
      `/cafe24/migration/${key}`,
      {
        method: "GET",
        withAuth: true,
        cache: "no-store",
      }
    )

    return { data }
  } catch (error) {
    if (error instanceof HttpApiError) {
      return { error: { message: error.message, status: error.status } }
    }

    if (error instanceof ApiNetworkError) {
      return {
        error: { message: "네트워크 오류가 발생했습니다.", status: 500 },
      }
    }

    return {
      error: { message: "알 수 없는 오류가 발생했습니다.", status: 500 },
    }
  }
}

export async function migrateCafe24Item(
  key: Cafe24MigrationKey
): Promise<ApiResponse<Cafe24MigrationItem>> {
  try {
    const data = await api<Cafe24MigrationItem>(
      "users",
      `/cafe24/migration/${key}`,
      {
        method: "POST",
        withAuth: true,
      }
    )

    return { data }
  } catch (error) {
    if (error instanceof HttpApiError) {
      return { error: { message: error.message, status: error.status } }
    }

    if (error instanceof ApiNetworkError) {
      return {
        error: { message: "네트워크 오류가 발생했습니다.", status: 500 },
      }
    }

    return {
      error: { message: "알 수 없는 오류가 발생했습니다.", status: 500 },
    }
  }
}
