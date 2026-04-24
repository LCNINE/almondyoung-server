export function providerLabel(providerType: string): string {
  if (providerType === "TOSS_BILLING") return "토스페이먼츠"
  if (providerType === "NICEPAY_BILLING") return "나이스페이"
  return "CMS"
}
