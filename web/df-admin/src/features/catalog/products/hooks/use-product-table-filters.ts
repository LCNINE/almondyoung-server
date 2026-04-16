import type { Filter } from "@/components/data-table"

export function useProductTableFilters(): Filter[] {
  return [
    {
      key: "mode",
      label: "상태",
      type: "select",
      options: [
        { label: "활성", value: "active" },
        { label: "활성+비활성", value: "active-or-inactive" },
      ],
    },
    {
      key: "brand",
      label: "브랜드",
      type: "string",
    },
  ]
}
