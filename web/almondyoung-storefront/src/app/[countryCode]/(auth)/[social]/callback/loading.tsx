import { Spinner } from "@components/common/spinner"

export default function Loading() {
  return (
    <div className="flex h-screen flex-col items-center justify-center">
      <Spinner size="lg" color="gray" />
    </div>
  )
}
