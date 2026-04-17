import { Outlet } from "react-router-dom"
import { AuthExpiredHandler } from "@/features/auth/auth-expired-handler"

export function RootLayout() {
  return (
    <>
      <AuthExpiredHandler />
      <Outlet />
    </>
  )
}
