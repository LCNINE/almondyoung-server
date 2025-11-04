import { ApiAuthError } from "@lib/api-error"
import { fetchCurrentUser } from "@lib/api/users/me"
import AuthRestore from "../auth-restore"

export default async function ProtectedRoute({
  children,
}: {
  children: React.ReactNode
}) {
  try {
    await fetchCurrentUser()
    return <>{children}</>
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return <AuthRestore />
    }
    throw e // 다른 에러는 error.tsx로 전달
  }
}
