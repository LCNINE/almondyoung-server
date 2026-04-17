import type { Filter } from "@/components/data-table"

export function useSkuTableFilters(): Filter[] {
  return [
    {
      key: "stockType",
      label: "재고 유형",
      type: "select",
      options: [
        { label: "사입", value: "physical" },
        { label: "무제한", value: "infinite" },
        { label: "직배", value: "drop_shipped" },
        { label: "위탁", value: "consignment" },
      ],
    },
    {
      key: "displayMode",
      label: "재고 상태",
      type: "select",
      options: [
        { label: "전체", value: "all" },
        { label: "안전재고 미만", value: "below_safety" },
        { label: "재고 있음", value: "with_stock" },
        { label: "품절", value: "out_of_stock" },
      ],
    },
    {
      key: "barcode",
      label: "바코드",
      type: "string",
    },
  ]
}
