"use server"

import { submitRefundRequest } from "@/lib/api/wallet"

/**
 * 무통장(가상계좌) 환불 요청 제출 (고객). 실제 환불은 관리자 승인 시 실행된다.
 * 인증 필요 mutation 이므로 Server Action 으로 감싼다 (401 은 error.tsx 로 전파).
 */
export async function requestRefundAction(input: {
  intentId: string
  bankCode: string
  bankName?: string
  accountNumber: string
  holderName: string
  reason?: string
}): Promise<{ id: string; status: string }> {
  return submitRefundRequest(input)
}
