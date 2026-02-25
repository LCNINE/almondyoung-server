/**
 * 이름 마스킹 처리 (한글 이름 기준)
 * - 2글자: 첫 글자 + * (예: 홍길 → 홍*)
 * - 3글자: 첫 글자 + ** (예: 홍길동 → 홍**)
 * - 4글자 이상: 첫 글자 + *** + 마지막 글자 (예: 남궁민수 → 남***수)
 */
export function maskName(name: string): string {
  const len = name.length
  if (len <= 1) return name
  if (len === 2) return name[0] + "*"
  if (len === 3) return name[0] + "**"
  return name[0] + "***" + name[len - 1]
}

/**
 * 리뷰 작성자명 표시
 * 1. legacyAuthorName이 있으면 마스킹 여부 확인 후 표시
 * 2. userId가 있으면 마스킹해서 표시
 * 3. 둘 다 없으면 "구매자"
 */
export function getAuthorName(
  legacyAuthorName: string | null,
  userId: string | null
): string {
  // 레거시 작성자명 처리
  if (legacyAuthorName) {
    // 이미 마스킹된 경우 (*가 포함됨) 그대로 반환
    if (legacyAuthorName.includes("*")) return legacyAuthorName
    // 마스킹되지 않은 실명인 경우 마스킹 처리
    return maskName(legacyAuthorName)
  }

  // userId가 있으면 마스킹
  if (userId) {
    const len = userId.length
    if (len <= 4) return userId[0] + "***"
    const visibleStart = userId.slice(0, 2)
    const visibleEnd = userId.slice(-2)
    return `${visibleStart}***${visibleEnd}`
  }

  return "구매자"
}
