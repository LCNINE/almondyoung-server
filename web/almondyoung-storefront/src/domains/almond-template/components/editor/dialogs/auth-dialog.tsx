import { usePathname } from "next/navigation"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"

export function AuthDialog({ editor }: { editor: AlmondEditor }) {
  const { authRequired, retryPending, dismissAuth } = editor
  const pathname = usePathname()
  if (!authRequired) return null
  const countryCode = pathname.split("/")[1] || "kr"
  const openLogin = () =>
    window.open(
      `/${countryCode}/login?redirect_to=${encodeURIComponent(`/${countryCode}`)}`,
      "_blank",
      "noopener"
    )
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="로그인 필요"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-[420px] max-w-[95vw] bg-white p-5 shadow-xl">
        <h2 className="mb-2 text-lg font-bold">로그인이 필요합니다</h2>
        <p className="text-sm text-slate-600">
          로그인이 만료되었거나 로그인하지 않은 상태입니다. 지금 작업은 이
          화면과 브라우저에 그대로 남아 있습니다. 새 창에서 로그인한 뒤 이
          창으로 돌아오면 저장을 자동으로 이어서 합니다.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="border px-3 py-2 text-sm" onClick={dismissAuth}>
            닫기
          </button>
          <button
            className="border px-3 py-2 text-sm"
            onClick={() => void retryPending()}
          >
            다시 시도
          </button>
          <button
            className="bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            onClick={openLogin}
          >
            새 창에서 로그인
          </button>
        </div>
      </div>
    </div>
  )
}
