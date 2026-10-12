import { pageWindowItems } from "@packages/domain-types/time-sale"
export { pageWindowItems } from "@packages/domain-types/time-sale"
import type {
  SaleLayout,
  SalePlatform,
  TimeSaleSettings,
} from "@packages/domain-types/time-sale"

// 원본 "상품 페이지 설정 > 페이지 윈도우" 기본값(5개).
export const DEFAULT_PAGE_WINDOW = 5

// 페이지 번호 하나(href 가 있으면 링크) 또는 말줄임.
export type PagerItem = {
  label: string
  href?: string
  current?: boolean
}

// 상품 목록(그리드/캐러셀) 컴포넌트의 한 화면 개수(열 x 행). 없으면 null.
export function listSizeOf(layout: SaleLayout): number | null {
  const list = layout.components.find(
    (component) => component.type === "grid" || component.type === "carousel"
  )
  if (!list) return null

  return list.options.columns * list.options.rows
}

// 더보기 한 페이지의 상품 수(열×행). 서버는 기기를 모르므로 PC 기준으로 나눈다.
export function morePageSize(
  settings: TimeSaleSettings,
  platform: SalePlatform = "pc"
): number | null {
  return listSizeOf(settings.styles.more[platform])
}

export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size))
}

// ?page 원문을 1..pages 범위의 정수로 만든다(이상한 값은 1 페이지).
export function parsePage(raw: string | undefined, pages: number): number {
  // 정수 문자열만 받는다('2abc', '2.5', '2e3' 은 1 페이지).
  if (!raw || !/^\d+$/.test(raw)) return 1

  const page = Number.parseInt(raw, 10)
  if (page < 1) return 1

  return Math.min(page, pages)
}

// 1 페이지부터 세는 page 에 해당하는 id 조각.
export function pageIds(ids: string[], page: number, size: number): string[] {
  return ids.slice((page - 1) * size, page * size)
}

// 앞에서부터 size 개씩 자른다(/store/products 한 번에 받을 개수 제한용).
export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }

  return chunks
}

// 원본 모양: 1 … 3 4 [5] 6 7 … 9. 현재 페이지 둘레 window 개 + 처음·끝, 사이는 말줄임.
// 렌더러에 넘길 페이지 링크 목록.
export function buildPager(
  page: number,
  pages: number,
  hrefFor: (page: number) => string,
  window = DEFAULT_PAGE_WINDOW
): PagerItem[] {
  return pageWindowItems(page, pages, window).map((item) =>
    item === "gap"
      ? { label: "…" }
      : { label: String(item), href: hrefFor(item), current: item === page }
  )
}
