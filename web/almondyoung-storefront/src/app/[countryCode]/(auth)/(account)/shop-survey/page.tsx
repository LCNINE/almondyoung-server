import { AlertRedirectDialog } from "@/components/alert-redirect-dialog"
import ProtectedRoute from "@/components/protected-route"
import ShopSurveyForm from "@/domains/shop-survey/components/shop-survey-form"
import { fetchMe } from "@/lib/api/users/me"
import { getShopSurvey } from "@/lib/api/users/shop-suvery"
import { ShopInfoDto } from "@/lib/types/dto/users"

export default async function ShopSurveyPage({
  params,
  searchParams,
}: {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ redirect_to?: string }>
}) {
  const { countryCode } = await params
  const resolvedSearchParams = await searchParams
  const redirectTo = resolvedSearchParams.redirect_to ?? ""

  const initialData = await getShopSurvey()

  return (
    <ProtectedRoute>
      <ShopSurveyManager
        countryCode={countryCode}
        redirectTo={redirectTo}
        initialData={initialData}
      />
    </ProtectedRoute>
  )
}

interface ShopSurveyManagerProps {
  countryCode: string
  redirectTo: string
  initialData: ShopInfoDto | null
}

async function ShopSurveyManager({
  countryCode,
  redirectTo,
  initialData,
}: ShopSurveyManagerProps) {
  const user = await fetchMe().catch(() => null)
  const hasShop = !!user?.shop

  if (hasShop) {
    return (
      <AlertRedirectDialog
        title="이미 완료됨"
        description="이미 설문을 완료했습니다."
        buttonText="확인"
        redirectTo={`/${countryCode}/mypage`}
      />
    )
  }

  return (
    <section className="min-h-screen w-full">
      <ShopSurveyForm redirectTo={redirectTo} initialData={initialData} />
    </section>
  )
}
