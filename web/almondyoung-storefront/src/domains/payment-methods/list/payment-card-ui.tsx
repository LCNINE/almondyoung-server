import { CreditCard } from "lucide-react"
import { PaymentProfile } from "../api"

interface PaymentCardUIProps {
  profile: PaymentProfile
  onClick?: () => void
  selected?: boolean
}

/**
 * 카드사별 브랜드 컬러 매핑
 */
const getCardBrandColor = (companyName: string): string => {
  const colorMap: Record<string, string> = {
    신한카드: "from-blue-500 to-blue-700",
    KB국민카드: "from-yellow-500 to-yellow-700",
    SC제일카드: "from-green-500 to-green-700",
    씨티카드: "from-blue-600 to-blue-800",
    NH농협카드: "from-green-600 to-green-800",
    IBK기업은행카드: "from-gray-600 to-gray-800",
    우리카드: "from-cyan-500 to-cyan-700",
    하나카드: "from-emerald-500 to-emerald-700",
    케이뱅크: "from-yellow-400 to-yellow-600",
    카카오뱅크: "from-yellow-500 to-amber-600",
    토스뱅크: "from-blue-500 to-indigo-600",
  }

  return colorMap[companyName] || "from-slate-600 to-slate-800"
}

/**
 * 카드 UI 컴포넌트
 * 실제 카드처럼 디자인된 결제수단 카드
 */
export function PaymentCardUI({
  profile,
  onClick,
  selected = false,
}: PaymentCardUIProps) {
  if (!profile.details) return null

  const { paymentCompanyName, paymentNumber, cardLast4, payerName, cmsStatus } =
    profile.details

  const gradientColor = getCardBrandColor(paymentCompanyName)
  const isActive = cmsStatus === "ACTIVE" || profile.status === "ACTIVE"

  return (
    <div
      onClick={onClick}
      className={`
        relative h-52 w-full max-w-sm cursor-pointer rounded-2xl p-6
        shadow-lg transition-all hover:shadow-xl
        ${selected ? "ring-4 ring-amber-500" : ""}
        ${!isActive ? "opacity-60 grayscale" : ""}
      `}
    >
      {/* 카드 배경 그라데이션 */}
      <div
        className={`
          absolute inset-0 rounded-2xl bg-gradient-to-br ${gradientColor}
          opacity-90
        `}
      />

      {/* 카드 패턴 (선택적) */}
      <div className="absolute inset-0 rounded-2xl bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgNDAgMTAgTSAxMCAwIEwgMTAgNDAgTSAwIDIwIEwgNDAgMjAgTSAyMCAwIEwgMjAgNDAgTSAwIDMwIEwgNDAgMzAgTSAzMCAwIEwgMzAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMC41IiBvcGFjaXR5PSIwLjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-20" />

      {/* 카드 내용 */}
      <div className="relative z-10 flex h-full flex-col justify-between text-white">
        {/* 카드 상단: 카드사명 + 아이콘 */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium opacity-90">HMS Card</p>
            <h3 className="mt-1 text-xl font-bold">{paymentCompanyName}</h3>
          </div>
          <div className="rounded-full bg-white/20 p-2 backdrop-blur-sm">
            <CreditCard className="h-6 w-6" />
          </div>
        </div>

        {/* 카드 중앙: 카드번호 */}
        <div>
          <p className="font-mono text-lg tracking-wider">{paymentNumber}</p>
        </div>

        {/* 카드 하단: 소유자명 + 상태 */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs opacity-75">카드 소유자</p>
            <p className="mt-1 font-medium">{payerName || "등록된 카드"}</p>
          </div>
          <div className="text-right">
            {!isActive && (
              <span className="rounded-full bg-white/20 px-2 py-1 text-xs font-medium backdrop-blur-sm">
                비활성
              </span>
            )}
            {selected && (
              <span className="rounded-full bg-amber-500 px-2 py-1 text-xs font-medium">
                선택됨
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 간소화된 카드 리스트 아이템
 * 목록에서 사용하기 좋은 간단한 버전
 */
export function PaymentCardListItem({
  profile,
  onClick,
  selected = false,
}: PaymentCardUIProps) {
  if (!profile.details) return null

  const { paymentCompanyName, cardLast4, cmsStatus } = profile.details
  const isActive = cmsStatus === "ACTIVE" || profile.status === "ACTIVE"

  return (
    <button
      onClick={onClick}
      className={`
        flex w-full items-center justify-between rounded-lg border-2 p-4
        transition-all hover:bg-gray-50
        ${selected ? "border-amber-500 bg-amber-50" : "border-gray-200"}
        ${!isActive ? "opacity-60" : ""}
      `}
    >
      <div className="flex items-center gap-3">
        <div className="rounded-full bg-gradient-to-br from-blue-500 to-blue-700 p-2">
          <CreditCard className="h-5 w-5 text-white" />
        </div>
        <div className="text-left">
          <p className="font-semibold">{paymentCompanyName}</p>
          <p className="text-sm text-gray-500">•••• {cardLast4}</p>
        </div>
      </div>
      {!isActive && (
        <span className="rounded-full bg-gray-200 px-3 py-1 text-xs text-gray-600">
          비활성
        </span>
      )}
      {selected && (
        <span className="rounded-full bg-amber-500 px-3 py-1 text-xs text-white">
          선택됨
        </span>
      )}
    </button>
  )
}

