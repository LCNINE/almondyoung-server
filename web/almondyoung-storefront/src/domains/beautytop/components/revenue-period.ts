export function revenuePeriod(
  period: string
):
  | { kind: "year"; year: string }
  | { kind: "quarter"; year: string; quarter: string }
  | { kind: "unknown" } {
  if (/^\d{4}$/.test(period)) return { kind: "year", year: period }
  if (/^\d{4}[1-4]$/.test(period))
    return {
      kind: "quarter",
      year: period.slice(0, 4),
      quarter: period.slice(4),
    }
  return { kind: "unknown" }
}
