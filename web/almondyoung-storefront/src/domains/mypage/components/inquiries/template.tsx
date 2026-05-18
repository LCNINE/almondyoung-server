import { getTranslations } from "next-intl/server"
import { getMyQuestions } from "@/lib/api/ugc/qna"
import { MyInquiriesList } from "./my-inquiries-list"

type Props = {
  params: { countryCode: string }
  searchParams: { page?: string }
}

export async function MyInquiriesTemplate({ searchParams }: Props) {
  const t = await getTranslations("mypage.inquiry")
  const page = Number(searchParams.page) || 1
  const limit = 10

  const result = await getMyQuestions({
    sort: "latest",
    page,
    limit,
  })

  return (
    <div className="min-h-screen bg-white px-3 py-4 md:px-6">
      <h1 className="mb-6 hidden text-xl font-bold text-gray-900 md:block">
        {t("myInquiriesTitle")}
      </h1>

      <MyInquiriesList
        initialQuestions={result.data ?? []}
        initialTotal={result.total ?? 0}
        initialPage={page}
        limit={limit}
      />
    </div>
  )
}
