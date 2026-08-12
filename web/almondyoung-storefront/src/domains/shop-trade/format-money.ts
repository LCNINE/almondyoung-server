/** 원 단위 금액을 "3,000만" / "1억 2,000만" 으로 줄여 쓴다 */
export function formatKoreanMoney(won: number | null | undefined): string | null {
  if (won === null || won === undefined || !Number.isFinite(won)) return null

  const manwon = Math.round(won / 10_000)

  if (manwon < 10_000) {
    return `${manwon.toLocaleString("ko-KR")}만`
  }

  const eok = Math.floor(manwon / 10_000)
  const rest = manwon % 10_000

  return rest === 0
    ? `${eok}억`
    : `${eok}억 ${rest.toLocaleString("ko-KR")}만`
}
