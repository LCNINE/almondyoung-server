export interface BenefitItem {
  id: string
  number: string // "01", "02", ...
  title: string
  description: string
  isUpcoming?: boolean
}

export interface BenefitDetail extends BenefitItem {
  image?: string
  link?: { text: string; href: string }
}

export interface FAQItem {
  question: string
  answer: string
}
