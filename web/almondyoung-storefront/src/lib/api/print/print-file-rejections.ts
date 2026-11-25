"use server"

import type { PrintFileRejectionDto } from "@/lib/types/dto/print-orders"
import type { PrintFileRejection } from "@/lib/types/ui/print-orders"
import { api } from "../api"
import { HttpApiError } from "../api-error"

export const listPrintFileRejections = async (): Promise<
  PrintFileRejection[]
> =>
  api<PrintFileRejectionDto[]>("wms", "/store/print-orders/file-rejections", {
    method: "GET",
    withAuth: true,
  })

// 400(남의·형식이 틀린 파일)·409(이미 다시 올림)·503(인쇄소 전달 실패)은 서버액션 경계에서 문구가 가려지므로 값으로 돌려준다
export const reuploadPrintFile = async (
  salesOrderLineId: string,
  fileId: string
): Promise<{ ok: true } | { error: string }> => {
  try {
    await api(
      "wms",
      `/store/print-orders/${encodeURIComponent(salesOrderLineId)}/file`,
      {
        method: "POST",
        body: { fileId },
        withAuth: true,
      }
    )

    return { ok: true }
  } catch (error) {
    if (
      error instanceof HttpApiError &&
      [400, 409, 503].includes(error.status)
    ) {
      return { error: error.message }
    }

    throw error
  }
}
