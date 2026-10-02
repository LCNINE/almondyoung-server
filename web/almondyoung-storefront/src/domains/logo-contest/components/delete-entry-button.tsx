"use client"

import { Button } from "@/components/ui/button"
import { deleteLogoContestEntry } from "@/lib/api/ugc/logo-contest"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"

export function DeleteEntryButton({ entryId }: { entryId: string }) {
  const t = useTranslations("logoContest.entry")
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleDelete = () => {
    if (!window.confirm(t("deleteConfirm"))) return

    startTransition(async () => {
      try {
        const result = await deleteLogoContestEntry(entryId)
        if (!result.ok) {
          toast.error(result.message)
          return
        }
        toast.success(t("deleted"))
        router.refresh()
      } catch (caught: unknown) {
        const error = caught as Error & { digest?: string }
        if (
          error.digest === "UNAUTHORIZED" ||
          error.message === "UNAUTHORIZED"
        ) {
          throw caught
        }
        toast.error(t("deleteFail"))
      }
    })
  }

  return (
    <Button
      variant="outline"
      onClick={handleDelete}
      disabled={isPending}
      className="text-destructive"
    >
      {t("delete")}
    </Button>
  )
}
