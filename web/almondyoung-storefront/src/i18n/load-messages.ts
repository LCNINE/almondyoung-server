import type { AbstractIntlMessages } from "next-intl"

/**
 * 메시지 namespace 목록.
 *
 * 새 namespace 추가 시:
 *   1) `messages/ko/<namespace>.json` 파일 생성
 *   2) `messages/en/<namespace>.json` 파일 생성
 *   3) `messages/ja/<namespace>.json` 파일 생성
 *   4) 이 배열에 namespace 이름 추가
 *
 * 기존 namespace 안 키 추가/편집 시:
 *   - 해당 ko/en/ja JSON 3개만 같이 수정 (이 배열은 건드릴 필요 없음)
 *
 * 타입 자동완성 / 누락 키 검출은 VSCode i18n-ally 확장으로 처리합니다.
 */
export const MESSAGE_NAMESPACES = [
  "header",
  "account",
  "nav",
  "categorySheet",
  "home",
  "productDetail",
  "productCard",
  "cartSuccess",
  "search",
  "cs",
  "categories",
  "category",
  "cart",
  "checkout",
  "policies",
  "footer",
  "languageSwitcher",
  "mypage",
  "couponClaim",
  "business",
  "notice",
] as const

export type MessageNamespace = (typeof MESSAGE_NAMESPACES)[number]

export async function loadMessages(
  locale: string
): Promise<AbstractIntlMessages> {
  const entries = await Promise.all(
    MESSAGE_NAMESPACES.map(async (ns) => {
      const mod = await import(`./messages/${locale}/${ns}.json`)
      return [ns, mod.default] as const
    })
  )
  return Object.fromEntries(entries)
}
