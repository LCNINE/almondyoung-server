import { Spinner } from "@/components/shared/spinner"

export default function Loading() {
  return (
    <div className="flex h-screen flex-col items-center justify-center">
      <Spinner size="lg" color="gray" />
    </div>
  )
}
