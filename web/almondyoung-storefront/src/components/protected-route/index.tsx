import ClientToast from "@/components/shared/client-toast"
import { ApiNetworkError } from "@lib/api/api-error"
import { fetchMe } from "@lib/api/users/me"
import { cookies, headers } from "next/headers"

export default async function ProtectedRoute({
  children,
}: {
  children: React.ReactNode
  requireAuth?: boolean
}) {
  const cookieStore = await cookies()
  const refreshToken = cookieStore.get("refreshToken")?.value

  const headersList = await headers()
  const pathname = headersList.get("x-pathname")
  console.log("pathname::::::", pathname)

  try {
    const isMainPage = !pathname || /^\/[a-z]{2}\/?$/.test(pathname)

    // 메인페이지이거나 리프레시토큰이 없으면 에러 무시
    // (pathname이 null인 경우도 메인페이지로 간주 - Edge 초기화 이슈 대응)
    if (isMainPage || !refreshToken) {
      await fetchMe().catch(() => null)
    } else {
      await fetchMe()
    }

    return <>{children}</>
  } catch (e) {
    if (e instanceof ApiNetworkError) {
      return (
        <>
          <ClientToast
            message="네트워크 에러가 발생했습니다. 잠시 후 다시 시도해주세요."
            type="error"
          />

          {children}
        </>
      )
    }

    throw e
  }
}
