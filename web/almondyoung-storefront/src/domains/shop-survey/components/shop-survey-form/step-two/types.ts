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
  onChange: (
    field: keyof StepTwoValues,
    value: string | number | boolean | string[]
  ) => void
  errors?: StepTwoErrors
}
