import agreementsData from "./agreements.json"

export type Agreement = {
  id: string
  name: string
  content: string | null
  required: boolean
}

export const agreements: Agreement[] = agreementsData.agreements.map((a) => ({
  id: a.id,
  name: a.name,
  content: a.content,
  required: a.name.includes("[필수]"),
}))

export const requiredAgreementIds = agreements
  .filter((a) => a.required)
  .map((a) => a.id)
