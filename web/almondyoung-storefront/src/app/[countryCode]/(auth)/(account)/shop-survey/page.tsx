import ShopSurveyTemplate from "domains/shop-survey/template/shop-survey-template"

export default async function ShopSurveyPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const redirectTo = resolvedSearchParams.redirect_to ?? ""

  return (
    <>
      <ShopSurveyTemplate
        searchParams={Promise.resolve({ redirect_to: redirectTo })}
      />
    </>
  )
}
