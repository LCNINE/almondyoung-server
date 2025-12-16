"use client"

import { HttpApiError } from "@lib/api/api-error"
import { getBnplProfiles, setDefaultPaymentProfile } from "@lib/api/wallet"
import type { BnplProfileDto } from "@lib/types/dto/wallet"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

// (아이콘은 실제 프로젝트에서는 @heroicons/react 등을 사용해야 합니다)
// 임시 아이콘 컴포넌트
const IconChevronLeft = () => (
  <svg
    className="h-5 w-5"
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M12.79 5.23a.75.75 0 010 1.06L9.06 10l3.73 3.71a.75.75 0 11-1.06 1.06l-4.25-4.25a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0z"
      clipRule="evenodd"
    />
  </svg>
)

// 멤버십 회비 결제 수단 관리 페이지
export default function PaymentMethodScreen() {
  const router = useRouter()
  const [profiles, setProfiles] = useState<BnplProfileDto[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isChanging, setIsChanging] = useState<string | null>(null) // 변경 중인 profileId

  // 프로필 목록 조회
  useEffect(() => {
    async function fetchProfiles() {
      try {
        setIsLoading(true)
        const data = await getBnplProfiles()
        // HMS_CARD만 필터링 (멤버십은 HMS_CARD만 사용)
        const hmsCardProfiles = data.filter(
          (p) => p.provider === "HMS_CARD" && p.status === "ACTIVE"
        )
        setProfiles(hmsCardProfiles)
      } catch (error) {
        console.error("프로필 조회 실패:", error)
        toast.error("결제 수단 목록을 불러오는데 실패했습니다.")
      } finally {
        setIsLoading(false)
      }
    }

    fetchProfiles()
  }, [])

  // 기본 결제 수단 변경
  const handleSetDefault = async (profileId: string) => {
    if (isChanging) return // 이미 변경 중이면 무시

    try {
      setIsChanging(profileId)
      await setDefaultPaymentProfile(profileId)
      toast.success("기본 결제 수단이 변경되었습니다.")

      // 프로필 목록 새로고침
      const data = await getBnplProfiles()
      const hmsCardProfiles = data.filter(
        (p) => p.provider === "HMS_CARD" && p.status === "ACTIVE"
      )
      setProfiles(hmsCardProfiles)
    } catch (error) {
      if (error instanceof HttpApiError) {
        if (error.status === 400 && error.message.includes("HMS_CARD")) {
          toast.error("멤버십 결제는 HMS 카드만 사용할 수 있습니다.")
        } else {
          toast.error(error.message || "기본 결제 수단 변경에 실패했습니다.")
        }
      } else {
        toast.error("기본 결제 수단 변경에 실패했습니다.")
      }
      console.error("기본 결제 수단 변경 실패:", error)
    } finally {
      setIsChanging(null)
    }
  }

  // 프로필 포맷팅 헬퍼
  const formatCardDisplay = (profile: BnplProfileDto) => {
    if (profile.details?.paymentCompanyName) {
      return profile.details.paymentCompanyName
    }
    return "카드"
  }

  const formatCardNumber = (profile: BnplProfileDto) => {
    if (profile.details?.cardLast4) {
      return `****-****-****-${profile.details.cardLast4}`
    }
    if (profile.details?.paymentNumber) {
      return profile.details.paymentNumber
    }
    return "****-****-****-****"
  }

  // 기본 결제 수단과 다른 프로필 분리
  const defaultProfile = profiles.find((p) => p.isDefault)
  const otherProfiles = profiles.filter((p) => !p.isDefault)

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-gray-600">로딩 중...</p>
      </div>
    )
  }

  return (
    // PARENT:
    // 화면 전체를 감싸고, 자식(Container)을 수직 배치합니다.
    <div className="flex min-h-screen flex-col bg-white font-['Pretendard']">
      {/* SINGLE CONTAINER:
        - 페이지의 모든 요소를 감싸는 "단일 컨테이너"입니다.
        - 너비(max-w-lg), 중앙 정렬(mx-auto)을 담당합니다.
        - flex-1, flex-col: 자식 요소(header, div.content, footer)를 수직으로 배치하고
          전체 높이를 채웁니다.
      */}
      <div className="mx-auto flex w-full flex-1 flex-col">
        {/* INNER 1 (Header):
            - Container의 자식으로, flex-shrink-0을 통해 높이가 줄어들지 않습니다.
            - px-4: 컨테이너 좌우 패딩(px-6)과 별도로 헤더 패딩을 지정할 수 있습니다.
                   (혹은 컨테이너에 px-6을 주고 여기선 px-0을 사용)
                   여기서는 일관성을 위해 px-6을 사용합니다.
        */}
        <header className="flex w-full shrink-0 items-center border-b border-gray-200 px-3 py-4 md:px-6 md:py-3">
          <div className="flex-1">
            <button
              aria-label="뒤로 가기"
              className="-m-2 p-2 text-black"
              onClick={() => router.back()}
            >
              <IconChevronLeft />
            </button>
          </div>
          <h1 className="flex-1 text-center text-base font-bold text-black">
            멤버십 회비 결제 수단 관리
          </h1>
          {/* 제목을 중앙에 맞추기 위한 오른쪽 스페이서 */}
          <div className="flex-1" />
        </header>

        {/* INNER 2 (Content Area):
            - 'flex-1': Header와 Footer를 제외한 모든 남은 공간을 차지합니다.
            - 'overflow-y-auto': 콘텐츠가 많아지면 이 영역만 스크롤됩니다.
            - 'px-6 py-8': 콘텐츠의 좌우, 상하 여백을 지정합니다.
        */}
        <div className="flex-1 overflow-y-auto px-6 py-8">
          {/* 콘텐츠 Inner */}
          <div className="flex flex-col gap-8">
            {/* 현재 결제 수단 */}
            {defaultProfile ? (
              <section aria-labelledby="primary-method-title">
                <h2
                  id="primary-method-title"
                  className="text-xs leading-4 font-bold text-black"
                >
                  멤버십 회비 결제수단
                </h2>
                <div className="mt-2 flex flex-col gap-1">
                  <p className="text-xs leading-4 text-gray-800">
                    {formatCardDisplay(defaultProfile)}
                  </p>
                  <p className="font-['Inter'] text-base font-semibold text-black">
                    {formatCardNumber(defaultProfile)}
                  </p>
                </div>
              </section>
            ) : (
              <section aria-labelledby="primary-method-title">
                <h2
                  id="primary-method-title"
                  className="text-xs leading-4 font-bold text-black"
                >
                  멤버십 회비 결제수단
                </h2>
                <div className="mt-2 flex flex-col gap-1">
                  <p className="text-xs leading-4 text-gray-600">
                    등록된 결제 수단이 없습니다.
                  </p>
                </div>
              </section>
            )}

            {/* 안내 문구 */}
            <section aria-label="결제 안내">
              <p className="text-xs leading-relaxed font-medium text-gray-600">
                매월 7일 결제되며, 해당 날짜가 없는 달에는 말일에 결제됩니다.
                (예, 29일,30일,31일)
                <br />
                결제 실패 시, 결제 수단 목록 순서대로 결제를 시도합니다.
              </p>
            </section>

            {/* 다른 결제 수단 목록 */}
            {otherProfiles.length > 0 && (
              <section
                aria-label="다른 결제 수단"
                className="flex flex-col gap-4"
              >
                {otherProfiles.map((profile) => (
                  <div
                    key={profile.id}
                    className="flex flex-col gap-3 rounded-md bg-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex flex-col gap-1.5">
                      <p className="text-xs leading-4 font-medium text-gray-700">
                        {formatCardDisplay(profile)}
                      </p>
                      <p className="text-xs leading-4 text-black">
                        {formatCardNumber(profile)}
                      </p>
                    </div>
                    <button
                      className="shrink-0 rounded-sm border border-gray-400 bg-white px-2.5 py-1.5 text-xs leading-4 font-normal text-black shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => handleSetDefault(profile.id)}
                      disabled={isChanging === profile.id || !!isChanging}
                    >
                      {isChanging === profile.id
                        ? "변경 중..."
                        : "멤버십 회비 결제수단으로 변경"}
                    </button>
                  </div>
                ))}
              </section>
            )}

            {/* 결제 수단이 없을 때 */}
            {profiles.length === 0 && (
              <section aria-label="결제 수단 없음">
                <div className="rounded-md bg-gray-100 p-4 text-center">
                  <p className="text-xs leading-4 text-gray-600">
                    등록된 HMS 카드가 없습니다.
                  </p>
                </div>
              </section>
            )}
          </div>
        </div>

        {/* INNER 3 (Footer / Nav):
            - 'flex-shrink-0': 높이가 줄어들지 않습니다.
            - 'w-full': Container의 너비를 따릅니다 (max-w-lg).
        */}
        <footer className="w-full shrink-0">
          {/* CTA 버튼 영역 */}
          <div className="border-t border-gray-200 bg-white p-4">
            <button
              className="w-full rounded-md bg-amber-500 px-4 py-3 text-center text-sm leading-5 font-semibold text-white transition-colors hover:bg-amber-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
              onClick={() => router.push("/kr/mypage/payment-methods")}
            >
              새로운 결제수단 등록하기
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
