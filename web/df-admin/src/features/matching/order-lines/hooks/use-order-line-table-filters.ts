import type { Filter } from "@/components/data-table"

export function useOrderLineTableFilters(): Filter[] {
  return [
    {
      key: "matchingStatus",
      label: "매칭 상태",
      type: "select",
      options: [
        { label: "매칭 대기", value: "pending" },
        { label: "매칭 완료", value: "matched" },
        { label: "무시", value: "ignored" },
        { label: "미등록", value: "unregistered" },
      ],
    },
    {
      key: "salesChannel",
      label: "판매 채널",
      type: "string",
    },
    {
      key: "keywordType",
      label: "검색 기준",
      type: "select",
      options: [
        { label: "상품명", value: "productName" },
        { label: "주문번호", value: "orderNumber" },
        { label: "고객명", value: "customerName" },
      ],
    },
    {
      key: "startDate",
      label: "시작일",
      type: "string",
    },
    {
      key: "endDate",
      label: "종료일",
      type: "string",
    },
  ]
}
