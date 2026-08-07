/**
 * 결제 주기 하나의 절약액.
 *
 * 기간 단위가 달력 월이 아니라 **결제 주기**인 이유: 환불 가능 여부가 결제 주기 기준으로 판정된다.
 * 화면이 달력 월로 끊으면 고객이 본 금액과 환불 판정 근거가 어긋난다.
 */
export interface SavingsPeriodDto {
  id: string
  contractId: string
  periodNumber: number
  startDate: string
  /** 주기 종료(배타적) */
  endDate: string
  isCurrent: boolean
  totalSavings: number
  orderCount: number
}

export interface SavingsOverviewDto {
  currentPeriod: SavingsPeriodDto | null
  periods: SavingsPeriodDto[]
  allTime: { totalSavings: number; orderCount: number }
}

export interface SavingsOrderDto {
  orderId: string
  orderDate: string
  discountAmount: number
}

export interface SavingsPeriodDetailDto extends SavingsPeriodDto {
  orders: SavingsOrderDto[]
}

/** @deprecated 달력 월 기준. 신규 화면은 `SavingsOverviewDto` 를 쓴다. */
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
