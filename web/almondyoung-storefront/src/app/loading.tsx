import { Spinner } from "@/components/shared/spinner"

export default function Loading() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Spinner size="lg" color="blue" />
    </div>
  )
}
