"use client"

import { Button } from "@/components/ui/button"
import { CustomButton } from "@/components/shared/custom-buttons"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { updateInterestCategories } from "@/domains/home/interest-categories-actions"
import { Pencil } from "lucide-react"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { InterestKeyChips } from "./interest-key-chips"

interface InterestEditSheetProps {
  initialKeys: string[]
}

/*───────────────────────────
 * 홈 섹션 헤더 옆 "편집" 버튼 → 시트로 재선택 UI
 *──────────────────────────*/
export function InterestEditSheet({ initialKeys }: InterestEditSheetProps) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>(initialKeys)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (open) setSelected(initialKeys)
  }, [open, initialKeys])

  const handleSave = () => {
    startTransition(async () => {
      try {
        await updateInterestCategories(selected)
        toast.success("관심 카테고리가 변경됐어요")
        setOpen(false)
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error("저장에 실패했어요. 다시 시도해주세요.")
      }
    })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs text-zinc-500 hover:text-zinc-900"
        >
          <Pencil className="mr-1 h-3.5 w-3.5" />
          편집
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>관심 카테고리 변경</SheetTitle>
          <SheetDescription>
            최대 3개까지 선택할 수 있어요.
          </SheetDescription>
        </SheetHeader>

        <div className="py-6">
          <InterestKeyChips
            selectedKeys={selected}
            onChange={setSelected}
            disabled={isPending}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            취소
          </Button>
          <CustomButton
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="rounded-full"
          >
            {isPending ? "저장 중..." : "저장"}
          </CustomButton>
        </div>
      </SheetContent>
    </Sheet>
  )
}
