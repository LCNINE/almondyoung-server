export interface MonthlySavingsDto {
  yearMonth: string
  totalSavings: number
  orderCount: number
  period?: {
    startDate: string
    endDate: string
  }
}

export interface RangeSavingsDto {
  totalSavings: number
  orderCount: number
  period?: {
    startDate: string
    endDate: string
  }
  monthlyBreakdown: Array<{
    yearMonth: string
    savings: number
    orderCount: number
  }>
}
