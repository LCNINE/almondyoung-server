export type FilterOption = {
  label: string
  value: string
}

export type Filter =
  | {
      key: string
      label: string
      type: "select"
      options: FilterOption[]
      multiple?: boolean
      searchable?: boolean
    }
  | { key: string; label: string; type: "date" }
  | { key: string; label: string; type: "string" }
