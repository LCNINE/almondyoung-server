import { ApiAuthError } from "@lib/api-error"
import { fetchCurrentUser } from "@lib/api/users/me"
import AuthRestore from "../auth-restore"
import { cookies } from "next/headers"

export default async function ProtectedRoute({
  children,
}: {
  children: React.ReactNode
  requireAuth?: boolean
}) {
  const cookieStore = await cookies()
  const refreshToken = cookieStore.get("refreshToken")?.value

  try {
    await fetchCurrentUser()

    return <>{children}</>
  } catch (e) {
    if (e instanceof ApiAuthError) {
      // refreshToken이 있으면 복구 시도
      if (refreshToken) {
        return <AuthRestore hasRefreshToken={true} />
      }
      // refreshToken이 없으면 비로그인 상태로 페이지 표시
      return <>{children}</>
    }
    throw e // 다른 에러는 error.tsx로 전달
  }
}
