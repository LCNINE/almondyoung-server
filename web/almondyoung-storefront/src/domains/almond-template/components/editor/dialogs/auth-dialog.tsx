import { usePathname } from "next/navigation"
import type { AlmondEditor } from "../../../hooks/use-almond-editor"

export function AuthDialog({ editor }: { editor: AlmondEditor }) {
  const { authRequired, retryPending, dismissAuth } = editor
  const pathname = usePathname()
  if (!authRequired) return null
  const countryCode = pathname.split("/")[1] || "kr"
  const openLogin = () =>
    window.open(
      `/${countryCode}/login?redirect_to=${encodeURIComponent(`/${countryCode}/login-done`)}`,
      "almond-template-login",
      "popup,width=480,height=720"
    )
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="로그인 필요"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-[420px] max-w-[95vw] bg-white p-5 shadow-xl">
        <h2 className="mb-2 text-lg font-bold">로그인이 만료되었어요</h2>
        <p className="text-sm text-slate-600">
          작업 내용은 그대로 있어요. 다시 로그인하면 저장을 이어서 할게요.
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
            로그인
          </button>
        </div>
      </div>
    </div>
  )
}
