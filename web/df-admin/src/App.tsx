import { RouterProvider } from "react-router-dom"
import { router } from "@/routes"
import { Toaster } from "@/components/ui/sonner"
import { AuthProvider } from "@/features/auth/auth-context"

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
      <Toaster />
    </AuthProvider>
  )
}
