import { useQueryParams } from "@/hooks/use-query-params"
import type {
  KeywordType,
  MatchingStatusFilter,
  OrderLineQuery,
} from "@/lib/types/matching"

const STATUSES: MatchingStatusFilter[] = [
  "pending",
  "matched",
  "ignored",
  "unregistered",
]

const KEYWORD_TYPES: KeywordType[] = [
  "productName",
  "orderNumber",
  "customerName",
]

type Props = { prefix?: string; pageSize?: number }

export function useOrderLineTableQuery({ prefix, pageSize = 20 }: Props = {}) {
  const raw = useQueryParams(
    [
      "page",
      "q",
      "matchingStatus",
      "salesChannel",
      "startDate",
      "endDate",
      "keywordType",
    ],
    prefix,
  )

  const { page, q, matchingStatus, salesChannel, startDate, endDate, keywordType } = raw

  const pageNum = page ? Math.max(1, Number(page)) : 1
  const statusTyped = STATUSES.includes(matchingStatus as MatchingStatusFilter)
    ? (matchingStatus as MatchingStatusFilter)
    : undefined
  const keywordTypeTyped = KEYWORD_TYPES.includes(keywordType as KeywordType)
    ? (keywordType as KeywordType)
    : undefined

  const searchParams: OrderLineQuery = {
    limit: pageSize,
    offset: (pageNum - 1) * pageSize,
    matchingStatus: statusTyped,
    salesChannel: salesChannel || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    keyword: q || undefined,
    keywordType: keywordTypeTyped ?? (q ? "productName" : undefined),
  }

  return { searchParams, raw }
}
