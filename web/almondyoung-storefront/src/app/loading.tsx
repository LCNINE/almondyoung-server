import { Spinner } from "@/components/shared/spinner"

export default function Loading() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Spinner size="sm" color="gray" />
    </div>
  )
}
