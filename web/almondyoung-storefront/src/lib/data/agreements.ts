import agreementsData from "./agreements.json"

interface AgreementBase {
  id: string
  name: string
  content: string | null
}

interface Agreement extends AgreementBase {
  children?: AgreementBase[]
}

export const agreements = agreementsData.agreements
