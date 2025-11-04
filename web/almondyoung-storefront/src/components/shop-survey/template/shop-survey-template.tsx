import SurveyForm from "../components/shop-survey-form"

export default async function ShopSurveyTemplate({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string }>
}) {
  const redirectTo = (await searchParams)?.redirect_to

  return (
    <section className="">
      <SurveyForm redirectTo={redirectTo} />
    </section>
  )
}
