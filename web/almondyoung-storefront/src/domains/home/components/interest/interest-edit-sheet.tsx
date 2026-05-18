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
import { useTranslations } from "next-intl"
import { InterestKeyChips } from "./interest-key-chips"

interface InterestEditSheetProps {
  initialKeys: string[]
}

export function InterestEditSheet({ initialKeys }: InterestEditSheetProps) {
  const t = useTranslations("home.interestEdit")
  const tBanner = useTranslations("home.interestBanner")
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
        toast.success(t("updated"))
        setOpen(false)
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error(tBanner("saveFail"))
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
          {t("trigger")}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>{t("sheetTitle")}</SheetTitle>
          <SheetDescription>
            {t("sheetDescription")}
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
            {t("cancel")}
          </Button>
          <CustomButton
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="rounded-full"
          >
            {isPending ? t("saving") : t("save")}
          </CustomButton>
        </div>
      </SheetContent>
    </Sheet>
  )
}
