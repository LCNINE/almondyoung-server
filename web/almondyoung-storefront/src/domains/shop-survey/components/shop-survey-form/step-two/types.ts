/**
 * StepTwo 컴포넌트 타입 정의
 */

export interface StepTwoValues {
  isOperating: boolean
  yearsOperating: number
  shopType: string
  targetCustomers: string[]
  openDays: string[]
}

export interface StepTwoErrors {
  yearsOperating?: string
  shopType?: string
  targetCustomers?: string
  openDays?: string
}

export interface StepTwoProps {
  values: StepTwoValues
  onChange: (field: keyof StepTwoValues, value: any) => void
  errors?: StepTwoErrors
}

