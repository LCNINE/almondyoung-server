export async function ensureCustomOrderAgreement({
  needsAgreement,
  agreed,
  saveAgreement,
}: {
  needsAgreement: boolean
  agreed: boolean
  saveAgreement: () => Promise<unknown>
}): Promise<boolean> {
  if (!needsAgreement) return true
  if (!agreed) return false
  try {
    await saveAgreement()
    return true
  } catch (error) {
    console.error("주문제작 동의 저장 실패:", error)
    return false
  }
}
