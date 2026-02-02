import { Loader2 } from "lucide-react"

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-10 w-10 animate-spin text-gray-900" />
      <span className="sr-only">Loading...</span>
    </div>
  )
}
