import Link from "next/link"

export default function SkinPage() {
  return (
    <div>
      <h1>
        todo: 연정님이 작업한 UI와 피그마 UI가 다름. 피그마 UI 요청 작업필요.
        <br />
        만약 현재 상황에 없으면 다른 페이지와 동일하게 메이크업 페이지로 구현
      </h1>
      <div className="w-full">
        {/* 피부미용 카테고리 특화 배너 */}
        <div className="relative mb-8 h-96 bg-gradient-to-r from-emerald-500 to-teal-600">
          <div className="bg-opacity-20 absolute inset-0 bg-black"></div>
          <div className="relative z-10 container mx-auto flex h-full max-w-[1360px] items-center px-[40px]">
            <div className="text-white">
              <h1 className="mb-4 text-5xl font-bold">피부미용</h1>
              <p className="mb-6 text-xl">
                건강하고 아름다운 피부를 위한 전문 제품
              </p>
              <Link
                href={`/kr/c/skin-skin`}
                className="hover:bg-muted rounded-lg bg-white px-6 py-3 font-semibold text-emerald-600 transition-colors"
              >
                스킨플래닝 제품 보기
              </Link>
            </div>
          </div>
        </div>

        <div className="container mx-auto max-w-[1360px] px-[40px] py-6">
          {/* 피부미용 카테고리 특화 섹션들 */}
          <div className="mb-12 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg bg-white p-6 shadow-md transition-shadow hover:shadow-lg">
              <div className="mb-4 flex h-48 w-full items-center justify-center rounded-lg bg-gradient-to-br from-emerald-300 to-green-500">
                <span className="text-2xl font-bold text-white">
                  스킨플래닝
                </span>
              </div>
              <h3 className="mb-2 text-xl font-semibold">스킨플래닝</h3>
              <p className="mb-4 text-gray-600">전문가용 스킨플래닝 도구</p>
              <Link
                href={`/kr/c/skin-skin`}
                className="font-medium text-emerald-600 hover:text-emerald-800"
              >
                제품 보기 →
              </Link>
            </div>

            <div className="rounded-lg bg-white p-6 shadow-md transition-shadow hover:shadow-lg">
              <div className="mb-4 flex h-48 w-full items-center justify-center rounded-lg bg-gradient-to-br from-teal-300 to-cyan-500">
                <span className="text-2xl font-bold text-white">화장품</span>
              </div>
              <h3 className="mb-2 text-xl font-semibold">화장품</h3>
              <p className="mb-4 text-gray-600">전문가용 스킨케어 화장품</p>
              <Link
                href={`/kr/c/skin-cosmetic`}
                className="font-medium text-emerald-600 hover:text-emerald-800"
              >
                제품 보기 →
              </Link>
            </div>

            <div className="rounded-lg bg-white p-6 shadow-md transition-shadow hover:shadow-lg">
              <div className="mb-4 flex h-48 w-full items-center justify-center rounded-lg bg-gradient-to-br from-blue-300 to-indigo-500">
                <span className="text-2xl font-bold text-white">미용기기</span>
              </div>
              <h3 className="mb-2 text-xl font-semibold">미용기기</h3>
              <p className="mb-4 text-gray-600">전문가용 피부미용 기기</p>
              <Link
                href={`/kr/c/skin-machine`}
                className="font-medium text-emerald-600 hover:text-emerald-800"
              >
                제품 보기 →
              </Link>
            </div>
          </div>

          {/* 피부미용 특화 상품 추천 섹션 */}
          <div className="rounded-lg bg-gray-50 p-8">
            <h2 className="mb-6 text-2xl font-bold text-gray-900">
              피부미용 전문가 추천 제품
            </h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg bg-white p-4 shadow-sm">
                <div className="mb-3 h-32 w-full rounded-lg bg-gray-200"></div>
                <h4 className="font-semibold text-gray-900">스킨플래닝 키트</h4>
                <p className="text-sm text-gray-600">85,000원</p>
              </div>
              <div className="rounded-lg bg-white p-4 shadow-sm">
                <div className="mb-3 h-32 w-full rounded-lg bg-gray-200"></div>
                <h4 className="font-semibold text-gray-900">
                  프리미엄 페이셜 크림
                </h4>
                <p className="text-sm text-gray-600">45,000원</p>
              </div>
              <div className="rounded-lg bg-white p-4 shadow-sm">
                <div className="mb-3 h-32 w-full rounded-lg bg-gray-200"></div>
                <h4 className="font-semibold text-gray-900">LED 마스크</h4>
                <p className="text-sm text-gray-600">150,000원</p>
              </div>
              <div className="rounded-lg bg-white p-4 shadow-sm">
                <div className="mb-3 h-32 w-full rounded-lg bg-gray-200"></div>
                <h4 className="font-semibold text-gray-900">모델링팩 세트</h4>
                <p className="text-sm text-gray-600">35,000원</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
