import ClientToast from "@components/common/client-toast"
import { ApiAuthError, ApiNetworkError } from "@lib/api/api-error"
import { fetchCurrentUser } from "@lib/api/users/me"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import AuthRestore from "../auth-restore"
import { headers } from "next/headers"

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
  try {
    await fetchCurrentUser()
    return <>{children}</>
  } catch (e) {
    if (e instanceof ApiAuthError) {
      // refreshToken이 있으면 복구 시도
      if (refreshToken) {
        return <AuthRestore hasRefreshToken={true} />
      }

      if (!refreshToken && pathname !== "/" && pathname !== "/kr") {
        return redirect(
          `/login/?redirect_to=${encodeURIComponent(pathname || "")}`
        )
      }

      // refreshToken이 없으면 비로그인 상태로 페이지 표시
      return <>{children}</>
    }

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
    throw e // 다른 에러는 error.tsx로 전달
  }
}
