/**
 * 인보이스(선적용) 정기결제 플래그 — 서버 MEMBERSHIP_INVOICE_BILLING_ENABLED 와 함께 켠다.
 * 켜지면 심사 중(PENDING) 계좌로도 가입 가능(즉시 적용, 승인 후 출금).
 */
export function isInvoiceBillingEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MEMBERSHIP_INVOICE_BILLING_ENABLED === "true"
}
