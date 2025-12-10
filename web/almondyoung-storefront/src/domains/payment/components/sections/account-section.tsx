import { Button } from "@components/common/ui/button"
import EmptyState from "../empty-state"
import { ChevronRight } from "lucide-react"

// 계좌 섹션
export default function AccountSection() {
  const account = false
  if (!account) {
    return (
      <EmptyState
        message="계좌"
        className="bg-card"
        action={
          <Button
            variant="ghost"
            className="w-full cursor-pointer px-0! font-medium hover:bg-transparent hover:text-inherit sm:w-auto md:px-6"
          >
            <span className="w-full text-left font-bold">
              등록한 계좌가 없어요
            </span>
            <ChevronRight className="size-4" />
          </Button>
        }
      />
    )
  }

  return <section className="bg-gray-10 p-4"></section>
}
