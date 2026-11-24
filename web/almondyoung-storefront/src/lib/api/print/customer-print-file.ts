"use server"

import { api } from "../api"
import { HttpApiError } from "../api-error"

const CONTEXT_ID = "customer-print-file"

type Rejected = { error: string }

// 서버액션 경계를 넘으면 에러 문구가 가려져서 400·409 는 값으로 돌려준다
async function orRejected<T>(task: () => Promise<T>): Promise<T | Rejected> {
  try {
    return await task()
  } catch (error) {
    if (
      error instanceof HttpApiError &&
      (error.status === 400 || error.status === 409)
    ) {
      return { error: error.message }
    }

    throw error
  }
}

// 파일 본문은 서버액션(Lambda 6MB)을 지나지 않고 브라우저가 스토리지로 바로 올린다
export const presignCustomerPrintFile = async (file: {
  fileName: string
  size: number
  mimeType: string
}) =>
  orRejected(() =>
    api<{ fileId: string; uploadUrl: string; headers: Record<string, string> }>(
      "fs",
      `/files/upload/presign`,
      {
        method: "POST",
        body: { ...file, contextId: CONTEXT_ID, isPublic: false },
        withAuth: true,
      }
    )
  )

export const confirmCustomerPrintFile = async (fileId: string) =>
  orRejected(() =>
    api<unknown>("fs", `/files/upload/confirm`, {
      method: "POST",
      body: { fileId },
      withAuth: true,
    })
  )
