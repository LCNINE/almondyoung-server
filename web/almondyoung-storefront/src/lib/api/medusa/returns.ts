"use server"

import { api } from "@lib/api/api"
import {
  ApiAuthError,
  ApiNetworkError,
  HttpApiError,
} from "@lib/api/api-error"
import type {
  StoreReturnErrorDto,
  StoreReturnListResponseDto,
  StoreReturnRequestResponseDto,
  StoreReturnableResponseDto,
} from "@lib/types/dto/returns"
import type {
  CustomerReturn,
  ReturnRequestInput,
  ReturnableLine,
} from "@lib/types/ui/returns"
import {
  cancelOutcomeFromError,
  requestOutcomeFromError,
  requestOutcomeFromResponse,
  toCustomerReturns,
  toReturnRequestBody,
  toReturnableLines,
  type ReturnCancelOutcome,
  type ReturnRequestOutcome,
} from "./return-outcome"

const base = (orderId: string) =>
  `/store/orders/${encodeURIComponent(orderId)}/returns`

/** ApiNetworkError(상태 500 을 흉내냄)·그 밖 비HTTP 오류는 상태 null. */
function statusOf(error: unknown): number | null {
  if (error instanceof ApiNetworkError) return null
  if (error instanceof HttpApiError) return error.status
  return null
}

function dataOf(error: unknown): StoreReturnErrorDto | undefined {
  return error instanceof HttpApiError ? error.data : undefined
}

/** 404(없는·남의 주문) → null. 그 밖의 실패는 던진다(화면이 재시도 상태를 보인다). */
export async function getReturnable(
  orderId: string
): Promise<ReturnableLine[] | null> {
  try {
    const dto = await api<StoreReturnableResponseDto>(
      "medusa",
      `${base(orderId)}/returnable`,
      { method: "GET", withAuth: true }
    )
    return toReturnableLines(dto)
  } catch (error) {
    if (error instanceof ApiAuthError) throw error
    if (statusOf(error) === 404) return null
    throw error
  }
}

/** 인증 외 모든 실패 → null (주문 상세는 반품 칸만 빼고 뜬다). */
export async function getOrderReturns(
  orderId: string
): Promise<CustomerReturn[] | null> {
  try {
    const dto = await api<StoreReturnListResponseDto>("medusa", base(orderId), {
      method: "GET",
      withAuth: true,
    })
    return toCustomerReturns(dto)
  } catch (error) {
    if (error instanceof ApiAuthError) throw error
    return null
  }
}

export async function requestReturn(
  orderId: string,
  input: ReturnRequestInput
): Promise<ReturnRequestOutcome> {
  try {
    const res = await api<StoreReturnRequestResponseDto>(
      "medusa",
      base(orderId),
      { method: "POST", body: toReturnRequestBody(input), withAuth: true }
    )
    return requestOutcomeFromResponse(res)
  } catch (error) {
    if (error instanceof ApiAuthError) throw error
    return requestOutcomeFromError(statusOf(error), dataOf(error))
  }
}

export async function cancelReturn(
  orderId: string,
  returnId: string
): Promise<ReturnCancelOutcome> {
  try {
    await api<{ return_id: string; status: string }>(
      "medusa",
      `${base(orderId)}/${encodeURIComponent(returnId)}/cancel`,
      { method: "POST", withAuth: true }
    )
    return { kind: "canceled" }
  } catch (error) {
    if (error instanceof ApiAuthError) throw error
    return cancelOutcomeFromError(statusOf(error), dataOf(error))
  }
}
