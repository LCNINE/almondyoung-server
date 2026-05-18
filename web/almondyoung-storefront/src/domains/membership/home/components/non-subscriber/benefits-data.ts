import { useTranslations } from "next-intl"
import type { BenefitDetail, FAQItem } from "./benefit.types"

const CURRENT_BENEFIT_KEYS = [
  "benefit01",
  "benefit02",
  "benefit03",
  "benefit04",
  "benefit05",
  "benefit06",
  "benefit07",
  "benefit08",
] as const

const UPCOMING_BENEFIT_KEYS = [
  "benefit09",
  "benefit10",
  "benefit11",
  "benefit12",
  "benefit13",
  "benefit14",
  "benefit15",
  "benefit16",
] as const

const FAQ_KEYS = ["q1", "q2", "q3", "q4", "q5"] as const

export function useCurrentBenefits(): BenefitDetail[] {
  const t = useTranslations("mypage.membership.currentBenefits")
  return CURRENT_BENEFIT_KEYS.map((key, index) => ({
    id: `benefit-${String(index + 1).padStart(2, "0")}`,
    number: String(index + 1).padStart(2, "0"),
    title: t(`${key}.title`),
    description: t(`${key}.description`),
  }))
}

export function useUpcomingBenefits(): BenefitDetail[] {
  const t = useTranslations("mypage.membership.upcomingBenefits")
  return UPCOMING_BENEFIT_KEYS.map((key, index) => ({
    id: `benefit-${String(index + 9).padStart(2, "0")}`,
    number: String(index + 9).padStart(2, "0"),
    title: t(`${key}.title`),
    description: t(`${key}.description`),
    isUpcoming: true,
  }))
}

export function useFaqData(): FAQItem[] {
  const t = useTranslations("mypage.membership.faq")
  return FAQ_KEYS.map((key) => ({
    question: t(`${key}.question`),
    answer: t(`${key}.answer`),
  }))
}
