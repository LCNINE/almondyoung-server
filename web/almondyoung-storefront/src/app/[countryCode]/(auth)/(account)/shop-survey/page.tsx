import ShopSurveyForm from "@/domains/shop-survey/components/shop-survey-form"

export default async function ShopSurveyPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const redirectTo = resolvedSearchParams.redirect_to ?? ""

  return (
    <section>
      <ShopSurveyForm redirectTo={redirectTo} />
    </section>
  )
}
