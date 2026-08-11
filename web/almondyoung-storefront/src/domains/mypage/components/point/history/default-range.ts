import { endOfMonth, startOfMonth, subMonths } from "date-fns"

export const DEFAULT_RANGE_MONTHS = 6

export function getDefaultRange(now: Date = new Date()) {
  return {
    from: startOfMonth(subMonths(now, DEFAULT_RANGE_MONTHS - 1)),
    to: endOfMonth(now),
  }
}
