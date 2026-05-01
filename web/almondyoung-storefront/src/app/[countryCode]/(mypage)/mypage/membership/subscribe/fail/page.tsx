import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "결제 실패 - 멤버십",
}

// 멤버십 결제실패페이지
export default async function PaymentFailedScreen({
  params,
  searchParams,
}: {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ code?: string; message?: string }>
}) {
  const { countryCode } = await params
  const { code, message } = await searchParams
  const displayMessage =
    message && message.trim().length > 0
      ? message
      : "결제 처리 중 문제가 발생했습니다."
  return (
    // PARENT:
    // 화면 전체를 채우고, 자식(단일 컨테S...이너)을 수직 배치합니다.
    <div className="flex min-h-screen flex-col bg-white font-['Pretendard']">
      {/* SINGLE CONTAINER:
        - 말씀하신 대로, 단 하나의 컨테이너가 너비(max-w-lg), 정렬(mx-auto), 패딩(px-6)을 모두 담당합니다.
        - 'flex-1': Parent(div.flex)의 남은 공간을 모두 차지합니다.
        - 'flex flex-col': 이 컨테이너의 자식들(콘텐츠, 푸터)을 수직으로 배치합니다.
      */}
      <div className="mx-auto flex w-full flex-1 flex-col px-6">
        {/* INNER 1 (Content Area):
            - 'flex-1': Container(div.flex-col) 내에서 남은 공간을 모두 차지하여
              푸터를 하단으로 밀어냅니다.
            - py-10: 콘텐츠 영역의 상하 패딩.
        */}
        <div className="flex-1 overflow-y-auto py-10">
          <div className="flex flex-col gap-8">
            <section aria-labelledby="payment-failed-title">
              {/* 지적하신 '가운데 정렬'을 위해 'text-center'를 추가했습니다.
                'justify-center'는 flex-col에서 수직 중앙 정렬이므로 
                'text-center' (수평 중앙 정렬)가 의도하신 것이 맞을 겁니다.
              */}
              <h1
                id="payment-failed-title"
                className="text-center text-2xl leading-tight font-bold text-black"
              >
                멤버십 회비 결제에 실패했습니다.
              </h1>
            </section>

            <section aria-labelledby="payment-failure-reason">
              <h2 id="payment-failure-reason" className="sr-only">
                실패 사유
              </h2>
              {/* 이 텍스트는 가독성을 위해 'text-left' (기본값)로 둡니다.
                만약 이 텍스트도 중앙 정렬이 필요하면 'text-center'를 추가합니다.
              */}
              <p className="text-sm leading-relaxed text-gray-800">
                {displayMessage}
              </p>
              {code && (
                <p className="mt-2 text-xs text-gray-500">오류 코드: {code}</p>
              )}
            </section>
          </div>
        </div>

        {/* INNER 2 (Footer Area):
            - 이 <footer>는 이제 'max-w-lg' 컨테이너 내부에 있습니다.
            - 배경색이나 테두리가 더 이상 full-width로 적용되지 않습니다.
        */}
        <footer className="w-full flex-shrink-0 py-4">
          <Link
            href={`/${countryCode}/mypage/membership/subscribe/payment`}
            className="block w-full rounded-md bg-amber-500 px-4 py-3 text-center text-sm leading-5 font-semibold text-white transition-colors hover:bg-amber-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
          >
            다시 결제하기
          </Link>
        </footer>
      </div>
    </div>
  )
}
